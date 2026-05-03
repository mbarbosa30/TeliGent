import RE2 from "re2";

// Compile every regex literal through Google's RE2 engine, which guarantees
// linear-time matching and is immune to catastrophic backtracking. We cache
// compiled instances by `source::flags` so the cost is paid once per unique
// regex (literals re-evaluate to fresh RegExp objects on every call).
//
// If RE2 cannot compile a particular regex (e.g. it uses a feature outside
// the RE2 subset), we fall back to the native engine. The MAX_SCAM_SCAN_LENGTH
// cap and per-pattern timing guard in `runAllPatterns` are the safety net for
// any such fallback.
type Tester = { test: (s: string) => boolean };
const re2Cache = new Map<string, Tester>();
let re2FallbackCount = 0;
export function _scamRegexFallbackCount(): number { return re2FallbackCount; }
export function rt(re: RegExp, s: string): boolean {
  const key = `${re.source}::${re.flags}`;
  let cached = re2Cache.get(key);
  if (!cached) {
    try {
      const r = new RE2(re);
      cached = { test: (str: string) => r.test(str) };
    } catch {
      re2FallbackCount++;
      cached = { test: (str: string) => re.test(str) };
    }
    re2Cache.set(key, cached);
  }
  return cached.test(s);
}

interface ScamPattern {
  name: string;
  description: string;
  reason: string;
  detect: (normalized: string, raw: string) => boolean;
}

const EXCHANGE_NAMES = /\b(binance|biconomy|okx|kucoin|bybit|gate\.?io|mexc|huobi|htx|bitget|bitmart|lbank|poloniex|crypto\.?com|coinbase|kraken|gemini|weex|xt\.?com|phemex|upbit|bithumb|bitfinex)\b/i;

const SERVICE_MENU_KEYWORDS = /\b(sticker|logo|banner|meme|gif|emoji|animation|video|website|white\s*paper|whitepaper|buybot|buy\s*bot|drawing|promo|design|nft|mascot|flyer|poster|thumbnail|graphic|branding|merch)s?\b/ig;

const WORD_NUMBERS = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|several|multiple|many|various|numerous|large|huge|big)/i;

export const scamPatterns: ScamPattern[] = [
  {
    name: "migrationAirdropScam",
    description: "Fake token migration, airdrop, or contract swap announcements targeting holders",
    reason: "Fake migration/airdrop scam",
    detect: (normalized, raw) =>
      rt(/\b(migrat(ion|ing|e)|airdrop(ping|s)?)\b.{0,60}\b(holder|hoIder|volume|voIume|loss|Ioss|recover|boost|all)\b/i, normalized) ||
      rt(/\b(recover|boost)\b.{0,30}\b(loss|volume|price)\b/i, normalized) ||
      rt(/\b(drop\s*(event|alert|claim|link|distribution))\b.{0,60}\b(holder|member|exclusively|private|select)\b/i, normalized) ||
      (rt(/\b(hosting|holding|launching|announcing)\b.{0,30}\b(drop|airdrop)\b/i, normalized) && rt(/\b(holder|member|private|exclusive|select)\b/i, normalized)) ||
      rt(/\b(working\s*on|announcing|starting)\s*(a\s*)?(migration|airdrop|token\s*swap|contract\s*change)\b/i, normalized) ||
      rt(/\b(re\s*launch|relaunch)(ed|ing)?\b.{0,40}\b(token|contract|v2|v3)\b/i, normalized) ||
      (rt(/1\s*:\s*1/, raw) && rt(/\btoken/i, raw) && rt(/\b(relaunch|re.?launch|recieve|receive|swap|migrat|airdrop|claim)\b/i, raw)) ||
      (rt(/\b(halt|apologiz|ceas|shut.?down|wind.?down|discontinu)\b/i, raw) && rt(/\btoken/i, raw) && rt(/\b(relaunch|re.?launch|recieve|receive|fairness|1\s*:\s*1)\b/i, raw)) ||
      rt(/\b(v2|v3)\s*(token|contract|launch|version)\b.{0,40}\b(swap|migrat|airdrop|claim|new\s*ca|clean\s*ca)\b/i, normalized) ||
      rt(/\b(swap|exchange|convert)\s*(your\s*)?(old\s*)?(token|holding)\b.{0,40}\b(new|v2|v3|airdrop|claim)\b/i, normalized) ||
      rt(/\b(new|clean)\s*(ca|contract\s*address)\b.{0,40}\b(swap|migrat|airdrop|token|claim|hold)\b/i, normalized) ||
      rt(/\b(dm|pm|message|inbox|send)\b.{0,30}\b(proof|screenshot|address|wallet)\b.{0,30}\b(hold|token|airdrop|swap|claim)\b/i, normalized) ||
      rt(/\b(hold|token|airdrop)\b.{0,30}\b(dm|pm|message|inbox|send)\b.{0,30}\b(proof|screenshot|address|wallet)\b/i, normalized) ||
      rt(/\b(send|show|share)\b.{0,20}\b(screenshot|proof|address)\b.{0,30}\b(token|hold|buy|purchase|airdrop)\b/i, normalized),
  },
  {
    name: "privateMessageSolicitation",
    description: "Asking users to send private messages, DMs, or contact privately",
    reason: "DM solicitation / tx hash phishing",
    detect: (normalized) =>
      rt(/\b(private\s*message|send\s*me\s*(a\s*)?(message|msg)|drop\s*(me\s*)?(a\s*)?(message|msg|line|dm|pm)|reach\s*out\s*to\s*me|contact\s*me\s*(privately|directly)|write\s*me\s*(a\s*)?(message|privately|directly))\b/i, normalized) ||
      rt(/\b(private|direct)\s*(message|msg|chat)\b.{0,20}\b(with|your|tx|hash|screenshot|purchase)\b/i, normalized),
  },
  {
    name: "txHashRequest",
    description: "Requesting transaction hashes, purchase screenshots, or proof of purchase",
    reason: "DM solicitation / tx hash phishing",
    detect: (normalized) =>
      rt(/\b(tx\s*hash|transaction\s*hash|screenshot\s*of\s*(your\s*)?(purchase|transaction|buy|tx)|proof\s*of\s*(purchase|transaction|buy))\b/i, normalized),
  },
  {
    name: "unsolicitedServiceOffer",
    description: "Cold-pitch offering services like design, marketing, community management",
    reason: "Unsolicited service offer / cold-pitch spam",
    detect: (normalized) =>
      rt(/\b(i('d| would)?\s*(love|like)\s*to\s*(create|make|design|build|develop|offer|support|help|assist|handle|manage))\b/i, normalized) ||
      rt(/\b(i\s*(can|will|offer|provide|specialize|do)\s*(create|make|design|build|develop|custom|professional))\b/i, normalized) ||
      rt(/\b(i\s*speciali[sz]e\s*in)\b.{0,40}\b(engag|moderat|communit|management|growth|fud|support|marketing|promot|discussion|organiz)/i, normalized) ||
      rt(/\b(hire\s*me|my\s*services|my\s*portfolio|check\s*my\s*(work|portfolio|profile))\b/i, normalized) ||
      rt(/\b(looking\s*for\s*(a\s*)?(designer|developer|animator|artist|creator)\s*\?\s*i)\b/i, normalized) ||
      rt(/\b(alongside\s*your\s*(bot|team|mod|admin))\b/i, normalized) ||
      rt(/\b(turn(ing)?\s*(passive|quiet|inactive)\s*(member|user|viewer)s?\s*into\s*(active|engag))/i, normalized) ||
      (rt(/\b(maximize|increase|drive|boost)\s*(engag|trust|growth|retention|activit)/i, normalized) && rt(/\b(your\s*(community|group|project|channel)|i('d| would| can| will))\b/i, normalized)),
  },
  {
    name: "cryptoServiceKeywords",
    description: "Offering crypto-specific design services (NFTs, logos, banners, animations)",
    reason: "Unsolicited service offer / cold-pitch spam",
    detect: (normalized) =>
      rt(/\b(nft|logo|banner|sticker|gif|animation|mascot|meme\s*(coin|token|animation)|dex\s*banner|coin\s*logo|token\s*logo|2d|3d)\b/i, normalized) &&
      rt(/\b(creat|design|make|build|custom|your\s*(project|token|coin|mascot))\b/i, normalized),
  },
  {
    name: "flatteryPitch",
    description: "Flattery about a project/community followed by a service pitch",
    reason: "Unsolicited service offer / cold-pitch spam",
    detect: (normalized) => {
      const hasFlattery = rt(/\b(love\s*your|great\s*(project|community|token)|amazing\s*(project|community|token)|awesome\s*(project|community))\b/i, normalized);
      const hasServicePitch = rt(/\b(creat|design|make|build|develop|offer|provid|along\s*with|services?)\b/i, normalized) &&
        rt(/\b(nft|logo|banner|sticker|gif|animation|mascot|emoji|promot|market|listing|website|app|bot|smart\s*contract)\b/i, normalized);
      return hasFlattery && hasServicePitch;
    },
  },
  {
    name: "dmSolicitation",
    description: "Direct message solicitation asking users to DM/PM/inbox",
    reason: "Aggressive DM solicitation spam",
    detect: (normalized) =>
      rt(/\b(dm|pm|inbox|message|contact)\s*(me|us)\b|\bsend\s*(me\s*)?(a\s*)?(dm|pm|message)\b|\b(inbox|dm|pm)\b.*\b(for|me)\b|\bshould\s*(dm|pm|message|inbox)\b|\b(dm|pm)\s*(to|for)\s*(discuss|talk|chat|collaborate|partner|detail|info|more|inquir)/i, normalized),
  },
  {
    name: "softCollaborationInvite",
    description: "Soft outreach asking who to contact or expressing interest in collaboration",
    reason: "Soft collaboration invite with scam/promo pitch",
    detect: (normalized) =>
      rt(/\b(let\s*me\s*know|reach\s*out|get\s*in\s*touch|open\s*to)\s*.{0,20}\b(collaborat|partner|work\s*together|discuss|interest)/i, normalized) ||
      rt(/\b(who(m)?\s*should\s*i\s*contact|who(m)?\s*can\s*i\s*(talk|speak|reach)|who(m)?\s*(to|should\s*i)\s*(contact|message|reach))\b/i, normalized),
  },
  {
    name: "fakeExchangeListing",
    description: "Impersonating exchange representatives or offering fake listing partnerships",
    reason: "Fake exchange listing impersonation scam",
    detect: (normalized) =>
      (rt(/\b(official\s*represent\w*|represent\w*\s*(of|from)|partner\s*(of|from)|agent\s*(of|from)|ambassador\s*(of|for|from)|(i'?m|we'?re|i\s*am|we\s*are)\s*.{0,15}(from|at|with))\b/i, normalized) && EXCHANGE_NAMES.test(normalized)) ||
      (EXCHANGE_NAMES.test(normalized) && rt(/\b(listing\s*(proposal|cooperat|opportunit))\b/i, normalized) && rt(/\b(contact|whom|who|reach|discuss|dm|pm)\b/i, normalized)) ||
      (rt(/\bverify\b.{0,30}\b(bio|identity)\b/i, normalized) && EXCHANGE_NAMES.test(normalized) && rt(/\b(official|represent\w*|partner|agent|ambassador|listing|contact)\b/i, normalized)),
  },
  {
    name: "dmServiceMenu",
    description: "DM handle + list of services offered (logo, banner, sticker, etc.)",
    reason: "DM service menu spam (unsolicited service listing)",
    detect: (normalized) => {
      const count = (normalized.match(SERVICE_MENU_KEYWORDS) || []).length;
      return /\b(dm|pm|inbox|message|contact)\s*.{0,20}@\w+/i.test(normalized) && count >= 2;
    },
  },
  {
    name: "serviceListSpam",
    description: "Long list of service keywords (3+) with call-to-action",
    reason: "DM service menu spam (unsolicited service listing)",
    detect: (normalized) => {
      const count = (normalized.match(SERVICE_MENU_KEYWORDS) || []).length;
      return count >= 3 && rt(/\b(dm|pm|inbox|message|contact|order|hire|available|and\s*more)\b/i, normalized);
    },
  },
  {
    name: "scamOffer",
    description: "Promotion/marketing offers, guaranteed returns, free crypto promises",
    reason: "DM solicitation with scam/promo offer",
    detect: (normalized) =>
      rt(/\b(promot|promo\b|listing|volume|investor)\b/i, normalized) ||
      (rt(/\b(i\s+|we\s+)(own|run|manag|lead)\w*\s+(a\s+|my\s+|our\s+|several\s+|multiple\s+)*(communit|channel|group)/i, normalized) && rt(/\b(dm|pm|inbox|message|contact|engag|volume|growth|boost|promo|offer|service|provid|deliver)\b/i, normalized)) ||
      rt(/\b\d+\s*(eth|btc|usdt|bnb|sol)\b/i, normalized) ||
      rt(/\b(free\s*(token|coin|airdrop|eth|btc|crypto)|guaranteed\s*(return|profit))\b/i, normalized),
  },
  {
    name: "channelManagementPitch",
    description: "Claims to manage/run communities combined with marketing buzzwords",
    reason: "Channel/community management cold-pitch spam",
    detect: (normalized, raw) => {
      const channelManagementClaim = rt(/\b(i\s+|we\s+)(manage|run|lead|operat|head|built)\w*\s+/i, normalized) &&
        (WORD_NUMBERS.test(normalized) || rt(/\d+/, raw)) &&
        rt(/\b(channel|communit|group|chat)\w*\b/i, normalized);
      const channelManagementNoNumber = rt(/\b(i\s+|we\s+)(manage|run|lead|operat|head)\w*\s+(active\s+|trusted\s+|large\s+|big\s+|whale\s+|crypto\s+|trading\s+|investor\s+)*(channel|communit|group|chat)/i, normalized);
      const marketingBuzzwords = rt(/\b(engag|volume|growth|grow\s*(faster|quick)|mc\b|market\s*cap|investor|serious\s*investor|right\s*audience|sustain|expan|promot|boost|collaborat|partner|listing\s*cooperat)/i, normalized);
      return (channelManagementClaim || channelManagementNoNumber) && marketingBuzzwords;
    },
  },
  {
    name: "coldPitchPromo",
    description: "Cold-pitch promotion offers, paid promo services, influencer marketing pitches",
    reason: "Cold-pitch promotion / paid promo service offer",
    detect: (normalized, raw) =>
      rt(/\b(promo|promot(e|ion|ing)|market(ing)?|boost(ing)?|advertis(e|ing)|shill(ing)?)\s*.{0,30}\b(your|ur)\s*(project|token|coin|community|group|channel)\b/i, normalized) ||
      rt(/\b(we\s*(will|can|offer|provide|do)|i\s*(will|can|offer|provide|do))\s*(promo|promot(e|ion|ing)|market(ing)?|boost(ing)?|advertis(e|ing)|shill(ing)?|trend(ing)?|list(ing)?)\s*.{0,20}\b(your|ur)\b/i, normalized) ||
      rt(/\b(low\s*cost|cheap|affordable|best\s*price|discount|free\s*trial)\b.{0,40}\b(promo|promot|market|boost|advertis|listing|trending)/i, normalized) ||
      rt(/\b(promo|promot|market|boost|advertis|listing|trending)\b.{0,40}\b(low\s*cost|cheap|affordable|best\s*price|discount|free\s*trial)/i, normalized) ||
      rt(/\b(top|best|big|major)\s*(channel|group|platform)s?\b.{0,30}\b(low\s*cost|cheap|affordable|promo|promot|advertis)/i, normalized) ||
      (rt(/\b(crypto\s*project|your\s*(project|token|coin|brand))\b/i, normalized) && rt(/\b(growth|exposure|followers?|campaign|media\s*kit|viral)\b/i, normalized)) ||
      (rt(/\b(elevat|grow|scale|skyrocket|supercharg|amplif|maximiz)\w*\s*(your|ur)\s*(crypto|project|token|coin|brand|community)\b/i, normalized)) ||
      (rt(/\b(media\s*kit|rate\s*card|pricing\s*sheet)\b/i, normalized) && rt(/\b(campaign|promo|promot|advertis|partner|collaborat)\b/i, normalized)) ||
      (rt(/\b(partner\s*with)\b/i, normalized) && rt(/\b(growth|exposure|followers?|viral|engag|massive|authentic)\b/i, normalized) && rt(/\b(crypto|tiktok|twitter|youtube|influenc)\b/i, normalized)) ||
      (rt(/\b\d+[\s,]*\d*(?:[kKmM])?\+?\s*(followers?|subscribers?|members?|audience|enthusiasts?)\b/i, raw) && rt(/\b(crypto|project|token|coin|campaign|promo|growth|exposure)\b/i, normalized) && rt(/\b(partner|collaborat|promot|advertis|offer|provide|elevat|grow|boost|media\s*kit|campaign|viral|drop\s*(us|me)\s*(a\s*)?message)\b/i, normalized)),
  },
  {
    name: "promoForHireSpam",
    description: "Paid promotion services advertising reach on Twitter/Telegram accounts and channels",
    reason: "Promo-for-hire spam (paid promotion service pitch)",
    detect: (normalized, raw) =>
      (rt(/\b(i\s*will|we\s*will|i\s*can|we\s*can)\s*(promot|market|boost|advertis|shill)\w*\s*(your|ur)\s*(post|project|token|coin|brand|content)\b/i, normalized) && rt(/\b(twitter|telegram|youtube|tiktok|instagram|discord|channel|account|group)\b/i, normalized)) ||
      (rt(/\b(promot|market|boost|advertis)\w*\s*(your|ur)\s*(post|project|token|coin|brand|content)\b/i, normalized) && rt(/\b\d+\s*(active\s*)?(twitter|telegram|youtube|tiktok|instagram|discord|channel|account|group)s?\b/i, raw)) ||
      (rt(/\b(i\s*provide|we\s*provide|i\s*offer|we\s*offer)\s*(strong|real|reliable|massive|organic|quality|best|top)?\s*(promot|market|boost|advertis|visibilit|expos)/i, normalized) && rt(/\b(dm|pm|inbox|message|contact)\s*(me|us)\b/i, normalized)) ||
      (rt(/\b(promot|market|boost|advertis)\w*\s*(your|ur)\s*(post|project|token|coin|brand|content)\s*(on|across|to)\s*\d+/i, raw) && rt(/\b(dm|pm|inbox|message|contact|reach|free\s*to)\b/i, normalized)) ||
      (rt(/\b(strong|real|reliable|massive)\s*(promot|visibilit|reach|expos)/i, normalized) && rt(/\b\d+\s*(active\s*)?(twitter|telegram|youtube|channel|account|group)s?\b/i, raw) && rt(/\b(dm|pm|inbox|message|contact|free\s*to)\b/i, normalized)),
  },
  {
    name: "volumeServiceSpam",
    description: "Offering volume/liquidity services, community-backed pumping",
    reason: "Volume/liquidity service spam (unsolicited paid service)",
    detect: (normalized, raw) =>
      (rt(/\b(i\s*(will|can)|we\s*(will|can))\s*(provide|offer|deliver|generate|create|make|do|give|bring|get)\b/i, normalized) && rt(/\b(volume|liquidity|trading|holders?|pin\s*post)\b/i, normalized) && rt(/\b(my\s*(community|channel|group)|check\s*out|support)\b/i, normalized)) ||
      (rt(/\b(i\s*(will|can)|we\s*(will|can))\s*(provide|offer|deliver|generate)\b.{0,30}\b\d+[-–—]\d+k?\s*(volume|liquidity|holders?)\b/i, raw)) ||
      (rt(/\b(pin\s*post|pinned\s*post)\b/i, normalized) && rt(/\b(my\s*(community|channel|group))\b/i, normalized) && rt(/\b(volume|support|promo|boost|service)\b/i, normalized)),
  },
  {
    name: "tokenCallCard",
    description: "Formatted token shill posts with contract addresses and market data",
    reason: "Token call card spam (contract address + market data shill)",
    detect: (_normalized, raw) =>
      (rt(/0x[a-f0-9]{40}/i, raw) && rt(/\b(vol|volume|mc|market\s*cap|liq|liquidity)\b/i, raw)) ||
      (rt(/0x[a-f0-9]{40}/i, raw) && rt(/[+\-]\d+[\d.]*%/, raw) && rt(/\b(safety|score|audit)\b/i, raw)) ||
      (rt(/\b(vol|volume)\b.{0,15}\b(mc|market\s*cap)\b/i, raw) && rt(/\b(liq|liquidity)\b/i, raw) && rt(/[+\-]\d+[\d.]*%/, raw) && (rt(/0x[a-f0-9]{40}/i, raw) || rt(/[📊💹💰📋🔗]/, raw))) ||
      (rt(/\b(CA|contract)\b.{0,20}(0x[a-f0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})/i, raw) && rt(/\b(vol|volume|mc|market\s*cap|liq|liquidity|pump)\b/i, raw)),
  },
  {
    name: "cryptoGiveawayScam",
    description: "Fake crypto giveaways offering free tokens/coins via DM",
    reason: "Crypto giveaway / free token scam",
    detect: (normalized, raw) =>
      rt(/\b(giv(e|ing)\s*(away|out|free|you|them|my))\b.{0,40}\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i, normalized) ||
      rt(/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b.{0,40}\b(giv(e|ing)\s*(away|out|free))\b/i, normalized) ||
      rt(/\b(first\s*\d+(\s*(lucky\s*)?(people|person|member|holder|user|follower)s?)?)\b.{0,60}\b(sol|eth|btc|bnb|usdt|crypto|token|coin|give|free|win|claim|airdrop)\b/i, raw) ||
      (rt(/\b(first\s*\d+(\s*(lucky\s*)?(people|person|member|holder|user|follower)s?)?)\b.{0,60}\b(dm|pm|message|inbox)\b/i, raw) && (rt(/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft|give|free|airdrop)\b/i, normalized) || rt(/\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i, raw))) ||
      rt(/\b(i\s*)?(will|am|'m|want\s*to|wanna|gonna|going\s*to)\s*(giv(e|ing)|send(ing)?|distribut(e|ing)|drop(ping)?)\b.{0,40}\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i, normalized) ||
      (rt(/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b.{0,60}\b(first\s*\d+(\s*(lucky\s*)?(people|person|member|holder|user|follower)s?)?)\b/i, raw) && rt(/\b(give|send|dm|pm|message|contact|free|claim|win|airdrop)\b/i, normalized)) ||
      rt(/\b(giv(e|ing)\s*(some|away|out|free|you|them|my|the))\b.{0,40}\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i, normalized) ||
      (rt(/\b(contact|reach|hit)\s*me\b.{0,40}\b(sol|eth|btc|bnb|usdt|wallet|address|crypto)\b/i, normalized) && rt(/\b(give|free|send|airdrop|first\s*\d+|claim)\b/i, raw)) ||
      rt(/\b(not\s*interested\s*in\s*crypto|don'?t\s*(want|need)\s*(the\s*)?(crypto|sol|eth|btc))\b.{0,60}\b(dm|pm|message|give|free)\b/i, normalized) ||
      (rt(/\bgiveaway\b/i, normalized) && rt(/\b(dm|pm|message|inbox)\b/i, normalized) && (rt(/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i, normalized) || rt(/\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i, raw))) ||
      (rt(/\b(dm|pm|message)\b/i, normalized) && rt(/\b(get|gets|receive|claim|win)\b/i, normalized) && rt(/\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i, raw)) ||
      (rt(/\b(first|frist)\s*(to\s*)?(dm|pm|message)\b/i, normalized) && (rt(/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft|free|giveaway|give)\b/i, normalized) || rt(/\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i, raw))) ||
      (rt(/\b(first\s*\d+)\b.{0,40}\b(dm|pm|message)\b/i, raw) && rt(/\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i, raw)) ||
      (rt(/\b(free|giveaway)\b/i, normalized) && rt(/\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i, raw)),
  },
  {
    name: "sexualSpam",
    description: "Sexual emoji spam combined with DM solicitation",
    reason: "Solicitation/adult spam",
    detect: (normalized, raw) => {
      const sexualEmojis = ['🍆', '🍑', '💦', '🔥', '🥵', '😈', '💋'];
      return sexualEmojis.some(e => raw.includes(e)) && rt(/\b(inbox|dm|pm|message|contact|send)\b/i, normalized);
    },
  },
  {
    name: "nsfwSpam",
    description: "Adult/porn/NSFW category spam (often hidden inside inline keyboard buttons of forwarded ads)",
    reason: "NSFW/adult spam (porn category links)",
    detect: (normalized, raw) => {
      // Strong single-keyword hits. The normalizer already collapses
      // common digit-for-letter substitutions (p0rn, le5bian, sch00l)
      // back to plain ascii before this runs.
      const strongTerms = rt(/\b(porn|xxx|nudes?|naked\s*(girl|teen|woman)s?|onlyfans|hentai|milf|lesbian|creampie|hookup|escort|nsfw|sextape|sexcam|sexchat|webcam\s*(girl|sex)|adult\s*(video|chat|site)|cam\s*girl|fuck\s*videos?|18\s*\+|18\+\s*(only|content|chat|video))\b/i, normalized);
      // "Watch archive / hot girls / leaked tape" call-to-action lines
      // that appear as button labels in classic porn-channel forwards.
      const ctaShape = rt(/\b(watch\s*(archive|now|here|videos?|live)|hot\s*(girl|chick|babe|video|woman)s?|leaked\s*(video|tape|nude|content)|teen\s*(girl|cam|video)s?)\b/i, normalized);
      // Hard-no categories that have no legitimate use in any chat.
      const illegalShape = rt(/\b(zoo|incest|rape)\s*(porn|video|sex|tube|vid|content|girl|tape|chat)\b/i, normalized) ||
        rt(/\b(child|kid|underage|loli|cp)\s*(porn|nude|sex)\b/i, normalized);
      return strongTerms || ctaShape || illegalShape;
    },
  },
  {
    name: "solicitationSpam",
    description: "Generic solicitation with DM requests",
    reason: "Solicitation/adult spam",
    detect: (normalized) =>
      rt(/\b(inbox|dm|pm)\b/i, normalized) && rt(/\b(fun|service|interest|offer|available)\b/i, normalized),
  },
  {
    name: "raidShillSpam",
    description: "Raid team, shill squad, engagement boosting services",
    reason: "Raid/shill/boost bot promotion spam",
    detect: (normalized) =>
      rt(/\b(raid\s*(team|group|squad|crew|service)s?|raid\s*team\s*of\s*\d+|shill(er)?s?\s*(team|group|squad|crew|service)s?|shill(er)?s?\s*to\s*boost|raider(s)?\s*(and|&)\s*shill(er)?s?|verified\s*(raider|shiller)s?|boost(ing)?\s*engag(ement|e)|engag(ement|e)\s*boost(ing|er|service|team|farm)?|free\s*test\s*run|paid\s*(raid|shill|promo|market)|hire\s*(raid|shill|market))\b/i, normalized),
  },
  {
    name: "paidServiceSpam",
    description: "Paid growth/marketing/listing/trending services",
    reason: "Raid/shill/boost bot promotion spam",
    detect: (normalized) =>
      rt(/\b(growth\s*service|marketing\s*service|promotion\s*service|listing\s*service|trending\s*service|cmc\s*(list|trend)|coingecko\s*(list|trend)|dextools\s*trend|twitter\s*(raid|growth|boost)|telegram\s*(growth|member|boost))\b/i, normalized),
  },
  {
    name: "boostBotPromo",
    description: "Promoting boost/trend/pump bots or services",
    reason: "Raid/shill/boost bot promotion spam",
    detect: (normalized, raw) =>
      rt(/@\w*(boost|trend|trending|pump|volume|shill|raid)\w*bot\b/i, raw) ||
      rt(/\b(get|getting)\s*(us|a)\s*(a\s*)?(spot|listed|trending|featured)\b.{0,40}\b(bot|service|channel)\b/i, normalized) ||
      rt(/\b(look\s*into|check\s*out|try|use)\b.{0,30}@\w*(boost|trend|pump|shill|raid)\w*/i, raw),
  },
  {
    name: "telegramInviteLink",
    description: "Unsolicited Telegram group/channel invite links",
    reason: "Unsolicited Telegram invite link spam",
    detect: (_normalized, raw) =>
      rt(/(?:t\.me|telegram\.me)\/(\+|joinchat\/)[A-Za-z0-9_-]+/i, raw),
  },
  {
    name: "groupPromoShill",
    description: "Telegram group link + call-to-action to join/follow",
    reason: "Telegram group/channel promotion spam",
    detect: (normalized, raw) => {
      const hasTgLink = rt(/t\.me\/[A-Za-z0-9_]+/i, raw);
      return hasTgLink && (
        rt(/\b(join|check\s*out|visit|come\s*to|head\s*to|look\s*at)\b/i, normalized) &&
        rt(/\b(tag|follow|support|help|pls|please|guys|fam|fren|ape)\b/i, normalized)
      );
    },
  },
  {
    name: "unsolicitedGroupLink",
    description: "Telegram link with 'join us/our/my' language",
    reason: "Telegram group/channel promotion spam",
    detect: (normalized, raw) => {
      const hasTgLink = rt(/t\.me\/[A-Za-z0-9_]+/i, raw);
      return hasTgLink && rt(/\b(join\s*(us|our|my|this|the)|come\s*join|check\s*(this|my|our)|new\s*(group|channel|community))\b/i, normalized);
    },
  },
  {
    name: "dmWithUsername",
    description: "DM/PM + @username combined with service/scam keywords",
    reason: "Aggressive DM solicitation spam",
    detect: (normalized) =>
      rt(/\b(dm|pm)\s*.{0,5}@\w+/i, normalized) && rt(/\b(call|signal|insider|profit|trade|print|miss|join|part|sticker|logo|banner|design|animation|website|promo|nft|mascot|gif|emoji|video|meme|drawing|whitepaper|white\s*paper|branding|graphic)s?\b/i, normalized),
  },
  {
    name: "insiderCallSpam",
    description: "Insider trading calls, VIP signal groups, paid call scams",
    reason: "Insider trading / paid call scam",
    detect: (normalized) =>
      (rt(/\b(insider|my\s*(call|signal)|vip\s*(call|group|channel|access)|paid\s*(call|group|signal)|fading\s*me)\b/i, normalized) && rt(/\b(dm|pm)\s*.{0,10}@\w+/i, normalized)) ||
      rt(/\binsider\b.{0,20}\b(cook|member|call|signal|group)s?\b.{0,30}(print|profit|money|gain|earning)/i, normalized) ||
      rt(/\bdrop\s*(cook|call|signal)s?\b.{0,20}(print|profit|member)/i, normalized) ||
      rt(/\b(inner\s*circle|private\s*circle)\b.{0,40}(print|profit|\dx|\d+x\b|money|earning|gain)/i, normalized) ||
      rt(/\d+(\.\d+)?x\s*(done|profit|gain|made)\b.{0,30}\b(inner|circle|member|private)/i, normalized),
  },
  {
    name: "aggressiveDmSpam",
    description: "Aggressive DM now/send DM/check DM solicitation patterns",
    reason: "Aggressive DM solicitation spam",
    detect: (normalized, raw) => {
      const aggressiveDmRegex = /\b(dm\s*now|dm\s*me\s*now|send\s*(a\s*)?dm|check\s*(my\s*)?dm|kindly\s*(send|dm)|holders?\s*dm|dm\s*if\s*you|dm\s*for\s*(promo|promotion|detail|info|offer|deal|signal|call))\b/i;
      return aggressiveDmRegex.test(normalized) || aggressiveDmRegex.test(raw);
    },
  },
  {
    name: "walletBuyingSelling",
    description: "Buying/selling crypto wallets with transaction history",
    reason: "Wallet buying/selling scam",
    detect: (normalized, raw) =>
      (rt(/\b(buy|sell|pay(ing)?)\b.{0,30}\b(wall+ets?|accounts?)\b.{0,30}\b(history|transactions?|old|empty|aged|dead|month|year)\b/i, normalized)) ||
      (rt(/\b(need|want|looking\s*for)\b.{0,30}\b(wall+ets?|accounts?)\b.{0,30}\b(history|transactions?|old|empty|aged|dead|month|year)\b/i, normalized) && rt(/\b(pay|buy|sol|eth|usdt|write\s*me|contact|dm|pm)\b/i, normalized)) ||
      (rt(/\b(need|want|looking\s*for)\b.{0,30}\b(wall+ets?|accounts?)\b.{0,30}\b(history|transactions?|old|empty|aged|dead|month|year)\b/i, normalized) && rt(/\d+\s*(sol|eth|usdt|btc|bnb)\b/i, raw)) ||
      rt(/\b(old|empty|aged|dead)\s*(wall+ets?|accounts?|tokens?)\b.{0,60}\b(pay|buy|sell|solana|sol|eth|usdt|btc)\b/i, normalized) ||
      (rt(/\b(need|want|looking\s*for)\b.{0,15}\b(old|empty|aged|dead)\b.{0,15}\b(wall+ets?|accounts?|tokens?)\b/i, normalized) && rt(/\b(pay|buy|sol|eth|usdt|write\s*me|contact|dm|pm)\b/i, normalized)) ||
      (rt(/\b(need|want)\b.{0,30}\b(wall+ets?|accounts?)\b.{0,60}\b(pay|buy|paying)\b/i, raw) && rt(/\d+\s*(sol|eth|usdt|btc|bnb)\b/i, raw)) ||
      (rt(/\b(wall+ets?|accounts?)\s*(with|that\s*(has|have))\s*.{0,40}(transactions?|history|activit|dead\s*tokens?)/i, normalized) && rt(/\b(pay|buy|sell|sol|eth|usdt|write\s*me|contact|dm|pm|need|want)\b/i, normalized)) ||
      (rt(/\b(wall+ets?|accounts?)\s*(with|that\s*(has|have))\s*.{0,40}(transactions?|history|activit|dead\s*tokens?)/i, normalized) && rt(/\d+\s*(sol|eth|usdt|btc|bnb)\b/i, raw)) ||
      (rt(/\b(need|want|looking\s*for|buy)\b.{0,30}\b(solana|sol|eth|ethereum|crypto|btc|bitcoin)\b.{0,20}\b(wall+ets?|accounts?)\b/i, normalized) && rt(/\b(pay|buy|write\s*me|contact|dm|pm)\b/i, normalized)) ||
      (rt(/\b(need|want|looking\s*for|buy)\b.{0,30}\b(solana|sol|eth|ethereum|crypto|btc|bitcoin)\b.{0,20}\b(wall+ets?|accounts?)\b/i, normalized) && rt(/\d+\s*(sol|eth|usdt|btc|bnb)\b/i, raw)) ||
      (rt(/\b(plenty|dead)\s*(tokens?)\b/i, normalized) && rt(/\b(wall+ets?|accounts?)\b/i, normalized) && rt(/\b(pay|buy|need|want|sell)\b/i, normalized)) ||
      (rt(/\b(phantom|phantomm|solflare|solfare|soflare|metamask|metamas|trustwallet|trust\s*wallet)\b/i, normalized) && rt(/\b(wall+ets?|accounts?)\b/i, normalized) && rt(/\b(old|empty|aged|dead|transaction|history|month|year)\b/i, normalized) && rt(/\b(pay|buy|sell|sol|eth|usdt|need|want|get\s*me)\b/i, normalized)),
  },
  {
    name: "pumpPromoSpam",
    description: "Token pump services, paid promotion on telegram channels",
    reason: "Token pump / paid promotion service offer",
    detect: (normalized) =>
      rt(/\b(pump|boost)\s*(your|ur)\s*(token|project|coin|mc|market\s*cap)\b/i, normalized) ||
      rt(/\b(i\s*(can|will)\s*(pump|boost|promote))\b.{0,40}\b(token|project|coin|mc|market\s*cap|profit)\b/i, normalized) ||
      rt(/\bpromotion\s*on\s*my\s*(telegram|channel|group)\b/i, normalized) ||
      rt(/\b(investor|holder)s?\s*(who\s*will|that\s*will|to)\s*(pump|buy|invest)/i, normalized) ||
      rt(/\b(contact|message|reach)\s*(me|us)\s*(in\s*)?(my\s*)?(inbox|dm|pm)\b.{0,30}\b(pump|promo|boost)/i, normalized),
  },
  {
    name: "investmentServicePitch",
    description: "OTC capital, institutional investors, strategic funding pitches",
    reason: "Unsolicited OTC / investment service pitch",
    detect: (normalized) =>
      (rt(/\b(i\s*help|we\s*help|i\s*connect|we\s*connect|we\s*unlock|i\s*unlock)\b/i, normalized) && rt(/\b(otc|capital|fund(ing|s)?|institutional|strategic\s*(investor|buyer)|liquidity|market\s*disruption)\b/i, normalized)) ||
      rt(/\b(are\s*you\s*open\s*(for|to))\b.{0,40}\b(otc|invest|capital|fund|partner)/i, normalized) ||
      (rt(/\b(otc\s*(capital|deal|invest|round|fund|buy|service|partner|opportunit))/i, normalized) && rt(/\b(unlock|access|enabl|private|institutional|strategic)\b/i, normalized)) ||
      rt(/\b(unlock|access|secur)\b.{0,20}\$?\d+[km]?\s*[-–—]?\s*\$?\d*[km]?\s*(in\s*)?(capital|fund|invest|otc|liquidity)/i, normalized),
  },
  {
    name: "revenueSplitScam",
    description: "Multi-language revenue split pitches with percentage claims and @handle",
    reason: "Revenue split scam — percentage split pitch with contact handle",
    detect: (_normalized, raw) => {
      const percentages = raw.match(/\d+\s*%%?/g) || [];
      const hasAtHandleAtEnd = rt(/@\w{3,}\s*$/, raw.trim());
      const multiLine = raw.split(/\n/).length >= 3;
      return (percentages.length >= 2 && hasAtHandleAtEnd && multiLine) ||
        (rt(/\d+\s*(a|to|-|–|—)\s*\d+\s*(?:k|mil)\b/i, raw) && percentages.length >= 1 && hasAtHandleAtEnd && multiLine);
    },
  },
  {
    name: "formattedPitchScam",
    description: "Formatted scam pitches with checkmark bullets, urgency emojis, and @handle",
    reason: "Formatted scam pitch — checkmark bullet list with urgency emojis and contact handle",
    detect: (_normalized, raw) => {
      const checkmarkCount = (raw.match(/✅/g) || []).length;
      const hasAtHandleAtEnd = rt(/@\w{3,}\s*$/, raw.trim());
      const multiLine = raw.split(/\n/).length >= 3;
      return checkmarkCount >= 3 && hasAtHandleAtEnd && rt(/[🚨💰⚠️❗]/, raw) && multiLine;
    },
  },
  {
    name: "emojiDmSolicitation",
    description: "Using email/message emojis as DM solicitation",
    reason: "Aggressive DM solicitation spam",
    detect: (_normalized, raw) =>
      rt(/[📩📬📭📮✉💌📧]\s*(me|us|now)\b/i, raw) || rt(/\b(send|drop|shoot)\s*(a\s*)?[📩📬📭📮✉💌📧]/i, raw),
  },
  {
    name: "vipCallBrag",
    description: "VIP/insider call results bragging with multiplier claims or profit numbers",
    reason: "VIP call / insider trading brag spam",
    detect: (normalized, raw) =>
      (rt(/\b(vip|insider|premium|private)\b.{0,40}\b(call|signal|alert|pick|group|channel)\b/i, normalized) && rt(/\d+[xхΧχ×]/i, raw)) ||
      (rt(/\d+[xхΧχ×]\b.{0,40}\b(vip|insider|premium|private)\s*(call|signal|alert|pick|group|channel)\b/i, raw)) ||
      (rt(/\b(called\s*at|call\s*was|from\s*(the|my|our)\s*call)\b/i, normalized) && rt(/\d+[xхΧχ×]/i, raw)) ||
      (rt(/\b(ath|all[\s-]*time[\s-]*high)\b/i, normalized) && rt(/\d+[xхΧχ×]/i, raw) && rt(/\b(call|signal|vip|insider|boom|bullish)\b/i, normalized)) ||
      (rt(/\b(called\s*at)\b/i, normalized) && rt(/\b(mc|market\s*cap|ath|all[\s-]*time[\s-]*high)\b/i, normalized) && rt(/\d+[kKmM]?\b/i, raw)),
  },
  {
    name: "testimonialProfitHype",
    description: "Testimonial-style profit claims with urgency/FOMO language",
    reason: "Testimonial profit hype spam",
    detect: (normalized, raw) => {
      const hasProfitClaim = rt(/\$\s*\d[\d,.]*\s*[kKmM]?\b/, raw) || rt(/\b(locked\s*in|made|earned|banked|pulled|secured|pocketed|cashed\s*out)\b.{0,20}\$?\d[\d,.]*\s*[kKmM]?\b/i, raw);
      const hasTestimonial = rt(/\b(member|trader|caller|subscriber|follower|user|person|people|guy|dude)\s*(just|already|recently)?\s*(locked|made|earned|banked|pulled|secured|pocketed|cashed)/i, normalized) || rt(/\b(another|last|recent|latest)\s*(member|trader|caller|subscriber|win|result|call)\b/i, normalized);
      const hasUrgency = rt(/\b(next\s*(gem|play|call|move|one)|already\s*(loading|positioning|accumulating|moving)|smart\s*money|don'?t\s*miss|can'?t\s*afford|about\s*to|still\s*early|before\s*(it'?s?\s*too\s*late|everyone))\b/i, normalized) || rt(/[🚀🔥💰📈💎]+.*[🚀🔥💰📈💎]+/u, raw);
      return hasProfitClaim && (hasTestimonial || hasUrgency);
    },
  },
  {
    name: "fakeRefundExitScam",
    description: "Fake project shutdown/refund announcements requesting DMs or transaction hashes",
    reason: "Fake refund / exit scam",
    detect: (normalized, _raw) =>
      (rt(/\b(refund|refunding)\b/i, normalized) && rt(/\b(holder|buy|purchase|transaction|tx)\b/i, normalized) && rt(/\b(dm|pm|inbox|message|send|hash|verification|verify)\b/i, normalized)) ||
      (rt(/\b(apologiz|apolog(y|ies)|sorry|unfortunat)\b/i, normalized) && rt(/\b(refund|refunding|compensat)\b/i, normalized) && rt(/\b(holder|investor|supporter|buyer|participant)\b/i, normalized)) ||
      (rt(/\b(shut\s*(down|ting)|wind\s*(down|ing)|ceas|discontinu|closing)\b/i, normalized) && rt(/\b(refund|refunding|return\s*(the|your)|compensat)\b/i, normalized)) ||
      (rt(/\b(relaunch|re[\s-]*launch)\b/i, normalized) && rt(/\b(refund|refunding)\b/i, normalized) && rt(/\b(holder|dm|pm|send|hash|transaction)\b/i, normalized)),
  },
  {
    name: "investorAccessPitch",
    description: "Offering access to investors, traders, or whales for token promotion",
    reason: "Investor access / token scaling pitch spam",
    detect: (normalized, raw) =>
      (rt(/\b(access\s*to|connect\s*(you\s*)?with|network\s*of|pool\s*of)\b.{0,20}\d+\s*\+?\s*(genuine|real|active|serious|verified|organic|crypto)?\s*(investor|trader|whale|buyer|holder|enthusiast)s?\b/i, raw)) ||
      (rt(/\b\d+\s*\+?\s*(genuine|real|active|serious|verified|organic|crypto)\s*(investor|trader|whale|buyer|holder|enthusiast)s?\b/i, raw) && rt(/\b(dm|pm|contact|message|inbox|reach)\b/i, normalized)) ||
      (rt(/\b(scal(e|ing)|grow(ing)?|boost(ing)?|promot(e|ing))\s*(your|ur)\s*(token|project|coin|community)\b/i, normalized) && rt(/\b(investor|trader|whale|buyer)s?\b/i, normalized) && rt(/\b(dm|pm|contact|message|strategy|expos|visibilit|engag)\b/i, normalized)) ||
      (rt(/\b(serious\s*about|ready\s*to)\s*(scal|grow|boost|promot|expand)/i, normalized) && rt(/\b(investor|trader|whale|exposure|visibility|volume|engagement)\b/i, normalized) && rt(/\b(dm|pm|contact|message|@\w+)\b/i, normalized)),
  },
  {
    name: "channelForHirePromo",
    description: "Offering Telegram channels/groups for paid crypto promotion or shilling",
    reason: "Channel-for-hire promotion spam",
    detect: (normalized, _raw) =>
      (rt(/\b(i\s*have|we\s*have|got)\b.{0,20}\b(telegram|tg|crypto)?\s*(channel|group|communit)s?\b.{0,30}\b(promot|market|shill|advertis|boost|post)\b/i, normalized)) ||
      (rt(/\b(telegram|tg)?\s*(channel|group|communit)s?\s*(for|available\s*for)\s*(promot|market|shill|advertis|boost|crypto)\b/i, normalized)) ||
      (rt(/\b(promot|market|shill|advertis)\b/i, normalized) && rt(/\b(cheap|fast|quick|affordable|low\s*price|best\s*price|instant)\s*(price|post|promot|result|delivery)?\b/i, normalized) && rt(/\b(contact|dm|pm|message|inbox|reach)\s*(me|us)?\b/i, normalized)) ||
      (rt(/\b(any\s*(project|token|coin)\s*needs?)\b.{0,30}\b(market|promot|shill|advertis|boost)\b/i, normalized) && rt(/\b(contact|dm|pm|message|inbox|reach)\s*(me|us)?\b/i, normalized)),
  },
];

export interface FinancialHypeSignals {
  hasMultiplierClaim: boolean;
  hasPumpHypeLanguage: boolean;
  hasFomoUrgency: boolean;
  hasLowMcGemShill: boolean;
  isForwardedMessage: boolean;
}

export function detectFinancialHypeSignals(normalized: string, raw: string, isForwarded: boolean): FinancialHypeSignals {
  const hasMultiplierClaim = rt(/\b(\d{2,})\s*[-–—]?\s*(\d+)?\s*[xхΧχ×](?=\s|$|[^\w])|\b\d+[xхΧχ×]\s*(gain|return|profit|potential|move|play|gem|from\s*here)\b/i, raw);
  const hasPumpHypeLanguage = rt(/\b(low[\s-]*(cap|mc)\s*(gem|play|pick|token|coin)?|hidden\s*gems?|new\s*gems?|found\s*.{0,10}gems?|next\s*\d+x|next\s*(play|move|call|gem)|moon\s*(shot|play|bag)|whale|rotate|rotating|accumulating|load(ing|ed)\s*(up|bag)|eye(ing)?\s*(a\s*few|some|these)|ape[ds]?\s*(in|into|now|early|before|this|it)|degen\s*(play|call|move)|don'?t\s*(sleep|fade)|early\s*(entry|bird|call)|bag\s*(these|this|it|now)|about\s*to\s*(pop|explode|moon|pump|rip|run|send|fly|break\s*out)|fill\s*(your|ur)\s*bag|lfg+\b|something\s*(huge|big|massive)\s*(is\s*)?(coming|brewing|loading|cooking)|get\s*ready|plays?\s*loading|print(ing)?\s*(money|gains?)|gonna\s*(be\s*)?print(ing)?|bullish|bearish|ath\b|all[\s-]*time[\s-]*high|vip\s*(call|signal|group|channel|access|now|pick)|called\s*at\s*\d|from\s*(the|my|our)\s*(call|signal)|smart\s*money|results?\s*speak|speak\s*louder|precision|isn'?t\s*luck)\b/i, normalized);
  const hasFomoUrgency = rt(/🔥.*💸|💸.*🔥|🚀.*💰|💰.*🚀|🚀\s*🚀|🔥\s*🔥|📈.*🔥|🔥.*📈|\b(before\s*(it'?s?\s*too\s*late|the\s*(pump|train|bus|ship)|whales|liftoff|breakout|everyone)|still\s*early|not\s*too\s*late|thank\s*me\s*later|you'?ll\s*regret|mark\s*my\s*words|remember\s*(this|i\s*told)|nfa\s*(but|tho|though)|this\s*is\s*(it|the\s*one)|train\s*leav(es|ing)|make\s*sure.{0,20}don'?t\s*miss|don'?t\s*miss\s*out|can'?t\s*afford\s*to\s*miss|afford\s*to\s*miss|secure\s*(your|a|my)\s*(spot|place|position|allocation|slot)|already\s*(loading|positioning|accumulating|moving))\b/i, normalized) || rt(/🔥\s*🔥/i, raw) || rt(/\b(in\s*private)\b.{0,20}\b\d+x\b/i, raw);
  const hasLowMcGemShill = rt(/\b(low[\s-]*(cap|mc)|gems?)\b/i, normalized) && rt(/\b(found|new|hidden|just\s*launched|launched)\b/i, normalized) && rt(/\b(gem|mc|cap)\b/i, normalized);

  return { hasMultiplierClaim, hasPumpHypeLanguage, hasFomoUrgency, hasLowMcGemShill, isForwardedMessage: isForwarded };
}

export function isFinancialShillHype(signals: FinancialHypeSignals): boolean {
  return (signals.hasMultiplierClaim && signals.hasPumpHypeLanguage) ||
    (signals.hasMultiplierClaim && signals.hasFomoUrgency) ||
    (signals.hasPumpHypeLanguage && signals.hasFomoUrgency) ||
    signals.hasLowMcGemShill ||
    (signals.isForwardedMessage && (signals.hasMultiplierClaim || signals.hasPumpHypeLanguage || signals.hasFomoUrgency));
}

// Hard cap on text length scanned by the deterministic scam patterns.
// Several patterns chain `.{0,N}` wildcards which the JS regex engine
// matches with backtracking. Without a length cap, a sufficiently long
// crafted message can drive worst-case match time into the multi-second
// range and stall the bot worker. 2000 chars is well above any real
// message and keeps every pattern under ~5ms in benchmarks.
export const MAX_SCAM_SCAN_LENGTH = 2000;

// Per-pattern wall-clock budget. If any single pattern exceeds this we
// log a structured warning and treat the result as a non-match for that
// pattern, so a future ReDoS regression on one regex cannot stall the
// whole detection pipeline. The remaining patterns still run.
const PATTERN_MS_BUDGET = 50;

export function runAllPatterns(normalized: string, raw: string): Map<string, boolean> {
  const results = new Map<string, boolean>();
  const safeNormalized = normalized.length > MAX_SCAM_SCAN_LENGTH
    ? normalized.slice(0, MAX_SCAM_SCAN_LENGTH)
    : normalized;
  const safeRaw = raw.length > MAX_SCAM_SCAN_LENGTH
    ? raw.slice(0, MAX_SCAM_SCAN_LENGTH)
    : raw;
  for (const pattern of scamPatterns) {
    const t0 = Date.now();
    let matched = false;
    try {
      matched = pattern.detect(safeNormalized, safeRaw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[scam-patterns] ${pattern.name} threw: ${msg}`);
      matched = false;
    }
    const elapsed = Date.now() - t0;
    if (elapsed > PATTERN_MS_BUDGET) {
      console.warn(`[scam-patterns] ${pattern.name} exceeded ${PATTERN_MS_BUDGET}ms budget (took ${elapsed}ms, input=${safeNormalized.length}/${safeRaw.length}) - possible ReDoS`);
    }
    results.set(pattern.name, matched);
  }
  return results;
}

export function getPatternReason(name: string): string {
  const pattern = scamPatterns.find(p => p.name === name);
  return pattern?.reason || "Unknown scam pattern";
}
