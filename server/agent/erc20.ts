import { createWalletClient, createPublicClient, http, parseAbi, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, celo } from "viem/chains";

const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
]);

export type RewardChain = "base" | "celo";

export function getChainConfig(chain: RewardChain) {
  return chain === "celo" ? celo : base;
}

export function getRewardWalletKey(chain: RewardChain): { key: string; source: "base" | "celo" | "fallback" } {
  if (chain === "base") {
    const baseKey = process.env.BASE_WALLET_PRIVATE_KEY;
    if (baseKey) return { key: baseKey, source: "base" };
    const celoKey = process.env.CELO_WALLET_PRIVATE_KEY;
    if (celoKey) return { key: celoKey, source: "fallback" };
    throw new Error("No wallet key configured (BASE_WALLET_PRIVATE_KEY or CELO_WALLET_PRIVATE_KEY).");
  }
  const celoKey = process.env.CELO_WALLET_PRIVATE_KEY;
  if (!celoKey) throw new Error("CELO_WALLET_PRIVATE_KEY is not configured.");
  return { key: celoKey, source: "celo" };
}

export function getRewardWalletAddress(chain: RewardChain): { address: Address; source: string } {
  const { key, source } = getRewardWalletKey(chain);
  const formatted = (key.startsWith("0x") ? key : `0x${key}`) as Hex;
  const account = privateKeyToAccount(formatted);
  return { address: account.address, source };
}

export function decimalToUnits(amount: string, decimals: number): bigint {
  const cleaned = amount.trim();
  if (!cleaned || cleaned === "0") return 0n;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new Error(`Invalid amount: ${amount}`);
  const [intPart, fracPart = ""] = cleaned.split(".");
  const fracPadded = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(intPart + fracPadded);
}

export async function transferErc20(opts: {
  chain: RewardChain;
  tokenAddress: string;
  recipient: string;
  amount: string;
  decimals: number;
}): Promise<{ txHash: string; explorerUrl: string }> {
  const { chain, tokenAddress, recipient, amount, decimals } = opts;
  if (!/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) throw new Error(`Invalid token address: ${tokenAddress}`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) throw new Error(`Invalid recipient address: ${recipient}`);

  const units = decimalToUnits(amount, decimals);
  if (units <= 0n) throw new Error(`Amount must be > 0 (got ${amount})`);

  const { key } = getRewardWalletKey(chain);
  const formatted = (key.startsWith("0x") ? key : `0x${key}`) as Hex;
  const account = privateKeyToAccount(formatted);
  const chainCfg = getChainConfig(chain);

  const walletClient = createWalletClient({ account, chain: chainCfg, transport: http() });
  const publicClient = createPublicClient({ chain: chainCfg, transport: http() });

  const txHash = await walletClient.writeContract({
    address: tokenAddress as Address,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [recipient as Address, units],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`Token transfer reverted: ${txHash}`);

  const explorerUrl = chain === "base"
    ? `https://basescan.org/tx/${txHash}`
    : `https://celoscan.io/tx/${txHash}`;
  return { txHash, explorerUrl };
}

export async function getTokenBalance(chain: RewardChain, tokenAddress: string, holder: string): Promise<bigint> {
  const chainCfg = getChainConfig(chain);
  const publicClient = createPublicClient({ chain: chainCfg, transport: http() });
  return publicClient.readContract({
    address: tokenAddress as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [holder as Address],
  });
}
