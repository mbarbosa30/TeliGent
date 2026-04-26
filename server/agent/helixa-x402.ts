import { z } from "zod";
import { createWalletClient, http, parseAbi, formatUnits, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { getBaseClient } from "./helixa-siwa";

// x402 = HTTP 402 Payment Required protocol used by Helixa for paid endpoints.
// On the first request the server responds 402 with payment instructions
// (recipient, amount in atomic units, asset, chain). We pay via on-chain
// USDC.transfer on Base, wait for the receipt, then retry the same request.
// Helixa's middleware verifies the payment against the calling wallet
// automatically on the retry.

// Hard-pinned canonical Base USDC contract. Intentionally NOT env-configurable:
// allowing an override would defeat the strict trust check below (an attacker
// or misconfiguration could redirect the platform wallet to drain into an
// arbitrary token). If the canonical address ever changes upstream, update
// this constant in code and review the entire mint path.
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const USDC_DECIMALS = 6;
const BASE_CHAIN_ID = 8453;
// Hard cap on a single x402 payment. Helixa's documented mint price is $1 USDC;
// we allow up to 5 USDC of headroom for fee changes. Any 402 instruction that
// asks for more is rejected on the client side so a malformed/compromised
// upstream cannot drain the platform wallet.
const X402_MAX_USDC_ATOMIC = 5n * 10n ** BigInt(USDC_DECIMALS);
const USDC_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

// Helixa's 402 body shape isn't formally spec'd in the public docs, so we
// accept several plausible shapes and normalize. All optional + passthrough
// to survive minor server-side changes.
const x402BodySchema = z
  .object({
    paymentRequired: z.boolean().optional(),
    amount: z.union([z.string(), z.number()]).optional(),
    amountAtomic: z.union([z.string(), z.number()]).optional(),
    price: z.union([z.string(), z.number()]).optional(),
    recipient: z.string().optional(),
    payTo: z.string().optional(),
    receiver: z.string().optional(),
    asset: z.string().optional(),
    token: z.string().optional(),
    chain: z.string().optional(),
    chainId: z.number().optional(),
    network: z.string().optional(),
  })
  .passthrough();

export type X402Instruction = {
  recipient: Address;
  amountAtomic: bigint;
  tokenAddress: Address;
  asset: string;
};

function log(msg: string, extra?: Record<string, unknown>) {
  if (extra) console.log(`[helixa-x402] ${msg}`, extra);
  else console.log(`[helixa-x402] ${msg}`);
}

function isHexAddress(v: string): v is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(v);
}

export function parseX402Body(body: unknown): X402Instruction | null {
  const parsed = x402BodySchema.safeParse(body);
  if (!parsed.success) {
    log("parse_failed", { issues: parsed.error.issues.length });
    return null;
  }
  const d = parsed.data;
  const recipientRaw = d.recipient ?? d.payTo ?? d.receiver;
  if (!recipientRaw || !isHexAddress(recipientRaw)) {
    log("missing_or_invalid_recipient");
    return null;
  }
  const amountRaw = d.amountAtomic ?? d.amount ?? d.price;
  if (amountRaw === undefined) {
    log("missing_amount");
    return null;
  }
  let amountAtomic: bigint;
  try {
    if (typeof amountRaw === "number") {
      // If a server returned a decimal USDC amount, convert to atomic units.
      // Heuristic: integers >= 1000 are already atomic; floats / sub-1000
      // integers we treat as USDC-decimal and scale.
      if (Number.isInteger(amountRaw) && amountRaw >= 1000) {
        amountAtomic = BigInt(amountRaw);
      } else {
        amountAtomic = BigInt(Math.round(amountRaw * 10 ** USDC_DECIMALS));
      }
    } else {
      const s = amountRaw.trim();
      if (/^\d+$/.test(s)) {
        amountAtomic = BigInt(s);
      } else {
        const f = parseFloat(s);
        if (!Number.isFinite(f)) throw new Error(`bad number: ${s}`);
        amountAtomic = BigInt(Math.round(f * 10 ** USDC_DECIMALS));
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`amount_parse_failed: ${msg}`);
    return null;
  }

  // Strict chain check: if the 402 instruction names a chain at all, it MUST
  // be Base mainnet. We refuse to pay on any other chain even if a token
  // address happens to look right elsewhere.
  if (d.chainId !== undefined && d.chainId !== BASE_CHAIN_ID) {
    log(`reject_chain_id chainId=${d.chainId} expected=${BASE_CHAIN_ID}`);
    return null;
  }
  if (d.chain !== undefined) {
    const c = d.chain.toLowerCase();
    if (c !== "base" && c !== `eip155:${BASE_CHAIN_ID}` && c !== String(BASE_CHAIN_ID)) {
      log(`reject_chain chain=${d.chain}`);
      return null;
    }
  }
  if (d.network !== undefined) {
    // Only Base-flavored network strings are accepted. Generic "mainnet" is
    // ambiguous (could mean Ethereum mainnet) and is intentionally rejected.
    const n = d.network.toLowerCase();
    if (n !== "base" && n !== "base-mainnet") {
      log(`reject_network network=${d.network}`);
      return null;
    }
  }

  // Strict token check: must be canonical Base USDC. We do NOT honor the
  // server's asset address verbatim because a malformed/compromised 402 could
  // otherwise direct us to transfer arbitrary tokens.
  const tokenRaw = d.asset ?? d.token;
  if (tokenRaw && isHexAddress(tokenRaw)) {
    if (tokenRaw.toLowerCase() !== USDC_BASE.toLowerCase()) {
      log(`reject_token token=${tokenRaw} expected=${USDC_BASE}`);
      return null;
    }
  } else if (tokenRaw) {
    // If asset is a symbol string, only allow USDC.
    const sym = tokenRaw.toUpperCase();
    if (sym !== "USDC" && sym !== "USD-COIN" && sym !== "USDCB") {
      log(`reject_asset_symbol asset=${tokenRaw}`);
      return null;
    }
  }
  const tokenAddress: Address = USDC_BASE;

  // Hard amount cap: refuse anything above X402_MAX_USDC_ATOMIC (5 USDC).
  if (amountAtomic <= 0n) {
    log(`reject_amount_nonpositive amount=${amountAtomic.toString()}`);
    return null;
  }
  if (amountAtomic > X402_MAX_USDC_ATOMIC) {
    log(
      `reject_amount_over_cap amount=${formatUnits(amountAtomic, USDC_DECIMALS)} cap=${formatUnits(X402_MAX_USDC_ATOMIC, USDC_DECIMALS)}`,
    );
    return null;
  }

  return {
    recipient: recipientRaw as Address,
    amountAtomic,
    tokenAddress,
    asset: "USDC",
  };
}

export async function getWalletUsdcBalance(walletAddress: Address): Promise<bigint> {
  const client = getBaseClient();
  const balance = (await client.readContract({
    address: USDC_BASE,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [walletAddress],
  })) as bigint;
  return balance;
}

export async function getWalletEthBalance(walletAddress: Address): Promise<bigint> {
  const client = getBaseClient();
  return await client.getBalance({ address: walletAddress });
}

/**
 * Pay an x402 instruction by transferring USDC on Base from the platform
 * wallet. Returns the transaction hash once the receipt confirms success.
 */
export async function payX402(instr: X402Instruction): Promise<{ txHash: Hex; }> {
  const pk = process.env.HELIXA_BASE_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error("HELIXA_BASE_WALLET_PRIVATE_KEY is not configured");
  const formatted = (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
  const account = privateKeyToAccount(formatted);

  const balance = await getWalletUsdcBalance(account.address);
  if (balance < instr.amountAtomic) {
    throw new Error(
      `Helixa wallet has insufficient USDC: have ${formatUnits(balance, USDC_DECIMALS)}, need ${formatUnits(instr.amountAtomic, USDC_DECIMALS)}`,
    );
  }

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
  });

  const txHash = await walletClient.writeContract({
    address: instr.tokenAddress,
    abi: USDC_ABI,
    functionName: "transfer",
    args: [instr.recipient, instr.amountAtomic],
  });
  log(
    `submitted x402 payment tx=${txHash} amount=${formatUnits(instr.amountAtomic, USDC_DECIMALS)} ${instr.asset} to=${instr.recipient}`,
  );
  const publicClient = getBaseClient();
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`x402 payment tx reverted: ${txHash}`);
  }
  log(`x402 payment confirmed tx=${txHash} block=${receipt.blockNumber}`);
  return { txHash };
}

export const HELIXA_USDC_DECIMALS = USDC_DECIMALS;
export const HELIXA_USDC_BASE_ADDRESS = USDC_BASE;
