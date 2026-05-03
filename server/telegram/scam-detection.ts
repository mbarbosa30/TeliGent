import TelegramBot from "node-telegram-bot-api";
import { storage } from "../storage";
import { log } from "../index";
import type { BotConfig } from "@shared/schema";
import type { BotInstance } from "./types";
import { openai, sendBotMessage } from "./utils";
import { tryConsumeAiBudget } from "../ai-budget";
import { normalizeUnicode, hasHomoglyphEvasion, checkNameImpersonation } from "./normalization";
import { scamPatterns, runAllPatterns, getPatternReason, detectFinancialHypeSignals, isFinancialShillHype } from "./scam-patterns";

export const MIN_SCAM_CHECK_LENGTH = 30;

// Pull every piece of human-readable text out of a Telegram message,
// including inline-keyboard button labels and URLs. Classic porn-channel
// and crypto-channel ad forwards put almost all of their payload inside
// inline-keyboard buttons (text + url) and leave message.text empty, so
// scanning only msg.text/caption misses them entirely.
export function extractInlineButtonText(msg: TelegramBot.Message): {
  buttonText: string;
  buttonUrls: string[];
  totalButtons: number;
  externalUrlCount: number;
} {
  const rm = msg.reply_markup;
  if (!rm || !Array.isArray(rm.inline_keyboard)) {
    return { buttonText: "", buttonUrls: [], totalButtons: 0, externalUrlCount: 0 };
  }
  const labels: string[] = [];
  const urls: string[] = [];
  let total = 0;
  for (const row of rm.inline_keyboard) {
    if (!Array.isArray(row)) continue;
    for (const btn of row) {
      total++;
      if (typeof btn.text === "string" && btn.text.trim()) labels.push(btn.text);
      if (typeof btn.url === "string" && btn.url.trim()) urls.push(btn.url);
    }
  }
  let externalUrlCount = 0;
  for (const u of urls) {
    if (/^https?:\/\//i.test(u) || /^t\.me\//i.test(u) || /^tg:\/\//i.test(u)) externalUrlCount++;
  }
  return { buttonText: labels.join(" \n "), buttonUrls: urls, totalButtons: total, externalUrlCount };
}

// Build the full string we hand to the deterministic scam pipeline.
// We deliberately concatenate text + caption + button labels + URLs so
// patterns like nsfwSpam or financial-shill-hype can match against the
// real payload of a button-only forwarded ad.
export function buildScanText(msg: TelegramBot.Message): string {
  const parts: string[] = [];
  if (typeof msg.text === "string" && msg.text.trim()) parts.push(msg.text);
  if (typeof msg.caption === "string" && msg.caption.trim()) parts.push(msg.caption);
  const aux = extractInlineButtonText(msg);
  if (aux.buttonText) parts.push(aux.buttonText);
  if (aux.buttonUrls.length > 0) parts.push(aux.buttonUrls.join(" "));
  return parts.join(" \n ").trim();
}

// Structural spam signal: a forwarded message with a grid of inline
// buttons pointing to many external links is, in practice, almost
// always a spam ad (porn channels, fake giveaways, drainer landing
// pages). We require all three signals so that legitimate forwarded
// posts that happen to have a single CTA button are not deleted.
export function isButtonGridForwardSpam(msg: TelegramBot.Message): boolean {
  const aux = extractInlineButtonText(msg);
  const isForwarded = !!msg.forward_date || !!(msg as TelegramBot.Message & { forward_origin?: unknown }).forward_origin;
  return isForwarded && aux.totalButtons >= 3 && aux.externalUrlCount >= 2;
}

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

const allowlistCache = new Map<number, { entries: { bigrams: string[] }[]; expiry: number }>();

export function clearScamAllowlistCache(botConfigId: number) {
  allowlistCache.delete(botConfigId);
}

export async function getScamAllowlistBigramSets(botConfigId: number): Promise<string[][]> {
  const cached = allowlistCache.get(botConfigId);
  if (cached && Date.now() < cached.expiry) return cached.entries.map(e => e.bigrams);
  const rows = await storage.getScamAllowlist(botConfigId);
  const entries = rows.map(r => ({ bigrams: r.bigrams || [] })).filter(e => e.bigrams.length > 0);
  allowlistCache.set(botConfigId, { entries, expiry: Date.now() + 5 * 60 * 1000 });
  return entries.map(e => e.bigrams);
}

export function matchesScamAllowlist(messageBigrams: string[], allowlistSets: string[][]): boolean {
  if (!messageBigrams.length || !allowlistSets.length) return false;
  const msgSet = new Set(messageBigrams);
  for (const entry of allowlistSets) {
    if (!entry.length) continue;
    let overlap = 0;
    for (const b of entry) if (msgSet.has(b)) overlap++;
    const denom = Math.min(entry.length, messageBigrams.length);
    if (denom >= 3 && overlap / denom >= 0.7) return true;
  }
  return false;
}

export async function getLearnedPatterns(botConfigId: number): Promise<string[]> {
  const cached = learnedPatternsCache.get(botConfigId);
  if (cached && Date.now() < cached.expiry) return cached.patterns;
  const records = await storage.getReportedScamPatterns(botConfigId);
  const patterns = records.map(r => r.pattern);
  learnedPatternsCache.set(botConfigId, { patterns, expiry: Date.now() + 5 * 60 * 1000 });
  return patterns;
}

export function checkLearnedPatterns(normalizedText: string, patterns: string[], minMatches: number = 3): boolean {
  if (patterns.length === 0) return false;
  const lower = normalizedText.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  let matchCount = 0;
  for (const pattern of patterns) {
    if (lower.includes(pattern)) {
      matchCount++;
      if (matchCount >= minMatches) return true;
    }
  }
  return false;
}

export type ScamSensitivity = "low" | "medium" | "high";

export function normalizeSensitivity(value: string | null | undefined): ScamSensitivity {
  if (value === "low" || value === "high") return value;
  return "medium";
}

export function learnedPatternThreshold(sensitivity: ScamSensitivity): number {
  if (sensitivity === "low") return 4;
  if (sensitivity === "high") return 2;
  return 3;
}

export async function aiScamCheck(text: string, senderRole: string, sensitivity: ScamSensitivity = "medium", botConfigId: number = 0): Promise<{ isScam: boolean; reason: string; category: ScamCategory }> {
  if (botConfigId > 0) {
    const allowed = await tryConsumeAiBudget(botConfigId);
    if (!allowed) {
      log(`AI scam check skipped (daily budget exhausted) for bot ${botConfigId}`, "ai-budget");
      return { isScam: false, reason: "ai_budget_exhausted", category: "other" };
    }
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const sensitivityIntro =
      sensitivity === "low"
        ? `You are a careful scam detection system for a crypto/Web3 Telegram group. The sender is a REGULAR USER (not an admin). Your job is to protect the community while AVOIDING false positives. Only flag a message as scam when the scam intent is clear and unambiguous. When uncertain, return scam:false.`
        : sensitivity === "high"
        ? `You are an extremely aggressive scam detection system for a crypto/Web3 Telegram group. The sender is a REGULAR USER (not an admin). Your job is to PROTECT the community at all costs. When in any doubt, flag as scam — false positives are strongly preferred over letting scams through.`
        : `You are a balanced scam detection system for a crypto/Web3 Telegram group. The sender is a REGULAR USER (not an admin). Flag a message as scam when it likely IS a scam based on the criteria below. Allow ambiguous chat, normal questions, and discussion to pass. Only flag clear or likely scams; do not flag merely suspicious or off-topic chatter.`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content: `${sensitivityIntro}

A message IS a SCAM/SPAM if it does ANY of these:
- Poses as project leadership or makes official-sounding announcements (migrations, relaunches, contract changes, new CAs, airdrops, etc.)
- Asks people to DM/PM/inbox/contact/message them privately AND combines that DM ask with at least one money/crypto hook (sending funds, sharing a wallet address, sharing a tx hash, claiming an airdrop or migration swap, receiving "free" crypto, paid promotion/marketing services, insider/VIP signal calls, exchange listings, or anything financial). A bare DM mention with no financial hook is NOT enough on its own — see the LEGITIMATE list below.
- Uses "drop me a private message", "send me a message", "reach out to me", "contact me privately" combined with any of the financial hooks above
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
- A user asking how to add/use/set up the bot or any product/service that belongs to this group — this is legitimate customer interest, NOT a scam
- A user mentioning "my community/group/channel" in the context of wanting to USE the group's product/service (e.g., "I want to add this bot to my community") — this is NOT offering services
- A user asking about pricing, features, or availability of the group's own product

EXAMPLES OF LEGITIMATE MESSAGES (do NOT flag these):
- "How can I add this bot to my community?" → NOT a scam (product interest)
- "I want to use TeliGent for my Telegram group, how do I set it up?" → NOT a scam (customer inquiry)
- "Can I add @BotName to my community? What does it cost?" → NOT a scam (pricing question)
- "I manage a community and I'm looking to add your bot for scam protection" → NOT a scam (product interest, NOT cold-pitch)
- "Does this bot work for groups with 1000+ members?" → NOT a scam (feature question)
- "I sent you a DM going on 8 hours now and you haven't replied" → NOT a scam (frustrated user chasing a moderator, no financial hook)
- "Can you check your DM" / "please check your inbox" → NOT a scam (asking a moderator to read a private message)
- "If you can DM me I will send proof" / "Do you need a prove? I'll send it to your DM" → NOT a scam when the user is offering proof of their OWN issue (missing reward, failed transaction, support question), with no offer of crypto/profit/service in return
- "I will DM the admin about my missing payout" → NOT a scam (legitimate support escalation)
- The rule of thumb: a bare DM mention from a community member who is asking for help, complaining, or following up with moderators is NOT a scam. Only flag DM mentions when they are paired with a clear financial hook from the SCAM list above.

Respond with ONLY valid JSON in this shape:
{"scam": true, "category": "<one of the categories>", "reason": "brief explanation"}
or
{"scam": false, "category": "other", "reason": "brief explanation"}

The "category" field MUST be exactly one of:
"dm_solicitation" (DM/PM ask paired with a financial hook),
"tx_hash_phishing" (asking for tx hashes, screenshots of purchases, proof of transaction),
"airdrop_migration" (fake migration, airdrop, contract swap, relaunch),
"service_pitch" (unsolicited services: design, NFT, logo, marketing, community management, flattery+pitch),
"promo_for_hire" (paid promo, raid/shill, boost, volume service),
"pump_call" (insider/VIP call, multiplier brag, investor access, token call card, investment service),
"giveaway_scam" (offering free crypto/tokens to people who DM/contact),
"nsfw_spam" (porn, adult, sexual solicitation),
"group_promo" (unsolicited Telegram group/channel/invite link promo),
"fake_exchange" (impersonating exchange listing partnership),
"exit_scam" (fake refund, project shutdown lure with DM/hash request),
"wallet_buying" (buying or selling wallets with transaction history),
"impersonation_evasion" (homoglyph/lookalike characters or impersonating bot/team),
"financial_hype" (pump hype, FOMO, low-cap gem shill, multiplier claims),
"other" (anything else, including all NOT-A-SCAM cases — use "other" with scam:false).`
        },
        { role: "user", content: text }
      ],
      max_completion_tokens: 160,
    }, { signal: controller.signal as any });

    clearTimeout(timeout);

    const content = response.choices[0]?.message?.content?.trim() || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const rawCat = typeof parsed.category === "string" ? parsed.category : "other";
        const category: ScamCategory = isScamCategory(rawCat) ? rawCat : "other";
        log(`AI scam verdict: ${parsed.scam ? "SCAM" : "OK"} [${category}] — ${parsed.reason || "no reason"} — msg: "${text.substring(0, 60)}"`, "telegram");
        return { isScam: !!parsed.scam, reason: parsed.reason || "", category };
      } catch {}
    }
    log(`AI scam check returned unparseable response: ${content.substring(0, 100)}`, "telegram");
    return { isScam: false, reason: "unparseable", category: "other" };
  } catch (e: any) {
    log(`AI scam check failed: ${e.message}`, "telegram");
    return { isScam: false, reason: "error", category: "other" };
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
      metadata: { autoDetected: true, reason, category: categorize(reason) },
    });
  }

  if (tgUserId && deleted) {
    try {
      const config = await storage.getBotConfig(botConfigId);
      if (config && config.autoBanThreshold > 0) {
        const scamCount = await storage.getScamCountForUser(botConfigId, tgUserId);
        const signals = getDistinctScamSignals(tgUserId, reason);
        const catList = signals.categories.join(",");
        if (scamCount >= config.autoBanThreshold && signals.count >= 2) {
          await bot.banChatMember(msg.chat.id, Number(tgUserId));
          log(`AUTO-BANNED user ${userName} (tgId: ${tgUserId}) after ${scamCount} scam deletions, ${signals.count} distinct categories [${catList}] (threshold: ${config.autoBanThreshold})`, "telegram");
          if (groupRecord) {
            await storage.createActivityLog(botConfigId, userId, {
              groupId: groupRecord.id,
              type: "report",
              telegramUserId: tgUserId,
              userName,
              userMessage: `Auto-banned after ${scamCount} scam messages (${signals.count} distinct categories: ${catList})`,
              botResponse: "(user banned)",
              isReport: true,
              metadata: { autoDetected: true, reason: `Auto-ban: ${scamCount} scam deletions, ${signals.count} distinct categories [${catList}] reached threshold of ${config.autoBanThreshold}`, categories: signals.categories },
            });
          }
        } else if (scamCount >= config.autoBanThreshold && signals.count < 2) {
          log(`Auto-ban deferred for ${userName} (tgId: ${tgUserId}): ${scamCount} deletions but only ${signals.count} distinct category [${catList}] — may be false positive`, "telegram");
        }
      }
    } catch (e: any) {
      log(`Auto-ban check/action failed for ${userName}: ${e.message}`, "telegram");
    }
  }

  return true;
}

export function isProductInterestMessage(normalized: string, config: BotConfig, botUsername?: string): boolean {
  const botName = (config.botName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const normLower = normalized.toLowerCase();
  if (botName.length < 3 && (!botUsername || botUsername.length < 3)) return false;
  const normClean = normLower.replace(/[^a-z0-9]/g, "");
  const mentionsBot = (botName.length >= 3 && normClean.includes(botName)) ||
    (botUsername && botUsername.length >= 3 && normLower.includes(`@${botUsername.toLowerCase()}`));
  if (!mentionsBot) return false;
  const hasInterestLanguage = /\b(how\s*(do|can|to)|want\s*to\s*(add|use|set\s*up|install|integrate|try|get|enable|activate)|can\s*i\s*(add|use|set\s*up|install|integrate|try|get|enable|activate)|add\s*(it|this|the\s*bot|your\s*bot)|set\s*(it\s*)?up|interested\s*in|looking\s*(to|for)\s*(add|use|integrate|try)|where\s*(do|can)\s*i|tell\s*me\s*(about|how)|need\s*help\s*(with|setting|adding)|what\s*(does|is)|is\s*(it|this)\s*(free|available)|pricing|plans?|features?)\b/i.test(normalized);
  if (!hasInterestLanguage) return false;
  const hasScamIndicators =
    /\b(dm|pm|inbox|contact)\s*(me|us)\b/i.test(normalized) ||
    /\b(guaranteed|profit|return|free\s*(token|coin|crypto|eth|btc|sol))\b/i.test(normalized) ||
    /\b(send\s*(me|us)\s*(a\s*)?(message|msg|dm|pm))\b/i.test(normalized) ||
    /\b(giveaway|give\s*away|airdrop|migration)\b/i.test(normalized) ||
    /\b(i\s*(can|will|offer|provide)\s*(create|make|design|build|boost|promote|pump))\b/i.test(normalized) ||
    /https?:\/\//i.test(normalized) ||
    /(?:t\.me|telegram\.me)\/(\+|joinchat\/)/i.test(normalized);
  return !hasScamIndicators;
}

// Stable category enum used for the auto-ban "distinct patterns required"
// safeguard. Free-text AI rationales paraphrase the same root behavior in
// many ways ("Asks to send proof via DM" vs. "Requests private contact/DM"),
// so we collapse them down to one of these tags before counting distinct
// signals against a user. The AI classifier emits the tag explicitly via a
// `[cat:xxx]` prefix; deterministic patterns are mapped via the substring
// matchers in `categorize` below.
export type ScamCategory =
  | "dm_solicitation"
  | "tx_hash_phishing"
  | "airdrop_migration"
  | "service_pitch"
  | "promo_for_hire"
  | "pump_call"
  | "giveaway_scam"
  | "nsfw_spam"
  | "group_promo"
  | "fake_exchange"
  | "exit_scam"
  | "wallet_buying"
  | "impersonation_evasion"
  | "financial_hype"
  | "button_grid_spam"
  | "learned_pattern"
  | "other";

const ALL_SCAM_CATEGORIES: readonly ScamCategory[] = [
  "dm_solicitation", "tx_hash_phishing", "airdrop_migration", "service_pitch",
  "promo_for_hire", "pump_call", "giveaway_scam", "nsfw_spam", "group_promo",
  "fake_exchange", "exit_scam", "wallet_buying", "impersonation_evasion",
  "financial_hype", "button_grid_spam", "learned_pattern", "other",
];

function isScamCategory(value: string): value is ScamCategory {
  return (ALL_SCAM_CATEGORIES as readonly string[]).includes(value);
}

export function categorize(reason: string): ScamCategory {
  // AI-emitted categories carry an explicit [cat:xxx] prefix that we
  // attach in the action layer, so we trust those first.
  const tagMatch = reason.match(/\[cat:([a-z_]+)\]/);
  if (tagMatch && isScamCategory(tagMatch[1])) return tagMatch[1];
  const r = reason.toLowerCase();
  if (/homoglyph|impersonat/.test(r)) return "impersonation_evasion";
  if (/button.{0,5}grid|forwarded ad with multiple inline/.test(r)) return "button_grid_spam";
  if (/migration|airdrop/.test(r)) return "airdrop_migration";
  if (/giveaway|free crypto|free\s*(token|coin|nft)/.test(r)) return "giveaway_scam";
  if (/nsfw|adult|porn|sexual/.test(r)) return "nsfw_spam";
  if (/exchange listing|fake exchange/.test(r)) return "fake_exchange";
  if (/exit scam|fake refund|refund/.test(r)) return "exit_scam";
  if (/wallet buying|wallet selling|buying.{0,15}wallet/.test(r)) return "wallet_buying";
  if (/learned/.test(r)) return "learned_pattern";
  if (/financial shill|pump hype|hype spam/.test(r)) return "financial_hype";
  if (/promo.for.hire|paid promo|raid|shill|boost|pump.{0,10}promotion|volume.{0,10}service/.test(r)) return "promo_for_hire";
  if (/vip call|insider|testimonial|investor|investment service|token call card|pump call|call card/.test(r)) return "pump_call";
  if (/group.{0,15}(promo|invite|link|channel)|telegram (invite|group|channel)/.test(r)) return "group_promo";
  if (/tx hash|transaction hash|proof of (purchase|transaction)/.test(r)) return "tx_hash_phishing";
  if (/service|pitch|cold.pitch|management|flattery|menu/.test(r)) return "service_pitch";
  if (/dm|pm|private message|inbox|solicitation/.test(r)) return "dm_solicitation";
  return "other";
}

const recentScamReasons = new Map<string, { categories: Set<ScamCategory>; firstSeen: number }>();

function getDistinctScamSignals(tgUserId: string, newReason: string): { count: number; categories: ScamCategory[] } {
  const key = tgUserId;
  const now = Date.now();
  let entry = recentScamReasons.get(key);
  if (!entry || now - entry.firstSeen > 30 * 60 * 1000) {
    entry = { categories: new Set<ScamCategory>(), firstSeen: now };
    recentScamReasons.set(key, entry);
  }
  entry.categories.add(categorize(newReason));
  return { count: entry.categories.size, categories: Array.from(entry.categories) };
}

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, entry] of recentScamReasons) {
    if (entry.firstSeen < cutoff) recentScamReasons.delete(key);
  }
}, 10 * 60 * 1000);

export async function detectAndHandleScam(
  bot: TelegramBot,
  msg: TelegramBot.Message,
  text: string,
  userName: string,
  userId: string,
  botConfigId: number,
  config: BotConfig,
  groupRecord: any,
  botUsername?: string
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

  if (isProductInterestMessage(normalized, config, botUsername)) {
    log(`Product interest message from ${userName} — skipping scam check`, "telegram");
    return false;
  }

  try {
    const allowlistSets = await getScamAllowlistBigramSets(botConfigId);
    if (allowlistSets.length > 0) {
      const messageBigrams = extractKeyPhrases(normalized);
      if (matchesScamAllowlist(messageBigrams, allowlistSets)) {
        log(`Scam allowlist match — skipping scam check for "${text.substring(0, 60)}"`, "telegram");
        return false;
      }
    }
  } catch (e: any) {
    log(`Scam allowlist check failed: ${e.message}`, "telegram");
  }
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

  const sensitivity = normalizeSensitivity(config.scamSensitivity);
  const learnedPatterns = await getLearnedPatterns(botConfigId);
  const hasLearnedPatternMatch = checkLearnedPatterns(normalized, learnedPatterns, learnedPatternThreshold(sensitivity));

  const buttonGridSpam = isButtonGridForwardSpam(msg);

  const hasAnyScamSignal =
    hit("nsfwSpam") || buttonGridSpam ||
    hit("migrationAirdropScam") || hit("privateMessageSolicitation") || hit("txHashRequest") ||
    hit("unsolicitedServiceOffer") || hit("cryptoServiceKeywords") || hit("flatteryPitch") ||
    hit("dmSolicitation") || hit("scamOffer") || hit("cryptoGiveawayScam") || hit("aggressiveDmSpam") ||
    hit("emojiDmSolicitation") || hit("pumpPromoSpam") || hit("boostBotPromo") ||
    hit("dmServiceMenu") || hit("serviceListSpam") || hit("coldPitchPromo") ||
    hit("promoForHireSpam") || hit("volumeServiceSpam") || hit("tokenCallCard") || hit("channelManagementPitch") ||
    hit("fakeExchangeListing") || hasFinancialShillHypeResult || hit("investmentServicePitch") ||
    hit("revenueSplitScam") || hit("formattedPitchScam") || hasLearnedPatternMatch ||
    hit("vipCallBrag") || hit("testimonialProfitHype") || hit("fakeRefundExitScam") ||
    hit("investorAccessPitch") || hit("channelForHirePromo");

  if (evasionDetected && hasAnyScamSignal) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Homoglyph evasion with scam content (character substitution to bypass filters)");
  }
  if (evasionDetected) {
    log(`Homoglyph evasion without scam keywords — escalating to AI check`, "telegram");
  }
  if (isImpersonator && (hit("migrationAirdropScam") || hit("privateMessageSolicitation") || hit("dmSolicitation"))) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Impersonation + scam (name mimics bot/group)");
  }
  if (hit("nsfwSpam")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("nsfwSpam"));
  }
  if (buttonGridSpam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Forwarded ad with multiple inline buttons and external links (button-grid spam)");
  }
  if (hit("fakeRefundExitScam")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("fakeRefundExitScam"));
  }
  if (hit("migrationAirdropScam")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("migrationAirdropScam"));
  }
  // Bare "DM/PM/private message me" phrasing is too benign on its own to
  // auto-action — frustrated users chasing moderators legitimately use the
  // same wording (see the MiniPlay false-positive incident). Require a
  // corroborating financial / phishing signal alongside the DM ask. The
  // first `privateMessageSolicitation` regex branch (bare DM) was the FP
  // source; the second branch (DM + tx/hash/screenshot/purchase) still
  // fires here because it co-matches `txHashRequest` or one of the other
  // financial signals on the same message.
  const dmAsk = hit("privateMessageSolicitation") || hit("dmSolicitation");
  const dmFinancialHook =
    hit("txHashRequest") ||
    hit("migrationAirdropScam") ||
    hit("walletBuyingSelling") ||
    hit("cryptoGiveawayScam") ||
    hit("scamOffer") ||
    hasFinancialShillHypeResult;
  if (dmAsk && dmFinancialHook) {
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
  if (hit("promoForHireSpam")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("promoForHireSpam"));
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
  if (hit("vipCallBrag")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("vipCallBrag"));
  }
  if (hit("testimonialProfitHype")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("testimonialProfitHype"));
  }
  if (hit("investorAccessPitch")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("investorAccessPitch"));
  }
  if (hit("channelForHirePromo")) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, getPatternReason("channelForHirePromo"));
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
  const { isScam, reason, category } = await aiScamCheck(aiContext, "regular_user", sensitivity, botConfigId);
  if (!isScam) {
    const hasSoftSignals = hit("softCollaborationInvite") || hit("dmSolicitation") || hit("fakeExchangeListing") || hit("channelManagementPitch") || hasFinancialShillHypeResult || hit("investmentServicePitch");
    if (sensitivity !== "low" && (reason === "unparseable" || reason === "error") && hasSoftSignals) {
      log(`AI failed but strong scam signals present — flagging as scam`, "telegram");
      return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "AI unavailable + strong scam signals detected");
    }
    if (sensitivity === "low" && hasSoftSignals && groupRecord) {
      try {
        await storage.createActivityLog(botConfigId, userId, {
          groupId: groupRecord.id,
          type: "report",
          telegramUserId: msg.from?.id ? String(msg.from.id) : undefined,
          userName,
          userMessage: text,
          botResponse: "(soft signal — not deleted, low sensitivity)",
          isReport: true,
          metadata: { autoDetected: false, softSignal: true, sensitivity, aiVerdict: reason || "not_scam" },
        });
      } catch (e: any) {
        log(`Failed to log low-sensitivity soft signal: ${e.message}`, "telegram");
      }
    }
    return false;
  }

  const aiReason = isImpersonator
    ? `AI (impersonator) [cat:${category}]: ${reason}`
    : `AI [cat:${category}]: ${reason}`;
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

  if (/\b(i\s*manage|managing)\b.{0,20}\b(channel|communit|group)s?\b/i.test(normalized) && /\b(engag|growth|volume|mc|market\s*cap|organic|promot)\b/i.test(normalized) && /\b(dm|pm|inbox|contact|offer|service|provid|deliver|boost|can\s*help|will\s*help)\b/i.test(normalized)) {
    return { isScam: true, reason: "Channel management cold-pitch spam" };
  }

  if (hit("coldPitchPromo")) {
    return { isScam: true, reason: "Cold-pitch promotion / paid promo service offer" };
  }

  if (hit("promoForHireSpam")) {
    return { isScam: true, reason: "Promo-for-hire spam — paid promotion service pitch" };
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

  if (hit("fakeRefundExitScam")) {
    return { isScam: true, reason: "Fake refund / exit scam — shutdown announcement with DM/hash request" };
  }

  if (hit("vipCallBrag")) {
    return { isScam: true, reason: "VIP call / insider trading brag spam — multiplier claims with call results" };
  }

  if (hit("testimonialProfitHype")) {
    return { isScam: true, reason: "Testimonial profit hype spam — fake profit claims with urgency" };
  }

  if (hit("investorAccessPitch")) {
    return { isScam: true, reason: "Investor access pitch spam — offering investor network for token promotion" };
  }

  if (hit("channelForHirePromo")) {
    return { isScam: true, reason: "Channel-for-hire promotion spam — offering channels for paid shilling" };
  }

  return { isScam: false, reason: "" };
}
