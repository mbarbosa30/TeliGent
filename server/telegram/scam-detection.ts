import TelegramBot from "node-telegram-bot-api";
import { storage } from "../storage";
import { log } from "../index";
import type { BotConfig } from "@shared/schema";
import type { BotInstance } from "./types";
import { openai, sendBotMessage } from "./utils";
import { normalizeUnicode, hasHomoglyphEvasion, checkNameImpersonation } from "./normalization";
import { scamPatterns, runAllPatterns, getPatternReason, detectFinancialHypeSignals, isFinancialShillHype } from "./scam-patterns";

export const MIN_SCAM_CHECK_LENGTH = 30;

const STOP_WORDS = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "shall", "can", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between", "out", "off", "over", "under", "again", "further", "then", "once", "here", "there", "when", "where", "why", "how", "all", "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just", "and", "but", "or", "if", "while", "that", "this", "these", "those", "i", "me", "my", "we", "our", "you", "your", "he", "him", "his", "she", "her", "it", "its", "they", "them", "their", "what", "which", "who", "whom"]);

export function extractKeyPhrases(normalizedText: string): string[] {
  const words = normalizedText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
  if (words.length < 2) return words.length > 0 ? [words.join(" ")] : [];
  const phrases: string[] = [];
  for (let i = 0; i <= words.length - 2; i++) {
    phrases.push(words.slice(i, i + 2).join(" "));
  }
  const unique = [...new Set(phrases)];
  return unique.slice(0, 15);
}

const learnedPatternsCache = new Map<number, { patterns: string[]; expiry: number }>();

export function clearLearnedPatternsCache(botConfigId: number) {
  learnedPatternsCache.delete(botConfigId);
}

export async function getLearnedPatterns(botConfigId: number): Promise<string[]> {
  const cached = learnedPatternsCache.get(botConfigId);
  if (cached && Date.now() < cached.expiry) return cached.patterns;
  const records = await storage.getReportedScamPatterns(botConfigId);
  const patterns = records.map(r => r.pattern);
  learnedPatternsCache.set(botConfigId, { patterns, expiry: Date.now() + 5 * 60 * 1000 });
  return patterns;
}

export function checkLearnedPatterns(normalizedText: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const lower = normalizedText.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  let matchCount = 0;
  for (const pattern of patterns) {
    if (lower.includes(pattern)) {
      matchCount++;
      if (matchCount >= 3) return true;
    }
  }
  return false;
}

export async function aiScamCheck(text: string, senderRole: string): Promise<{ isScam: boolean; reason: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content: `You are an aggressive scam detection system for a crypto/Web3 Telegram group. The sender is a REGULAR USER (not an admin). Your job is to PROTECT the community. When in doubt, flag as scam — false positives are better than letting scams through.

A message IS a SCAM/SPAM if it does ANY of these:
- Poses as project leadership or makes official-sounding announcements (migrations, relaunches, contract changes, new CAs, airdrops, etc.)
- Asks people to DM/PM/inbox/contact/message them privately for ANY reason
- Uses "drop me a private message", "send me a message", "reach out to me", "contact me privately" or similar
- Asks for transaction hashes, wallet addresses, private keys, seed phrases, or screenshots of purchases
- Promotes fake airdrops, token swaps, or contract migrations
- Mentions "migration", "airdrop", "recover loss", "boost volume" — regular users don't announce these
- Asks people to connect wallets or click suspicious links
- Offers guaranteed returns, paid promotions, or investment services
- Creates false urgency (act now, limited time, within X hours)
- Promotes other tokens/projects unsolicited (shilling)
- Posts pump hype / financial shill content: multiplier claims (50x, 100x), "low-cap gems", "whales rotating in", "plays loading", "about to moon/explode", FOMO language — regular users don't post unsolicited investment hype
- Shares links to other Telegram groups, channels, or bots
- Offers services like "I can get you investors/listings/volume"
- Offers ANY unsolicited services: design, animation, NFTs, logos, banners, stickers, GIFs, marketing, promotion, community management, development, etc.
- Cold-pitches services nobody asked for (e.g. "I'd love to create X for your project", "I can make Y for you", "I offer Z services")
- Uses flattery followed by a pitch (e.g. "Love your project! I can create...", "Great community! I offer...")
- Claims to own/run a community/group/channel and offers services
- Pitches any kind of paid or free service to the group unsolicited
- Uses homoglyph evasion (replacing letters with look-alikes like I for l, 0 for O) — this is ALWAYS a scam indicator

CRITICAL — GIVEAWAY SCAMS (ALWAYS flag these):
- Any message offering to give/send/distribute crypto (SOL, ETH, BTC, tokens, etc.) to group members — this is ALWAYS a scam
- "I want to give some SOL to the first 5 members" → SCAM
- "Giving away ETH to the community" → SCAM  
- "Contact me with your wallet address" → SCAM
- "First X people to DM/contact/message me get free crypto" → SCAM
- ANY variation of "I will give/send/distribute crypto to people who contact me" → SCAM
- Regular users NEVER legitimately distribute crypto in group chats

EXAMPLES OF SCAMS (flag these):
- "HEY GUYS I WANT TO GIVE SOME SOL TO THE FIRST 5 MEMBERS OF THIS GROUP TO CONTACT ME WITH SOL ADDRESS" → SCAM (crypto giveaway scam)
- "gonna send some BTC to the first 3 holders who reach out" → SCAM (crypto giveaway scam)
- "Love your project! I'd love to create custom 2D/3D crypto meme animations using your mascot" → SCAM (unsolicited service offer)
- "Am working on migration and airdropping of all holders" → SCAM (impersonating authority, fake migration)  
- "Drop me a private message with your tx hash" → SCAM (DM solicitation + asking for tx data)
- "I can design NFTs, logos, banners for your project" → SCAM (unsolicited service pitch)
- "Great project! DM me for promotion services" → SCAM (flattery + service pitch)
- "I'm giving away 1000 USDT to the first 10 people who message me" → SCAM (giveaway scam)
- "I'm eyeing a few low-cap gems that could 50-100x once the whales start rotating in" → SCAM (pump hype / financial shill)
- "New plays loading… don't sleep on this one, about to explode 🔥💸" → SCAM (pump hype / FOMO)

A message is NOT a scam if it's:
- A normal question or discussion about the project
- General crypto discussion without solicitation
- Complaints or criticism (even harsh ones)
- Casual chat, memes, or banter
- Asking about project status WITHOUT making announcements
- Sharing a link directly relevant to an ongoing conversation (not unsolicited)

Respond with ONLY valid JSON: {"scam": true, "reason": "brief explanation"} or {"scam": false, "reason": "brief explanation"}`
        },
        { role: "user", content: text }
      ],
      max_completion_tokens: 100,
    }, { signal: controller.signal as any });

    clearTimeout(timeout);

    const content = response.choices[0]?.message?.content?.trim() || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        log(`AI scam verdict: ${parsed.scam ? "SCAM" : "OK"} — ${parsed.reason || "no reason"} — msg: "${text.substring(0, 60)}"`, "telegram");
        return { isScam: !!parsed.scam, reason: parsed.reason || "" };
      } catch {}
    }
    log(`AI scam check returned unparseable response: ${content.substring(0, 100)}`, "telegram");
    return { isScam: false, reason: "unparseable" };
  } catch (e: any) {
    log(`AI scam check failed: ${e.message}`, "telegram");
    return { isScam: false, reason: "error" };
  }
}

export async function executeScamAction(
  bot: TelegramBot,
  msg: TelegramBot.Message,
  text: string,
  userName: string,
  userId: string,
  botConfigId: number,
  groupRecord: any,
  reason: string
): Promise<boolean> {
  log(`SCAM DETECTED from ${userName} (${reason}): ${text.substring(0, 100)}`, "telegram");

  const tgUserId = msg.from?.id ? String(msg.from.id) : undefined;

  let deleted = false;
  try {
    await bot.deleteMessage(msg.chat.id, msg.message_id);
    deleted = true;
    log(`Deleted scam message from ${userName}`, "telegram");
  } catch (e: any) {
    log(`Could not delete scam message (bot may not be admin): ${e.message}`, "telegram");
  }

  if (!deleted) {
    try {
      await sendBotMessage(bot, msg.chat.id, `⚠️ Warning: The message above from ${userName} looks like a scam/spam. Do NOT click links, send crypto, or DM anyone offering tokens.`);
    } catch (e: any) {
      log(`Could not send scam warning: ${e.message}`, "telegram");
    }
  }

  if (groupRecord) {
    await storage.createActivityLog(botConfigId, userId, {
      groupId: groupRecord.id,
      type: "report",
      telegramUserId: tgUserId,
      userName,
      userMessage: text,
      botResponse: deleted ? "(silently deleted)" : "(warned — could not delete)",
      isReport: true,
      metadata: { autoDetected: true, reason },
    });
  }

  if (tgUserId && deleted) {
    try {
      const config = await storage.getBotConfig(botConfigId);
      if (config && config.autoBanThreshold > 0) {
        const scamCount = await storage.getScamCountForUser(botConfigId, tgUserId);
        if (scamCount >= config.autoBanThreshold) {
          await bot.banChatMember(msg.chat.id, Number(tgUserId));
          log(`AUTO-BANNED user ${userName} (tgId: ${tgUserId}) after ${scamCount} scam deletions (threshold: ${config.autoBanThreshold})`, "telegram");
          if (groupRecord) {
            await storage.createActivityLog(botConfigId, userId, {
              groupId: groupRecord.id,
              type: "report",
              telegramUserId: tgUserId,
              userName,
              userMessage: `Auto-banned after ${scamCount} scam messages`,
              botResponse: "(user banned)",
              isReport: true,
              metadata: { autoDetected: true, reason: `Auto-ban: ${scamCount} scam deletions reached threshold of ${config.autoBanThreshold}` },
            });
          }
        }
      }
    } catch (e: any) {
      log(`Auto-ban check/action failed for ${userName}: ${e.message}`, "telegram");
    }
  }

  return true;
}

export async function detectAndHandleScam(
  bot: TelegramBot,
  msg: TelegramBot.Message,
  text: string,
  userName: string,
  userId: string,
  botConfigId: number,
  config: BotConfig,
  groupRecord: any
): Promise<boolean> {
  try {
    const member = await bot.getChatMember(msg.chat.id, msg.from!.id);
    if (["creator", "administrator"].includes(member.status)) {
      return false;
    }
  } catch (e: any) {
    log(`Could not check sender role: ${e.message}`, "telegram");
  }

  const normalized = normalizeUnicode(text);
  if (normalized !== text) {
    log(`Unicode normalized: "${text.substring(0, 60)}" → "${normalized.substring(0, 60)}"`, "telegram");
  }

  const evasionDetected = hasHomoglyphEvasion(text, normalized);
  if (evasionDetected) {
    log(`Homoglyph evasion detected in message from ${userName}`, "telegram");
  }

  const isImpersonator = checkNameImpersonation(msg, config);
  if (isImpersonator) {
    log(`Name impersonation detected: "${userName}" mimics bot/group name`, "telegram");
  }

  const p = runAllPatterns(normalized, text);
  const hit = (name: string) => p.get(name) === true;

  const hypeSignals = detectFinancialHypeSignals(normalized, text, !!msg.forward_date);
  const hasFinancialShillHypeResult = isFinancialShillHype(hypeSignals);

  const learnedPatterns = await getLearnedPatterns(botConfigId);
  const hasLearnedPatternMatch = checkLearnedPatterns(normalized, learnedPatterns);

  const hasAnyScamSignal =
    hit("migrationAirdropScam") || hit("privateMessageSolicitation") || hit("txHashRequest") ||
    hit("unsolicitedServiceOffer") || hit("cryptoServiceKeywords") || hit("flatteryPitch") ||
    hit("dmSolicitation") || hit("scamOffer") || hit("cryptoGiveawayScam") || hit("aggressiveDmSpam") ||
    hit("emojiDmSolicitation") || hit("pumpPromoSpam") || hit("boostBotPromo") ||
    hit("dmServiceMenu") || hit("serviceListSpam") || hit("coldPitchPromo") ||
    hit("volumeServiceSpam") || hit("tokenCallCard") || hit("channelManagementPitch") ||
    hit("fakeExchangeListing") || hasFinancialShillHypeResult || hit("investmentServicePitch") ||
    hit("revenueSplitScam") || hit("formattedPitchScam") || hasLearnedPatternMatch;

  if (evasionDetected && hasAnyScamSignal) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Homoglyph evasion with scam content (character substitution to bypass filters)");
  }
  if (evasionDetected) {
    log(`Homoglyph evasion without scam keywords — escalating to AI check`, "telegram");
  }
  if (isImpersonator && (hit("migrationAirdropScam") || hit("privateMessageSolicitation") || hit("dmSolicitation"))) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Impersonation + scam (name mimics bot/group)");
  }
  if (hit("migrationAirdropScam")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("migrationAirdropScam"));
  }
  if (hit("privateMessageSolicitation") || (hit("dmSolicitation") && hit("txHashRequest"))) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("privateMessageSolicitation"));
  }
  if (hit("flatteryPitch") || hit("cryptoServiceKeywords") || hit("unsolicitedServiceOffer")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("unsolicitedServiceOffer"));
  }
  if (hit("dmServiceMenu") || hit("serviceListSpam")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("dmServiceMenu"));
  }
  if (hit("coldPitchPromo")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("coldPitchPromo"));
  }
  if (hit("volumeServiceSpam")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("volumeServiceSpam"));
  }
  if (hit("tokenCallCard")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("tokenCallCard"));
  }
  if (hit("channelManagementPitch")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("channelManagementPitch"));
  }
  if (hit("fakeExchangeListing")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("fakeExchangeListing"));
  }
  if (hit("softCollaborationInvite") && (hit("channelManagementPitch") || hit("scamOffer") || hit("coldPitchPromo"))) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("softCollaborationInvite"));
  }
  if (hit("aggressiveDmSpam") || hit("dmWithUsername")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("aggressiveDmSpam"));
  }
  if (hit("insiderCallSpam")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("insiderCallSpam"));
  }
  if (hit("walletBuyingSelling")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("walletBuyingSelling"));
  }
  if (hit("cryptoGiveawayScam")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("cryptoGiveawayScam"));
  }
  if (hit("dmSolicitation") && (hit("scamOffer") || hit("channelManagementPitch"))) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "DM solicitation with scam/promo offer");
  }
  if (hit("sexualSpam") || hit("solicitationSpam")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("sexualSpam"));
  }
  if (hit("telegramInviteLink")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("telegramInviteLink"));
  }
  if (hit("groupPromoShill") || hit("unsolicitedGroupLink")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("groupPromoShill"));
  }
  if (hit("raidShillSpam") || hit("paidServiceSpam") || hit("boostBotPromo")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("raidShillSpam"));
  }
  if (hit("pumpPromoSpam")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Token pump / paid promotion service offer");
  }
  if (hasFinancialShillHypeResult) {
    const fwdTag = hypeSignals.isForwardedMessage ? " [forwarded]" : "";
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, `Financial shill / pump hype spam${fwdTag} (multiplier claims + hype language)`);
  }
  if (hit("investmentServicePitch")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("investmentServicePitch"));
  }
  if (hit("revenueSplitScam")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("revenueSplitScam"));
  }
  if (hit("formattedPitchScam")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("formattedPitchScam"));
  }
  if (hasLearnedPatternMatch) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Matched previously reported scam pattern (learned from /report)");
  }

  const hasUrl = /https?:\/\/|t\.me\//i.test(text);
  const hasCryptoKeywords = /\b(sol|eth|btc|bnb|usdt|usdc|crypto|token|coin|nft|wallet|airdrop|giveaway|give\s*away|migration|migrat(e|ing)|swap|dex|defi|staking|stake|yield|liquidity|rug|pump|dump|shill|raid|shitcoin|memecoin|meme\s*coin|presale|pre\s*sale|whitelist|white\s*list|seed\s*phrase|private\s*key|contract\s*address|ca\b|mint|bridge|chain|blockchain|web3|solana|ethereum|bitcoin|tether|binance|phantom|metamask|ledger|trezor)\b/i.test(normalized);
  const hasDmKeywords = /\b(dm|pm|inbox|private\s*message|contact\s*me|reach\s*out|message\s*me|send\s*me|write\s*me|hit\s*me\s*up)\b/i.test(normalized);
  const hasFinancialKeywords = /\b(invest|profit|trading|signal|call|insider|roi|return|earn|income|passive|guarantee|risk\s*free|double\s*your|triple\s*your|x\d+|\d+[xхΧχ×]\b|moon|lambo)\b/i.test(normalized);
  const needsAiCheck = hasUrl || hasCryptoKeywords || hasDmKeywords || hasFinancialKeywords || isImpersonator || evasionDetected;
  if (!needsAiCheck && normalized.length < MIN_SCAM_CHECK_LENGTH) {
    return false;
  }

  const aiContext = isImpersonator
    ? `[SUSPICIOUS: This user's display name "${userName}" closely matches the bot/group name. Non-admins impersonating official accounts is a common scam tactic. Be extra vigilant.]\n\n${normalized}`
    : normalized;
  const { isScam, reason } = await aiScamCheck(aiContext, "regular_user");
  if (!isScam) {
    if ((reason === "unparseable" || reason === "error") && (hit("softCollaborationInvite") || hit("dmSolicitation") || hit("fakeExchangeListing") || hit("channelManagementPitch") || hasFinancialShillHypeResult || hit("investmentServicePitch"))) {
      log(`AI failed but strong scam signals present — flagging as scam`, "telegram");
      return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "AI unavailable + strong scam signals detected");
    }
    return false;
  }

  const aiReason = isImpersonator ? `AI (impersonator): ${reason}` : `AI: ${reason}`;
  return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, aiReason);
}

export function runDeterministicScamCheck(text: string): { isScam: boolean; reason: string } {
  const normalized = normalizeUnicode(text);
  const p = runAllPatterns(normalized, text);
  const hit = (name: string) => p.get(name) === true;

  if (hit("walletBuyingSelling")) {
    return { isScam: true, reason: "Wallet buying/selling scam — attempting to purchase crypto wallets with transaction history" };
  }

  if (/\b(airdrop|claim|free\s*(token|coin|nft|crypto)|migration|connect\s*(your\s*)?wallet)\b/i.test(normalized) && /https?:\/\//i.test(text)) {
    return { isScam: true, reason: "Airdrop/migration scam with suspicious link" };
  }

  if (hit("fakeExchangeListing")) {
    return { isScam: true, reason: "Fake exchange listing impersonation" };
  }

  if (/\b(dm|pm|inbox|message|contact)\s*(me|us)\b/i.test(normalized) && (/\b(promo|market|boost|pump|shill|volume|listing|invest|fund|capital|otc)\b/i.test(normalized) || /\b(i\s*(can|will)\s*(help|boost|promote|pump|grow|increase))\b/i.test(normalized))) {
    return { isScam: true, reason: "Unsolicited service offer with DM solicitation" };
  }

  if (/\b(i\s*manage|managing)\b.{0,20}\b(channel|communit|group)s?\b/i.test(normalized) && /\b(engag|growth|volume|mc|market\s*cap|member|organic|promot)\b/i.test(normalized)) {
    return { isScam: true, reason: "Channel management cold-pitch spam" };
  }

  if (hit("coldPitchPromo")) {
    return { isScam: true, reason: "Cold-pitch promotion / paid promo service offer" };
  }

  if (hit("volumeServiceSpam")) {
    return { isScam: true, reason: "Volume/liquidity service spam — unsolicited paid service offer" };
  }

  if (hit("tokenCallCard")) {
    return { isScam: true, reason: "Token call card spam — contract address + market data shill" };
  }

  if (hit("revenueSplitScam")) {
    return { isScam: true, reason: "Revenue split scam — percentage split pitch with contact handle" };
  }

  if (hit("formattedPitchScam")) {
    return { isScam: true, reason: "Formatted scam pitch — checkmark bullet list with urgency emojis and contact handle" };
  }

  if (/\b(send|give|transfer)\b.{0,15}\b(sol|eth|btc|usdt|crypto|token|nft)\b.{0,30}\b(receive|get|back|return|double|triple)\b/i.test(normalized)) {
    return { isScam: true, reason: "Crypto doubling/advance fee scam" };
  }

  if (hit("cryptoGiveawayScam")) {
    return { isScam: true, reason: "Fake crypto giveaway scam — DM solicitation with free crypto lure" };
  }

  return { isScam: false, reason: "" };
}
