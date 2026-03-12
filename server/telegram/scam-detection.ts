import TelegramBot from "node-telegram-bot-api";
import { storage } from "../storage";
import { log } from "../index";
import type { BotConfig } from "@shared/schema";
import type { BotInstance } from "./types";
import { openai, sendBotMessage } from "./utils";
import { normalizeUnicode, hasHomoglyphEvasion, checkNameImpersonation } from "./normalization";

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
      model: "gpt-5-mini",
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

  const hasMigrationAirdropScam = /\b(migrat(ion|ing|e)|airdrop(ping|s)?)\b.{0,60}\b(holder|hoIder|volume|voIume|loss|Ioss|recover|boost|all)\b/i.test(normalized) ||
    /\b(recover|boost)\b.{0,30}\b(loss|volume|price)\b/i.test(normalized) ||
    /\b(drop\s*(event|alert|claim|link|distribution))\b.{0,60}\b(holder|member|exclusively|private|select)\b/i.test(normalized) ||
    (/\b(hosting|holding|launching|announcing)\b.{0,30}\b(drop|airdrop)\b/i.test(normalized) && /\b(holder|member|private|exclusive|select)\b/i.test(normalized)) ||
    /\b(working\s*on|announcing|starting)\s*(a\s*)?(migration|airdrop|token\s*swap|contract\s*change)\b/i.test(normalized) ||
    /\b(re\s*launch|relaunch)(ed|ing)?\b.{0,40}\b(token|contract|v2|v3)\b/i.test(normalized) ||
    (/1\s*:\s*1/.test(text) && /\btoken/i.test(text) && /\b(relaunch|re.?launch|recieve|receive|swap|migrat|airdrop|claim)\b/i.test(text)) ||
    (/\b(halt|apologiz|ceas|shut.?down|wind.?down|discontinu)\b/i.test(text) && /\btoken/i.test(text) && /\b(relaunch|re.?launch|recieve|receive|fairness|1\s*:\s*1)\b/i.test(text)) ||
    /\b(v2|v3)\s*(token|contract|launch|version)\b.{0,40}\b(swap|migrat|airdrop|claim|new\s*ca|clean\s*ca)\b/i.test(normalized) ||
    /\b(swap|exchange|convert)\s*(your\s*)?(old\s*)?(token|holding)\b.{0,40}\b(new|v2|v3|airdrop|claim)\b/i.test(normalized) ||
    /\b(new|clean)\s*(ca|contract\s*address)\b.{0,40}\b(swap|migrat|airdrop|token|claim|hold)\b/i.test(normalized) ||
    /\b(dm|pm|message|inbox|send)\b.{0,30}\b(proof|screenshot|address|wallet)\b.{0,30}\b(hold|token|airdrop|swap|claim)\b/i.test(normalized) ||
    /\b(hold|token|airdrop)\b.{0,30}\b(dm|pm|message|inbox|send)\b.{0,30}\b(proof|screenshot|address|wallet)\b/i.test(normalized) ||
    /\b(send|show|share)\b.{0,20}\b(screenshot|proof|address)\b.{0,30}\b(token|hold|buy|purchase|airdrop)\b/i.test(normalized);

  const hasPrivateMessageSolicitation = /\b(private\s*message|send\s*me\s*(a\s*)?(message|msg)|drop\s*(me\s*)?(a\s*)?(message|msg|line|dm|pm)|reach\s*out\s*to\s*me|contact\s*me\s*(privately|directly)|write\s*me\s*(a\s*)?(message|privately|directly))\b/i.test(normalized) ||
    /\b(private|direct)\s*(message|msg|chat)\b.{0,20}\b(with|your|tx|hash|screenshot|purchase)\b/i.test(normalized);

  const hasTxHashRequest = /\b(tx\s*hash|transaction\s*hash|screenshot\s*of\s*(your\s*)?(purchase|transaction|buy|tx)|proof\s*of\s*(purchase|transaction|buy))\b/i.test(normalized);

  const hasUnsolicitedServiceOffer =
    /\b(i('d| would)?\s*(love|like)\s*to\s*(create|make|design|build|develop|offer|support|help|assist|handle|manage))\b/i.test(normalized) ||
    /\b(i\s*(can|will|offer|provide|specialize|do)\s*(create|make|design|build|develop|custom|professional))\b/i.test(normalized) ||
    /\b(i\s*speciali[sz]e\s*in)\b.{0,40}\b(engag|moderat|communit|management|growth|fud|support|marketing|promot|discussion|organiz)/i.test(normalized) ||
    /\b(hire\s*me|my\s*services|my\s*portfolio|check\s*my\s*(work|portfolio|profile))\b/i.test(normalized) ||
    /\b(looking\s*for\s*(a\s*)?(designer|developer|animator|artist|creator)\s*\?\s*i)\b/i.test(normalized) ||
    /\b(alongside\s*your\s*(bot|team|mod|admin))\b/i.test(normalized) ||
    /\b(turn(ing)?\s*(passive|quiet|inactive)\s*(member|user|viewer)s?\s*into\s*(active|engag))/i.test(normalized) ||
    /\b(maximize|increase|drive|boost)\s*(engag|trust|growth|retention|activit)/i.test(normalized) && /\b(your\s*(community|group|project|channel)|i('d| would| can| will))\b/i.test(normalized);

  const hasCryptoServiceKeywords = /\b(nft|logo|banner|sticker|gif|animation|mascot|meme\s*(coin|token|animation)|dex\s*banner|coin\s*logo|token\s*logo|2d|3d)\b/i.test(normalized) &&
    /\b(creat|design|make|build|custom|your\s*(project|token|coin|mascot))\b/i.test(normalized);

  const hasFlattery = /\b(love\s*your|great\s*(project|community|token)|amazing\s*(project|community|token)|awesome\s*(project|community))\b/i.test(normalized);
  const hasServicePitch = /\b(creat|design|make|build|develop|offer|provid|along\s*with|services?)\b/i.test(normalized) &&
    /\b(nft|logo|banner|sticker|gif|animation|mascot|emoji|promot|market|listing|website|app|bot|smart\s*contract)\b/i.test(normalized);
  const hasFlatteryPitch = hasFlattery && hasServicePitch;

  const hasDmSolicitation = /\b(dm|pm|inbox|message|contact)\s*(me|us)\b|\bsend\s*(me\s*)?(a\s*)?(dm|pm|message)\b|\b(inbox|dm|pm)\b.*\b(for|me)\b|\bshould\s*(dm|pm|message|inbox)\b|\b(dm|pm)\s*(to|for)\s*(discuss|talk|chat|collaborate|partner|detail|info|more|inquir)/i.test(normalized);
  const hasSoftCollaborationInvite = /\b(let\s*me\s*know|reach\s*out|get\s*in\s*touch|open\s*to)\s*.{0,20}\b(collaborat|partner|work\s*together|discuss|interest)/i.test(normalized) ||
    /\b(who(m)?\s*should\s*i\s*contact|who(m)?\s*can\s*i\s*(talk|speak|reach)|who(m)?\s*(to|should\s*i)\s*(contact|message|reach))\b/i.test(normalized);
  const exchangeNames = /\b(binance|biconomy|okx|kucoin|bybit|gate\.?io|mexc|huobi|htx|bitget|bitmart|lbank|poloniex|crypto\.?com|coinbase|kraken|gemini|weex|xt\.?com|phemex|upbit|bithumb|bitfinex)\b/i;
  const hasFakeExchangeListing = (
    /\b(official\s*represent\w*|represent\w*\s*(of|from)|partner\s*(of|from)|agent\s*(of|from)|ambassador\s*(of|for|from)|(i'?m|we'?re|i\s*am|we\s*are)\s*.{0,15}(from|at|with))\b/i.test(normalized) && exchangeNames.test(normalized)
  ) || (
    exchangeNames.test(normalized) && /\b(listing\s*(proposal|cooperat|opportunit))\b/i.test(normalized) &&
    /\b(contact|whom|who|reach|discuss|dm|pm)\b/i.test(normalized)
  ) || (
    /\bverify\b.{0,30}\b(bio|identity)\b/i.test(normalized) && exchangeNames.test(normalized) &&
    /\b(official|represent\w*|partner|agent|ambassador|listing|contact)\b/i.test(normalized)
  );
  const serviceMenuKeywordsGlobal = /\b(sticker|logo|banner|meme|gif|emoji|animation|video|website|white\s*paper|whitepaper|buybot|buy\s*bot|drawing|promo|design|nft|mascot|flyer|poster|thumbnail|graphic|branding|merch)s?\b/ig;
  const serviceMenuCount = (normalized.match(serviceMenuKeywordsGlobal) || []).length;
  const hasDmServiceMenu = /\b(dm|pm|inbox|message|contact)\s*.{0,20}@\w+/i.test(normalized) && serviceMenuCount >= 2;
  const hasServiceListSpam = serviceMenuCount >= 3 && /\b(dm|pm|inbox|message|contact|order|hire|available|and\s*more)\b/i.test(normalized);
  const hasScamOffer = /\b(promot|promo\b|engag|market|listing|volume|investor|communit(y|ies).*\b(own|run|manag|lead)|(own|run|manag|lead).*\bcommunit(y|ies)|\d+\s*(eth|btc|usdt|bnb|sol)\b|free\s*(token|coin|airdrop|eth|btc|crypto)|guaranteed\s*(return|profit))\b/i.test(normalized);
  const wordNumbers = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|several|multiple|many|various|numerous|large|huge|big)/i;
  const channelManagementClaim = /\b(i\s+|we\s+)(manage|run|lead|operat|head|built)\w*\s+/i.test(normalized) &&
    (wordNumbers.test(normalized) || /\d+/.test(text)) &&
    /\b(channel|communit|group|chat)\w*\b/i.test(normalized);
  const channelManagementNoNumber = /\b(i\s+|we\s+)(manage|run|lead|operat|head)\w*\s+(active\s+|trusted\s+|large\s+|big\s+|whale\s+|crypto\s+|trading\s+|investor\s+)*(channel|communit|group|chat)/i.test(normalized);
  const marketingBuzzwords = /\b(engag|volume|growth|grow\s*(faster|quick)|mc\b|market\s*cap|investor|serious\s*investor|right\s*audience|sustain|expan|promot|boost|collaborat|partner|listing\s*cooperat)/i.test(normalized);
  const hasChannelManagementPitch = (channelManagementClaim || channelManagementNoNumber) && marketingBuzzwords;
  const hasColdPitchPromo = /\b(promo|promot(e|ion|ing)|market(ing)?|boost(ing)?|advertis(e|ing)|shill(ing)?)\s*.{0,30}\b(your|ur)\s*(project|token|coin|community|group|channel)\b/i.test(normalized) ||
    /\b(we\s*(will|can|offer|provide|do)|i\s*(will|can|offer|provide|do))\s*(promo|promot(e|ion|ing)|market(ing)?|boost(ing)?|advertis(e|ing)|shill(ing)?|trend(ing)?|list(ing)?)\s*.{0,20}\b(your|ur)\b/i.test(normalized) ||
    /\b(low\s*cost|cheap|affordable|best\s*price|discount|free\s*trial)\b.{0,40}\b(promo|promot|market|boost|advertis|listing|trending)/i.test(normalized) ||
    /\b(promo|promot|market|boost|advertis|listing|trending)\b.{0,40}\b(low\s*cost|cheap|affordable|best\s*price|discount|free\s*trial)/i.test(normalized) ||
    /\b(top|best|big|major)\s*(channel|group|platform)s?\b.{0,30}\b(low\s*cost|cheap|affordable|promo|promot|advertis)/i.test(normalized) ||
    (/\b(crypto\s*project|your\s*(project|token|coin|brand))\b/i.test(normalized) && /\b(growth|exposure|followers?|campaign|media\s*kit|viral)\b/i.test(normalized)) ||
    (/\b(elevat|grow|scale|skyrocket|supercharg|amplif|maximiz)\w*\s*(your|ur)\s*(crypto|project|token|coin|brand|community)\b/i.test(normalized)) ||
    (/\b(media\s*kit|rate\s*card|pricing\s*sheet)\b/i.test(normalized) && /\b(campaign|promo|promot|advertis|partner|collaborat)\b/i.test(normalized)) ||
    (/\b(partner\s*with)\b/i.test(normalized) && /\b(growth|exposure|followers?|viral|engag|massive|authentic)\b/i.test(normalized) && /\b(crypto|tiktok|twitter|youtube|influenc)\b/i.test(normalized)) ||
    (/\b\d+[\s,]*\d*(?:[kKmM])?\+?\s*(followers?|subscribers?|members?|audience|enthusiasts?)\b/i.test(text) && /\b(crypto|project|token|coin|campaign|promo|growth|exposure)\b/i.test(normalized) && /\b(partner|collaborat|promot|advertis|offer|provide|elevat|grow|boost|media\s*kit|campaign|viral|drop\s*(us|me)\s*(a\s*)?message)\b/i.test(normalized));
  const hasVolumeServiceSpam = (/\b(i\s*(will|can)|we\s*(will|can))\s*(provide|offer|deliver|generate|create|make|do|give|bring|get)\b/i.test(normalized) && /\b(volume|liquidity|trading|holders?|pin\s*post)\b/i.test(normalized) && /\b(my\s*(community|channel|group)|check\s*out|support)\b/i.test(normalized)) ||
    (/\b(i\s*(will|can)|we\s*(will|can))\s*(provide|offer|deliver|generate)\b.{0,30}\b\d+[-–—]\d+k?\s*(volume|liquidity|holders?)\b/i.test(text)) ||
    (/\b(pin\s*post|pinned\s*post)\b/i.test(normalized) && /\b(my\s*(community|channel|group))\b/i.test(normalized) && /\b(volume|support|promo|boost|service)\b/i.test(normalized));
  const hasTokenCallCard = (/0x[a-f0-9]{40}/i.test(text) && /\b(vol|volume|mc|market\s*cap|liq|liquidity)\b/i.test(text)) ||
    (/0x[a-f0-9]{40}/i.test(text) && /[+\-]\d+[\d.]*%/.test(text) && /\b(safety|score|audit)\b/i.test(text)) ||
    (/\b(vol|volume)\b.{0,15}\b(mc|market\s*cap)\b/i.test(text) && /\b(liq|liquidity)\b/i.test(text) && /[+\-]\d+[\d.]*%/.test(text) && (/0x[a-f0-9]{40}/i.test(text) || /[📊💹💰📋🔗]/.test(text))) ||
    (/\b(CA|contract)\b.{0,20}(0x[a-f0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})/i.test(text) && /\b(vol|volume|mc|market\s*cap|liq|liquidity|pump)\b/i.test(text));
  const hasCryptoGiveawayScam = /\b(giv(e|ing)\s*(away|out|free|you|them|my))\b.{0,40}\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i.test(normalized) ||
    /\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b.{0,40}\b(giv(e|ing)\s*(away|out|free))\b/i.test(normalized) ||
    /\b(first\s*\d+(\s*(lucky\s*)?(people|person|member|holder|user|follower)s?)?)\b.{0,60}\b(sol|eth|btc|bnb|usdt|crypto|token|coin|give|free|win|claim|airdrop)\b/i.test(text) ||
    (/\b(first\s*\d+(\s*(lucky\s*)?(people|person|member|holder|user|follower)s?)?)\b.{0,60}\b(dm|pm|message|inbox)\b/i.test(text) && (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft|give|free|airdrop)\b/i.test(normalized) || /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text))) ||
    /\b(i\s*)?(will|am|'m|want\s*to|wanna|gonna|going\s*to)\s*(giv(e|ing)|send(ing)?|distribut(e|ing)|drop(ping)?)\b.{0,40}\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i.test(normalized) ||
    (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b.{0,60}\b(first\s*\d+(\s*(lucky\s*)?(people|person|member|holder|user|follower)s?)?)\b/i.test(text) && /\b(give|send|dm|pm|message|contact|free|claim|win|airdrop)\b/i.test(normalized)) ||
    /\b(giv(e|ing)\s*(some|away|out|free|you|them|my|the))\b.{0,40}\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i.test(normalized) ||
    /\b(contact|reach|hit)\s*me\b.{0,40}\b(sol|eth|btc|bnb|usdt|wallet|address|crypto)\b/i.test(normalized) && /\b(give|free|send|airdrop|first\s*\d+|claim)\b/i.test(text) ||
    /\b(not\s*interested\s*in\s*crypto|don'?t\s*(want|need)\s*(the\s*)?(crypto|sol|eth|btc))\b.{0,60}\b(dm|pm|message|give|free)\b/i.test(normalized) ||
    (/\bgiveaway\b/i.test(normalized) && /\b(dm|pm|message|inbox)\b/i.test(normalized) && (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i.test(normalized) || /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text))) ||
    (/\b(dm|pm|message)\b/i.test(normalized) && /\b(get|gets|receive|claim|win)\b/i.test(normalized) && /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text)) ||
    (/\b(first|frist)\s*(to\s*)?(dm|pm|message)\b/i.test(normalized) && (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft|free|giveaway|give)\b/i.test(normalized) || /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text))) ||
    (/\b(first\s*\d+)\b.{0,40}\b(dm|pm|message)\b/i.test(text) && /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text)) ||
    (/\b(free|giveaway)\b/i.test(normalized) && /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text));
  const sexualEmojis = ['🍆', '🍑', '💦', '🔥', '🥵', '😈', '💋'];
  const hasSexualSpam = sexualEmojis.some(e => text.includes(e)) && /\b(inbox|dm|pm|message|contact|send)\b/i.test(normalized);
  const hasSolicitationSpam = /\b(inbox|dm|pm)\b/i.test(normalized) && /\b(fun|service|interest|offer|available)\b/i.test(normalized);

  const hasRaidShillSpam = /\b(raid\s*(team|group|squad|crew|service)s?|raid\s*team\s*of\s*\d+|shill(er)?s?\s*(team|group|squad|crew|service)s?|shill(er)?s?\s*to\s*boost|raider(s)?\s*(and|&)\s*shill(er)?s?|verified\s*(raider|shiller)s?|boost(ing)?\s*engag(ement|e)|engag(ement|e)\s*boost(ing|er|service|team|farm)?|free\s*test\s*run|paid\s*(raid|shill|promo|market)|hire\s*(raid|shill|market))\b/i.test(normalized);
  const hasPaidServiceSpam = /\b(growth\s*service|marketing\s*service|promotion\s*service|listing\s*service|trending\s*service|cmc\s*(list|trend)|coingecko\s*(list|trend)|dextools\s*trend|twitter\s*(raid|growth|boost)|telegram\s*(growth|member|boost))\b/i.test(normalized);
  const hasBoostBotPromo = /@\w*(boost|trend|trending|pump|volume|shill|raid)\w*bot\b/i.test(text) ||
    /\b(get|getting)\s*(us|a)\s*(a\s*)?(spot|listed|trending|featured)\b.{0,40}\b(bot|service|channel)\b/i.test(normalized) ||
    /\b(look\s*into|check\s*out|try|use)\b.{0,30}@\w*(boost|trend|pump|shill|raid)\w*/i.test(text);

  const hasTelegramLink = /t\.me\/[A-Za-z0-9_]+/i.test(text);
  const hasTelegramInviteLink = /(?:t\.me|telegram\.me)\/(\+|joinchat\/)[A-Za-z0-9_-]+/i.test(text);
  const hasGroupPromoShill = hasTelegramLink && (
    /\b(join|check\s*out|visit|come\s*to|head\s*to|look\s*at)\b/i.test(normalized) &&
    /\b(tag|follow|support|help|pls|please|guys|fam|fren|ape)\b/i.test(normalized)
  );
  const hasUnsolicitedGroupLink = hasTelegramLink && /\b(join\s*(us|our|my|this|the)|come\s*join|check\s*(this|my|our)|new\s*(group|channel|community))\b/i.test(normalized);

  const hasMultiplierClaim = /\b(\d{2,})\s*[-–—]?\s*(\d+)?\s*[xхΧχ×](?=\s|$|[^\w])|\b\d+[xхΧχ×]\s*(gain|return|profit|potential|move|play|gem|from\s*here)\b/i.test(text);
  const hasPumpHypeLanguage = /\b(low[\s-]*(cap|mc)\s*(gem|play|pick|token|coin)?|hidden\s*gems?|new\s*gems?|found\s*.{0,10}gems?|next\s*\d+x|next\s*(play|move|call|gem)|moon\s*(shot|play|bag)|whale|rotate|rotating|accumulating|load(ing|ed)\s*(up|bag)|eye(ing)?\s*(a\s*few|some|these)|ape[ds]?\s*(in|into|now|early|before|this|it)|degen\s*(play|call|move)|don'?t\s*(sleep|fade)|early\s*(entry|bird|call)|bag\s*(these|this|it|now)|about\s*to\s*(pop|explode|moon|pump|rip|run|send|fly|break\s*out)|fill\s*(your|ur)\s*bag|lfg+\b|something\s*(huge|big|massive)\s*(is\s*)?(coming|brewing|loading|cooking)|get\s*ready|plays?\s*loading|print(ing)?\s*(money|gains?)|gonna\s*(be\s*)?print(ing)?)\b/i.test(normalized);
  const hasEmojiDmSolicitation = /[📩📬📭📮✉💌📧]\s*(me|us|now)\b/i.test(text) || /\b(send|drop|shoot)\s*(a\s*)?[📩📬📭📮✉💌📧]/i.test(text);
  const hasFomoUrgency = /🔥.*💸|💸.*🔥|🚀.*💰|💰.*🚀|🚀\s*🚀|🔥\s*🔥|\b(before\s*(it'?s?\s*too\s*late|the\s*(pump|train|bus|ship)|whales|liftoff|breakout|everyone)|still\s*early|not\s*too\s*late|thank\s*me\s*later|you'?ll\s*regret|mark\s*my\s*words|remember\s*(this|i\s*told)|nfa\s*(but|tho|though)|this\s*is\s*(it|the\s*one)|train\s*leav(es|ing)|make\s*sure.{0,20}don'?t\s*miss|don'?t\s*miss\s*out|secure\s*(your|a|my)\s*(spot|place|position|allocation|slot))\b/i.test(normalized) || /🔥\s*🔥/i.test(text) || /\b(in\s*private)\b.{0,20}\b\d+x\b/i.test(text);
  const isForwardedMessage = !!msg.forward_date;
  const hasLowMcGemShill = /\b(low[\s-]*(cap|mc)|gems?)\b/i.test(normalized) && /\b(found|new|hidden|just\s*launched|launched)\b/i.test(normalized) && /\b(gem|mc|cap)\b/i.test(normalized);
  const hasFinancialShillHype = (hasMultiplierClaim && hasPumpHypeLanguage) ||
    (hasMultiplierClaim && hasFomoUrgency) ||
    (hasPumpHypeLanguage && hasFomoUrgency) ||
    hasLowMcGemShill ||
    (isForwardedMessage && (hasMultiplierClaim || hasPumpHypeLanguage || hasFomoUrgency));

  const hasDmWithUsername = /\b(dm|pm)\s*.{0,5}@\w+/i.test(normalized) && /\b(call|signal|insider|profit|trade|print|miss|join|part|sticker|logo|banner|design|animation|website|promo|nft|mascot|gif|emoji|video|meme|drawing|whitepaper|white\s*paper|branding|graphic)s?\b/i.test(normalized);
  const hasInsiderCallSpam = (/\b(insider|my\s*(call|signal)|vip\s*(call|group|channel|access)|paid\s*(call|group|signal)|fading\s*me)\b/i.test(normalized) && /\b(dm|pm)\s*.{0,10}@\w+/i.test(normalized)) || /\binsider\b.{0,20}\b(cook|member|call|signal|group)s?\b.{0,30}(print|profit|money|gain|earning)/i.test(normalized) || /\bdrop\s*(cook|call|signal)s?\b.{0,20}(print|profit|member)/i.test(normalized) || /\b(inner\s*circle|private\s*circle)\b.{0,40}(print|profit|\dx|\d+x\b|money|earning|gain)/i.test(normalized) || /\d+(\.\d+)?x\s*(done|profit|gain|made)\b.{0,30}\b(inner|circle|member|private)/i.test(normalized);
  const aggressiveDmRegex = /\b(dm\s*now|dm\s*me\s*now|send\s*(a\s*)?dm|check\s*(my\s*)?dm|kindly\s*(send|dm)|holders?\s*dm|dm\s*if\s*you|dm\s*for\s*(promo|promotion|detail|info|offer|deal|signal|call))\b/i;
  const hasAggressiveDmSpam = aggressiveDmRegex.test(normalized) || aggressiveDmRegex.test(text);
  const hasWalletBuyingSelling = (/\b(buy|sell|pay(ing)?)\b.{0,30}\b(wall+ets?|accounts?)\b.{0,30}\b(history|transactions?|old|empty|aged|month|year)\b/i.test(normalized)) || (/\b(need|want|looking\s*for)\b.{0,15}\b(wall+ets?|accounts?)\b.{0,30}\b(history|transactions?|old|empty|aged|month|year)\b/i.test(normalized) && /\b(pay|buy|sol|eth|usdt|write\s*me|contact|dm|pm|\dsol|\deth)\b/i.test(normalized)) || /\b(old|empty|aged)\s*(wall+ets?|accounts?)\b.{0,60}\b(pay|buy|sell|solana|sol|eth|usdt|btc)\b/i.test(normalized) || (/\b(need|want|looking\s*for)\b.{0,10}\b(old|empty|aged)\b.{0,10}\b(wall+ets?|accounts?)\b/i.test(normalized) && /\b(pay|buy|sol|eth|usdt|write\s*me|contact|dm|pm)\b/i.test(normalized)) || (/\b(need|want)\b.{0,20}\b(wall+ets?|accounts?)\b.{0,60}\b(pay|buy|paying)\b/i.test(text) && /\d+\.?\d*\s*(sol|eth|usdt|btc|bnb)\b/i.test(text)) || (/\b(wall+ets?|accounts?)\s*(with|that\s*(has|have))\s*.{0,30}(transactions?|history|activit)/i.test(normalized) && /\b(pay|buy|sell|sol|eth|usdt|write\s*me|contact|dm|pm|\dsol|\deth|need|want)\b/i.test(normalized)) || (/\b(need|want|looking\s*for|buy)\b.{0,30}\b(solana|sol|eth|ethereum|crypto|btc|bitcoin)\b.{0,20}\b(wall+ets?|accounts?)\b/i.test(normalized) && /\b(pay|buy|\dsol|\deth|write\s*me|contact|dm|pm)\b/i.test(normalized));
  const hasPumpPromoSpam = /\b(pump|boost)\s*(your|ur)\s*(token|project|coin|mc|market\s*cap)\b/i.test(normalized) || /\b(i\s*(can|will)\s*(pump|boost|promote))\b.{0,40}\b(token|project|coin|mc|market\s*cap|profit)\b/i.test(normalized) || /\bpromotion\s*on\s*my\s*(telegram|channel|group)\b/i.test(normalized) || /\b(investor|holder)s?\s*(who\s*will|that\s*will|to)\s*(pump|buy|invest)/i.test(normalized) || /\b(contact|message|reach)\s*(me|us)\s*(in\s*)?(my\s*)?(inbox|dm|pm)\b.{0,30}\b(pump|promo|boost)/i.test(normalized);
  const hasInvestmentServicePitch =
    (/\b(i\s*help|we\s*help|i\s*connect|we\s*connect|we\s*unlock|i\s*unlock)\b/i.test(normalized) && /\b(otc|capital|fund(ing|s)?|institutional|strategic\s*(investor|buyer)|liquidity|market\s*disruption)\b/i.test(normalized)) ||
    /\b(are\s*you\s*open\s*(for|to))\b.{0,40}\b(otc|invest|capital|fund|partner)/i.test(normalized) ||
    /\b(otc\s*(capital|deal|invest|round|fund|buy|service|partner|opportunit))/i.test(normalized) && /\b(unlock|access|enabl|private|institutional|strategic)\b/i.test(normalized) ||
    /\b(unlock|access|secur)\b.{0,20}\$?\d+[km]?\s*[-–—]?\s*\$?\d*[km]?\s*(in\s*)?(capital|fund|invest|otc|liquidity)/i.test(normalized);

  const percentages = text.match(/\d+\s*%%?/g) || [];
  const hasAtHandleAtEnd = /@\w{3,}\s*$/.test(text.trim());
  const multiLine = text.split(/\n/).length >= 3;
  const hasRevenueSplitScam =
    (percentages.length >= 2 && hasAtHandleAtEnd && multiLine) ||
    (/\d+\s*(a|to|-|–|—)\s*\d+\s*(?:k|mil)\b/i.test(text) && percentages.length >= 1 && hasAtHandleAtEnd && multiLine);
  const checkmarkCount = (text.match(/✅/g) || []).length;
  const hasFormattedPitchScam = checkmarkCount >= 3 && hasAtHandleAtEnd && /[🚨💰⚠️❗]/.test(text) && multiLine;

  const learnedPatterns = await getLearnedPatterns(botConfigId);
  const hasLearnedPatternMatch = checkLearnedPatterns(normalized, learnedPatterns);

  const hasAnyScamSignal = hasMigrationAirdropScam || hasPrivateMessageSolicitation || hasTxHashRequest ||
    hasUnsolicitedServiceOffer || hasCryptoServiceKeywords || hasFlatteryPitch ||
    hasDmSolicitation || hasScamOffer || hasCryptoGiveawayScam || hasAggressiveDmSpam || hasEmojiDmSolicitation || hasPumpPromoSpam || hasBoostBotPromo ||
    hasDmServiceMenu || hasServiceListSpam || hasColdPitchPromo || hasVolumeServiceSpam || hasTokenCallCard || hasChannelManagementPitch || hasFakeExchangeListing || hasFinancialShillHype || hasInvestmentServicePitch || hasRevenueSplitScam || hasFormattedPitchScam || hasLearnedPatternMatch;
  if (evasionDetected && hasAnyScamSignal) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Homoglyph evasion with scam content (character substitution to bypass filters)");
  }
  if (evasionDetected) {
    log(`Homoglyph evasion without scam keywords — escalating to AI check`, "telegram");
  }
  if (isImpersonator && (hasMigrationAirdropScam || hasPrivateMessageSolicitation || hasDmSolicitation)) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Impersonation + scam (name mimics bot/group)");
  }
  if (hasMigrationAirdropScam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Fake migration/airdrop scam");
  }
  if (hasPrivateMessageSolicitation || (hasDmSolicitation && hasTxHashRequest)) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "DM solicitation / tx hash phishing");
  }
  if (hasFlatteryPitch || hasCryptoServiceKeywords || hasUnsolicitedServiceOffer) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Unsolicited service offer / cold-pitch spam");
  }
  if (hasDmServiceMenu || hasServiceListSpam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "DM service menu spam (unsolicited service listing)");
  }
  if (hasColdPitchPromo) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Cold-pitch promotion / paid promo service offer");
  }
  if (hasVolumeServiceSpam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Volume/liquidity service spam (unsolicited paid service)");
  }
  if (hasTokenCallCard) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Token call card spam (contract address + market data shill)");
  }
  if (hasChannelManagementPitch) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Channel/community management cold-pitch spam");
  }
  if (hasFakeExchangeListing) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Fake exchange listing impersonation scam");
  }
  if (hasSoftCollaborationInvite && (hasChannelManagementPitch || hasScamOffer || hasColdPitchPromo)) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Soft collaboration invite with scam/promo pitch");
  }
  if (hasAggressiveDmSpam || hasDmWithUsername) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Aggressive DM solicitation spam");
  }
  if (hasInsiderCallSpam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Insider trading / paid call scam");
  }
  if (hasWalletBuyingSelling) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Wallet buying/selling scam");
  }
  if (hasCryptoGiveawayScam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Crypto giveaway / free token scam");
  }
  if (hasDmSolicitation && (hasScamOffer || hasChannelManagementPitch)) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "DM solicitation with scam/promo offer");
  }
  if (hasSexualSpam || hasSolicitationSpam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Solicitation/adult spam");
  }
  if (hasTelegramInviteLink) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Unsolicited Telegram invite link spam");
  }
  if (hasGroupPromoShill || hasUnsolicitedGroupLink) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Telegram group/channel promotion spam");
  }
  if (hasRaidShillSpam || hasPaidServiceSpam || hasBoostBotPromo) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Raid/shill/boost bot promotion spam");
  }
  if (hasPumpPromoSpam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Token pump / paid promotion service offer");
  }
  if (hasFinancialShillHype) {
    const fwdTag = isForwardedMessage ? " [forwarded]" : "";
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, `Financial shill / pump hype spam${fwdTag} (multiplier claims + hype language)`);
  }
  if (hasInvestmentServicePitch) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Unsolicited OTC / investment service pitch");
  }
  if (hasRevenueSplitScam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Revenue split scam — percentage split pitch with contact handle");
  }
  if (hasFormattedPitchScam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Formatted scam pitch — checkmark bullet list with urgency emojis and contact handle");
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
    if ((reason === "unparseable" || reason === "error") && (hasSoftCollaborationInvite || hasDmSolicitation || hasFakeExchangeListing || hasChannelManagementPitch || hasFinancialShillHype || hasInvestmentServicePitch)) {
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

  if ((/\b(buy|sell|pay)\b.{0,30}\b(wall+et|account)\b.{0,30}\b(history|transactions?|old|empty|aged|month|year)\b/i.test(normalized)) || (/\b(need|want|looking\s*for)\b.{0,15}\b(wall+et|account)\b.{0,30}\b(history|transactions?|old|empty|aged|month|year)\b/i.test(normalized) && /\b(pay|buy|sol|eth|usdt|write\s*me|contact|dm|pm|\dsol|\deth)\b/i.test(normalized)) || /\b(old|empty|aged)\s*(wall+et|account)\b.{0,30}\b(pay|buy|sell|solana|sol|eth|usdt|btc)\b/i.test(normalized) || (/\b(wall+et|account)\s*(with|that\s*(has|have))\s*.{0,30}(transactions?|history|activit)/i.test(normalized) && /\b(pay|buy|sell|sol|eth|usdt|write\s*me|contact|dm|pm|\dsol|\deth|need|want)\b/i.test(normalized)) || (/\b(need|want|looking\s*for|buy)\b.{0,30}\b(solana|sol|eth|ethereum|crypto|btc|bitcoin)\b.{0,20}\b(wall+et|account)\b/i.test(normalized) && /\b(pay|buy|\dsol|\deth|write\s*me|contact|dm|pm)\b/i.test(normalized))) {
    return { isScam: true, reason: "Wallet buying/selling scam — attempting to purchase crypto wallets with transaction history" };
  }

  if (/\b(airdrop|claim|free\s*(token|coin|nft|crypto)|migration|connect\s*(your\s*)?wallet)\b/i.test(normalized) && /https?:\/\//i.test(text)) {
    return { isScam: true, reason: "Airdrop/migration scam with suspicious link" };
  }

  const exchangeNames = /\b(binance|biconomy|okx|kucoin|bybit|gate\.?io|mexc|huobi|htx|bitget|bitmart|lbank|poloniex|crypto\.?com|coinbase|kraken|gemini|weex|xt\.?com|phemex|upbit|bithumb|bitfinex)\b/i;
  if ((/\b(official\s*represent\w*|represent\w*\s*(of|from)|partner\s*(of|from)|agent\s*(of|from)|ambassador\s*(of|for|from))\b/i.test(normalized) && exchangeNames.test(normalized)) ||
      (exchangeNames.test(normalized) && /\b(listing\s*(proposal|cooperat|opportunit))\b/i.test(normalized) && /\b(contact|whom|who|reach|discuss|dm|pm)\b/i.test(normalized))) {
    return { isScam: true, reason: "Fake exchange listing impersonation" };
  }

  if (/\b(dm|pm|inbox|message|contact)\s*(me|us)\b/i.test(normalized) && (/\b(promo|market|boost|pump|shill|volume|listing|invest|fund|capital|otc)\b/i.test(normalized) || /\b(i\s*(can|will)\s*(help|boost|promote|pump|grow|increase))\b/i.test(normalized))) {
    return { isScam: true, reason: "Unsolicited service offer with DM solicitation" };
  }

  if (/\b(i\s*manage|managing)\b.{0,20}\b(channel|communit|group)s?\b/i.test(normalized) && /\b(engag|growth|volume|mc|market\s*cap|member|organic|promot)\b/i.test(normalized)) {
    return { isScam: true, reason: "Channel management cold-pitch spam" };
  }

  if ((/\b(crypto\s*project|your\s*(project|token|coin|brand))\b/i.test(normalized) && /\b(growth|exposure|followers?|campaign|media\s*kit|viral)\b/i.test(normalized)) ||
      (/\b(elevat|grow|scale|skyrocket|supercharg|amplif|maximiz)\w*\s*(your|ur)\s*(crypto|project|token|coin|brand|community)\b/i.test(normalized)) ||
      (/\b(media\s*kit|rate\s*card|pricing\s*sheet)\b/i.test(normalized) && /\b(campaign|promo|promot|advertis|partner|collaborat)\b/i.test(normalized)) ||
      (/\b(partner\s*with)\b/i.test(normalized) && /\b(growth|exposure|followers?|viral|engag|massive|authentic)\b/i.test(normalized) && /\b(crypto|tiktok|twitter|youtube|influenc)\b/i.test(normalized)) ||
      (/\b\d+[\s,]*\d*(?:[kKmM])?\+?\s*(followers?|subscribers?|members?|audience|enthusiasts?)\b/i.test(text) && /\b(crypto|project|token|coin|campaign|promo|growth|exposure)\b/i.test(normalized) && /\b(partner|collaborat|promot|advertis|offer|provide|elevat|grow|boost|media\s*kit|campaign|viral|drop\s*(us|me)\s*(a\s*)?message)\b/i.test(normalized))) {
    return { isScam: true, reason: "Cold-pitch promotion / paid promo service offer" };
  }

  if ((/\b(i\s*(will|can)|we\s*(will|can))\s*(provide|offer|deliver|generate|create|make|do|give|bring|get)\b/i.test(normalized) && /\b(volume|liquidity|trading|holders?|pin\s*post)\b/i.test(normalized) && /\b(my\s*(community|channel|group)|check\s*out|support)\b/i.test(normalized)) ||
      (/\b(i\s*(will|can)|we\s*(will|can))\s*(provide|offer|deliver|generate)\b.{0,30}\b\d+[-–—]\d+k?\s*(volume|liquidity|holders?)\b/i.test(text)) ||
      (/\b(pin\s*post|pinned\s*post)\b/i.test(normalized) && /\b(my\s*(community|channel|group))\b/i.test(normalized) && /\b(volume|support|promo|boost|service)\b/i.test(normalized))) {
    return { isScam: true, reason: "Volume/liquidity service spam — unsolicited paid service offer" };
  }

  if ((/0x[a-f0-9]{40}/i.test(text) && /\b(vol|volume|mc|market\s*cap|liq|liquidity)\b/i.test(text)) ||
      (/0x[a-f0-9]{40}/i.test(text) && /[+\-]\d+[\d.]*%/.test(text) && /\b(safety|score|audit)\b/i.test(text)) ||
      (/\b(vol|volume)\b.{0,15}\b(mc|market\s*cap)\b/i.test(text) && /\b(liq|liquidity)\b/i.test(text) && /[+\-]\d+[\d.]*%/.test(text) && (/0x[a-f0-9]{40}/i.test(text) || /[📊💹💰📋🔗]/.test(text))) ||
      (/\b(CA|contract)\b.{0,20}(0x[a-f0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})/i.test(text) && /\b(vol|volume|mc|market\s*cap|liq|liquidity|pump)\b/i.test(text))) {
    return { isScam: true, reason: "Token call card spam — contract address + market data shill" };
  }

  const detPercentages = text.match(/\d+\s*%%?/g) || [];
  const detHasAtEnd = /@\w{3,}\s*$/.test(text.trim());
  const detMultiLine = text.split(/\n/).length >= 3;
  if (((detPercentages.length >= 2 && detHasAtEnd && detMultiLine) ||
      (/\d+\s*(a|to|-|–|—)\s*\d+\s*(?:k|mil)\b/i.test(text) && detPercentages.length >= 1 && detHasAtEnd && detMultiLine))) {
    return { isScam: true, reason: "Revenue split scam — percentage split pitch with contact handle" };
  }
  const detCheckmarks = (text.match(/✅/g) || []).length;
  if (detCheckmarks >= 3 && detHasAtEnd && /[🚨💰⚠️❗]/.test(text) && detMultiLine) {
    return { isScam: true, reason: "Formatted scam pitch — checkmark bullet list with urgency emojis and contact handle" };
  }

  if (/\b(send|give|transfer)\b.{0,15}\b(sol|eth|btc|usdt|crypto|token|nft)\b.{0,30}\b(receive|get|back|return|double|triple)\b/i.test(normalized)) {
    return { isScam: true, reason: "Crypto doubling/advance fee scam" };
  }

  if ((/\bgiveaway\b/i.test(normalized) && /\b(dm|pm|message|inbox)\b/i.test(normalized) && (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i.test(normalized) || /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text))) ||
      (/\b(dm|pm|message)\b/i.test(normalized) && /\b(get|gets|receive|claim|win)\b/i.test(normalized) && /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text)) ||
      (/\b(first|frist)\s*(to\s*)?(dm|pm|message)\b/i.test(normalized) && (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft|free|giveaway|give)\b/i.test(normalized) || /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text))) ||
      (/\b(first\s*\d+)\b.{0,40}\b(dm|pm|message)\b/i.test(text) && /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text)) ||
      (/\b(first\s*\d+(\s*(lucky\s*)?(people|person|member|holder|user|follower)s?)?)\b.{0,60}\b(dm|pm|message|inbox)\b/i.test(text) && (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft|give|free|airdrop)\b/i.test(normalized) || /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text))) ||
      (/\b(free|giveaway)\b/i.test(normalized) && /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text))) {
    return { isScam: true, reason: "Fake crypto giveaway scam — DM solicitation with free crypto lure" };
  }

  return { isScam: false, reason: "" };
}
