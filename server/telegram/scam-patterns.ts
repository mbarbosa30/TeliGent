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
      /\b(migrat(ion|ing|e)|airdrop(ping|s)?)\b.{0,60}\b(holder|hoIder|volume|voIume|loss|Ioss|recover|boost|all)\b/i.test(normalized) ||
      /\b(recover|boost)\b.{0,30}\b(loss|volume|price)\b/i.test(normalized) ||
      /\b(drop\s*(event|alert|claim|link|distribution))\b.{0,60}\b(holder|member|exclusively|private|select)\b/i.test(normalized) ||
      (/\b(hosting|holding|launching|announcing)\b.{0,30}\b(drop|airdrop)\b/i.test(normalized) && /\b(holder|member|private|exclusive|select)\b/i.test(normalized)) ||
      /\b(working\s*on|announcing|starting)\s*(a\s*)?(migration|airdrop|token\s*swap|contract\s*change)\b/i.test(normalized) ||
      /\b(re\s*launch|relaunch)(ed|ing)?\b.{0,40}\b(token|contract|v2|v3)\b/i.test(normalized) ||
      (/1\s*:\s*1/.test(raw) && /\btoken/i.test(raw) && /\b(relaunch|re.?launch|recieve|receive|swap|migrat|airdrop|claim)\b/i.test(raw)) ||
      (/\b(halt|apologiz|ceas|shut.?down|wind.?down|discontinu)\b/i.test(raw) && /\btoken/i.test(raw) && /\b(relaunch|re.?launch|recieve|receive|fairness|1\s*:\s*1)\b/i.test(raw)) ||
      /\b(v2|v3)\s*(token|contract|launch|version)\b.{0,40}\b(swap|migrat|airdrop|claim|new\s*ca|clean\s*ca)\b/i.test(normalized) ||
      /\b(swap|exchange|convert)\s*(your\s*)?(old\s*)?(token|holding)\b.{0,40}\b(new|v2|v3|airdrop|claim)\b/i.test(normalized) ||
      /\b(new|clean)\s*(ca|contract\s*address)\b.{0,40}\b(swap|migrat|airdrop|token|claim|hold)\b/i.test(normalized) ||
      /\b(dm|pm|message|inbox|send)\b.{0,30}\b(proof|screenshot|address|wallet)\b.{0,30}\b(hold|token|airdrop|swap|claim)\b/i.test(normalized) ||
      /\b(hold|token|airdrop)\b.{0,30}\b(dm|pm|message|inbox|send)\b.{0,30}\b(proof|screenshot|address|wallet)\b/i.test(normalized) ||
      /\b(send|show|share)\b.{0,20}\b(screenshot|proof|address)\b.{0,30}\b(token|hold|buy|purchase|airdrop)\b/i.test(normalized),
  },
  {
    name: "privateMessageSolicitation",
    description: "Asking users to send private messages, DMs, or contact privately",
    reason: "DM solicitation / tx hash phishing",
    detect: (normalized) =>
      /\b(private\s*message|send\s*me\s*(a\s*)?(message|msg)|drop\s*(me\s*)?(a\s*)?(message|msg|line|dm|pm)|reach\s*out\s*to\s*me|contact\s*me\s*(privately|directly)|write\s*me\s*(a\s*)?(message|privately|directly))\b/i.test(normalized) ||
      /\b(private|direct)\s*(message|msg|chat)\b.{0,20}\b(with|your|tx|hash|screenshot|purchase)\b/i.test(normalized),
  },
  {
    name: "txHashRequest",
    description: "Requesting transaction hashes, purchase screenshots, or proof of purchase",
    reason: "DM solicitation / tx hash phishing",
    detect: (normalized) =>
      /\b(tx\s*hash|transaction\s*hash|screenshot\s*of\s*(your\s*)?(purchase|transaction|buy|tx)|proof\s*of\s*(purchase|transaction|buy))\b/i.test(normalized),
  },
  {
    name: "unsolicitedServiceOffer",
    description: "Cold-pitch offering services like design, marketing, community management",
    reason: "Unsolicited service offer / cold-pitch spam",
    detect: (normalized) =>
      /\b(i('d| would)?\s*(love|like)\s*to\s*(create|make|design|build|develop|offer|support|help|assist|handle|manage))\b/i.test(normalized) ||
      /\b(i\s*(can|will|offer|provide|specialize|do)\s*(create|make|design|build|develop|custom|professional))\b/i.test(normalized) ||
      /\b(i\s*speciali[sz]e\s*in)\b.{0,40}\b(engag|moderat|communit|management|growth|fud|support|marketing|promot|discussion|organiz)/i.test(normalized) ||
      /\b(hire\s*me|my\s*services|my\s*portfolio|check\s*my\s*(work|portfolio|profile))\b/i.test(normalized) ||
      /\b(looking\s*for\s*(a\s*)?(designer|developer|animator|artist|creator)\s*\?\s*i)\b/i.test(normalized) ||
      /\b(alongside\s*your\s*(bot|team|mod|admin))\b/i.test(normalized) ||
      /\b(turn(ing)?\s*(passive|quiet|inactive)\s*(member|user|viewer)s?\s*into\s*(active|engag))/i.test(normalized) ||
      (/\b(maximize|increase|drive|boost)\s*(engag|trust|growth|retention|activit)/i.test(normalized) && /\b(your\s*(community|group|project|channel)|i('d| would| can| will))\b/i.test(normalized)),
  },
  {
    name: "cryptoServiceKeywords",
    description: "Offering crypto-specific design services (NFTs, logos, banners, animations)",
    reason: "Unsolicited service offer / cold-pitch spam",
    detect: (normalized) =>
      /\b(nft|logo|banner|sticker|gif|animation|mascot|meme\s*(coin|token|animation)|dex\s*banner|coin\s*logo|token\s*logo|2d|3d)\b/i.test(normalized) &&
      /\b(creat|design|make|build|custom|your\s*(project|token|coin|mascot))\b/i.test(normalized),
  },
  {
    name: "flatteryPitch",
    description: "Flattery about a project/community followed by a service pitch",
    reason: "Unsolicited service offer / cold-pitch spam",
    detect: (normalized) => {
      const hasFlattery = /\b(love\s*your|great\s*(project|community|token)|amazing\s*(project|community|token)|awesome\s*(project|community))\b/i.test(normalized);
      const hasServicePitch = /\b(creat|design|make|build|develop|offer|provid|along\s*with|services?)\b/i.test(normalized) &&
        /\b(nft|logo|banner|sticker|gif|animation|mascot|emoji|promot|market|listing|website|app|bot|smart\s*contract)\b/i.test(normalized);
      return hasFlattery && hasServicePitch;
    },
  },
  {
    name: "dmSolicitation",
    description: "Direct message solicitation asking users to DM/PM/inbox",
    reason: "Aggressive DM solicitation spam",
    detect: (normalized) =>
      /\b(dm|pm|inbox|message|contact)\s*(me|us)\b|\bsend\s*(me\s*)?(a\s*)?(dm|pm|message)\b|\b(inbox|dm|pm)\b.*\b(for|me)\b|\bshould\s*(dm|pm|message|inbox)\b|\b(dm|pm)\s*(to|for)\s*(discuss|talk|chat|collaborate|partner|detail|info|more|inquir)/i.test(normalized),
  },
  {
    name: "softCollaborationInvite",
    description: "Soft outreach asking who to contact or expressing interest in collaboration",
    reason: "Soft collaboration invite with scam/promo pitch",
    detect: (normalized) =>
      /\b(let\s*me\s*know|reach\s*out|get\s*in\s*touch|open\s*to)\s*.{0,20}\b(collaborat|partner|work\s*together|discuss|interest)/i.test(normalized) ||
      /\b(who(m)?\s*should\s*i\s*contact|who(m)?\s*can\s*i\s*(talk|speak|reach)|who(m)?\s*(to|should\s*i)\s*(contact|message|reach))\b/i.test(normalized),
  },
  {
    name: "fakeExchangeListing",
    description: "Impersonating exchange representatives or offering fake listing partnerships",
    reason: "Fake exchange listing impersonation scam",
    detect: (normalized) =>
      (/\b(official\s*represent\w*|represent\w*\s*(of|from)|partner\s*(of|from)|agent\s*(of|from)|ambassador\s*(of|for|from)|(i'?m|we'?re|i\s*am|we\s*are)\s*.{0,15}(from|at|with))\b/i.test(normalized) && EXCHANGE_NAMES.test(normalized)) ||
      (EXCHANGE_NAMES.test(normalized) && /\b(listing\s*(proposal|cooperat|opportunit))\b/i.test(normalized) && /\b(contact|whom|who|reach|discuss|dm|pm)\b/i.test(normalized)) ||
      (/\bverify\b.{0,30}\b(bio|identity)\b/i.test(normalized) && EXCHANGE_NAMES.test(normalized) && /\b(official|represent\w*|partner|agent|ambassador|listing|contact)\b/i.test(normalized)),
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
      return count >= 3 && /\b(dm|pm|inbox|message|contact|order|hire|available|and\s*more)\b/i.test(normalized);
    },
  },
  {
    name: "scamOffer",
    description: "Promotion/marketing offers, guaranteed returns, free crypto promises",
    reason: "DM solicitation with scam/promo offer",
    detect: (normalized) =>
      /\b(promot|promo\b|listing|volume|investor)\b/i.test(normalized) ||
      (/\b(i\s+|we\s+)(own|run|manag|lead)\w*\s+(a\s+|my\s+|our\s+|several\s+|multiple\s+)*(communit|channel|group)/i.test(normalized) && /\b(dm|pm|inbox|message|contact|engag|volume|growth|boost|promo|offer|service|provid|deliver)\b/i.test(normalized)) ||
      /\b\d+\s*(eth|btc|usdt|bnb|sol)\b/i.test(normalized) ||
      /\b(free\s*(token|coin|airdrop|eth|btc|crypto)|guaranteed\s*(return|profit))\b/i.test(normalized),
  },
  {
    name: "channelManagementPitch",
    description: "Claims to manage/run communities combined with marketing buzzwords",
    reason: "Channel/community management cold-pitch spam",
    detect: (normalized, raw) => {
      const channelManagementClaim = /\b(i\s+|we\s+)(manage|run|lead|operat|head|built)\w*\s+/i.test(normalized) &&
        (WORD_NUMBERS.test(normalized) || /\d+/.test(raw)) &&
        /\b(channel|communit|group|chat)\w*\b/i.test(normalized);
      const channelManagementNoNumber = /\b(i\s+|we\s+)(manage|run|lead|operat|head)\w*\s+(active\s+|trusted\s+|large\s+|big\s+|whale\s+|crypto\s+|trading\s+|investor\s+)*(channel|communit|group|chat)/i.test(normalized);
      const marketingBuzzwords = /\b(engag|volume|growth|grow\s*(faster|quick)|mc\b|market\s*cap|investor|serious\s*investor|right\s*audience|sustain|expan|promot|boost|collaborat|partner|listing\s*cooperat)/i.test(normalized);
      return (channelManagementClaim || channelManagementNoNumber) && marketingBuzzwords;
    },
  },
  {
    name: "coldPitchPromo",
    description: "Cold-pitch promotion offers, paid promo services, influencer marketing pitches",
    reason: "Cold-pitch promotion / paid promo service offer",
    detect: (normalized, raw) =>
      /\b(promo|promot(e|ion|ing)|market(ing)?|boost(ing)?|advertis(e|ing)|shill(ing)?)\s*.{0,30}\b(your|ur)\s*(project|token|coin|community|group|channel)\b/i.test(normalized) ||
      /\b(we\s*(will|can|offer|provide|do)|i\s*(will|can|offer|provide|do))\s*(promo|promot(e|ion|ing)|market(ing)?|boost(ing)?|advertis(e|ing)|shill(ing)?|trend(ing)?|list(ing)?)\s*.{0,20}\b(your|ur)\b/i.test(normalized) ||
      /\b(low\s*cost|cheap|affordable|best\s*price|discount|free\s*trial)\b.{0,40}\b(promo|promot|market|boost|advertis|listing|trending)/i.test(normalized) ||
      /\b(promo|promot|market|boost|advertis|listing|trending)\b.{0,40}\b(low\s*cost|cheap|affordable|best\s*price|discount|free\s*trial)/i.test(normalized) ||
      /\b(top|best|big|major)\s*(channel|group|platform)s?\b.{0,30}\b(low\s*cost|cheap|affordable|promo|promot|advertis)/i.test(normalized) ||
      (/\b(crypto\s*project|your\s*(project|token|coin|brand))\b/i.test(normalized) && /\b(growth|exposure|followers?|campaign|media\s*kit|viral)\b/i.test(normalized)) ||
      (/\b(elevat|grow|scale|skyrocket|supercharg|amplif|maximiz)\w*\s*(your|ur)\s*(crypto|project|token|coin|brand|community)\b/i.test(normalized)) ||
      (/\b(media\s*kit|rate\s*card|pricing\s*sheet)\b/i.test(normalized) && /\b(campaign|promo|promot|advertis|partner|collaborat)\b/i.test(normalized)) ||
      (/\b(partner\s*with)\b/i.test(normalized) && /\b(growth|exposure|followers?|viral|engag|massive|authentic)\b/i.test(normalized) && /\b(crypto|tiktok|twitter|youtube|influenc)\b/i.test(normalized)) ||
      (/\b\d+[\s,]*\d*(?:[kKmM])?\+?\s*(followers?|subscribers?|members?|audience|enthusiasts?)\b/i.test(raw) && /\b(crypto|project|token|coin|campaign|promo|growth|exposure)\b/i.test(normalized) && /\b(partner|collaborat|promot|advertis|offer|provide|elevat|grow|boost|media\s*kit|campaign|viral|drop\s*(us|me)\s*(a\s*)?message)\b/i.test(normalized)),
  },
  {
    name: "promoForHireSpam",
    description: "Paid promotion services advertising reach on Twitter/Telegram accounts and channels",
    reason: "Promo-for-hire spam (paid promotion service pitch)",
    detect: (normalized, raw) =>
      (/\b(i\s*will|we\s*will|i\s*can|we\s*can)\s*(promot|market|boost|advertis|shill)\w*\s*(your|ur)\s*(post|project|token|coin|brand|content)\b/i.test(normalized) && /\b(twitter|telegram|youtube|tiktok|instagram|discord|channel|account|group)\b/i.test(normalized)) ||
      (/\b(promot|market|boost|advertis)\w*\s*(your|ur)\s*(post|project|token|coin|brand|content)\b/i.test(normalized) && /\b\d+\s*(active\s*)?(twitter|telegram|youtube|tiktok|instagram|discord|channel|account|group)s?\b/i.test(raw)) ||
      (/\b(i\s*provide|we\s*provide|i\s*offer|we\s*offer)\s*(strong|real|reliable|massive|organic|quality|best|top)?\s*(promot|market|boost|advertis|visibilit|expos)/i.test(normalized) && /\b(dm|pm|inbox|message|contact)\s*(me|us)\b/i.test(normalized)) ||
      (/\b(promot|market|boost|advertis)\w*\s*(your|ur)\s*(post|project|token|coin|brand|content)\s*(on|across|to)\s*\d+/i.test(raw) && /\b(dm|pm|inbox|message|contact|reach|free\s*to)\b/i.test(normalized)) ||
      (/\b(strong|real|reliable|massive)\s*(promot|visibilit|reach|expos)/i.test(normalized) && /\b\d+\s*(active\s*)?(twitter|telegram|youtube|channel|account|group)s?\b/i.test(raw) && /\b(dm|pm|inbox|message|contact|free\s*to)\b/i.test(normalized)),
  },
  {
    name: "volumeServiceSpam",
    description: "Offering volume/liquidity services, community-backed pumping",
    reason: "Volume/liquidity service spam (unsolicited paid service)",
    detect: (normalized, raw) =>
      (/\b(i\s*(will|can)|we\s*(will|can))\s*(provide|offer|deliver|generate|create|make|do|give|bring|get)\b/i.test(normalized) && /\b(volume|liquidity|trading|holders?|pin\s*post)\b/i.test(normalized) && /\b(my\s*(community|channel|group)|check\s*out|support)\b/i.test(normalized)) ||
      (/\b(i\s*(will|can)|we\s*(will|can))\s*(provide|offer|deliver|generate)\b.{0,30}\b\d+[-–—]\d+k?\s*(volume|liquidity|holders?)\b/i.test(raw)) ||
      (/\b(pin\s*post|pinned\s*post)\b/i.test(normalized) && /\b(my\s*(community|channel|group))\b/i.test(normalized) && /\b(volume|support|promo|boost|service)\b/i.test(normalized)),
  },
  {
    name: "tokenCallCard",
    description: "Formatted token shill posts with contract addresses and market data",
    reason: "Token call card spam (contract address + market data shill)",
    detect: (_normalized, raw) =>
      (/0x[a-f0-9]{40}/i.test(raw) && /\b(vol|volume|mc|market\s*cap|liq|liquidity)\b/i.test(raw)) ||
      (/0x[a-f0-9]{40}/i.test(raw) && /[+\-]\d+[\d.]*%/.test(raw) && /\b(safety|score|audit)\b/i.test(raw)) ||
      (/\b(vol|volume)\b.{0,15}\b(mc|market\s*cap)\b/i.test(raw) && /\b(liq|liquidity)\b/i.test(raw) && /[+\-]\d+[\d.]*%/.test(raw) && (/0x[a-f0-9]{40}/i.test(raw) || /[📊💹💰📋🔗]/.test(raw))) ||
      (/\b(CA|contract)\b.{0,20}(0x[a-f0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})/i.test(raw) && /\b(vol|volume|mc|market\s*cap|liq|liquidity|pump)\b/i.test(raw)),
  },
  {
    name: "cryptoGiveawayScam",
    description: "Fake crypto giveaways offering free tokens/coins via DM",
    reason: "Crypto giveaway / free token scam",
    detect: (normalized, raw) =>
      /\b(giv(e|ing)\s*(away|out|free|you|them|my))\b.{0,40}\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i.test(normalized) ||
      /\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b.{0,40}\b(giv(e|ing)\s*(away|out|free))\b/i.test(normalized) ||
      /\b(first\s*\d+(\s*(lucky\s*)?(people|person|member|holder|user|follower)s?)?)\b.{0,60}\b(sol|eth|btc|bnb|usdt|crypto|token|coin|give|free|win|claim|airdrop)\b/i.test(raw) ||
      (/\b(first\s*\d+(\s*(lucky\s*)?(people|person|member|holder|user|follower)s?)?)\b.{0,60}\b(dm|pm|message|inbox)\b/i.test(raw) && (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft|give|free|airdrop)\b/i.test(normalized) || /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(raw))) ||
      /\b(i\s*)?(will|am|'m|want\s*to|wanna|gonna|going\s*to)\s*(giv(e|ing)|send(ing)?|distribut(e|ing)|drop(ping)?)\b.{0,40}\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i.test(normalized) ||
      (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b.{0,60}\b(first\s*\d+(\s*(lucky\s*)?(people|person|member|holder|user|follower)s?)?)\b/i.test(raw) && /\b(give|send|dm|pm|message|contact|free|claim|win|airdrop)\b/i.test(normalized)) ||
      /\b(giv(e|ing)\s*(some|away|out|free|you|them|my|the))\b.{0,40}\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i.test(normalized) ||
      (/\b(contact|reach|hit)\s*me\b.{0,40}\b(sol|eth|btc|bnb|usdt|wallet|address|crypto)\b/i.test(normalized) && /\b(give|free|send|airdrop|first\s*\d+|claim)\b/i.test(raw)) ||
      /\b(not\s*interested\s*in\s*crypto|don'?t\s*(want|need)\s*(the\s*)?(crypto|sol|eth|btc))\b.{0,60}\b(dm|pm|message|give|free)\b/i.test(normalized) ||
      (/\bgiveaway\b/i.test(normalized) && /\b(dm|pm|message|inbox)\b/i.test(normalized) && (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i.test(normalized) || /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(raw))) ||
      (/\b(dm|pm|message)\b/i.test(normalized) && /\b(get|gets|receive|claim|win)\b/i.test(normalized) && /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(raw)) ||
      (/\b(first|frist)\s*(to\s*)?(dm|pm|message)\b/i.test(normalized) && (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft|free|giveaway|give)\b/i.test(normalized) || /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(raw))) ||
      (/\b(first\s*\d+)\b.{0,40}\b(dm|pm|message)\b/i.test(raw) && /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(raw)) ||
      (/\b(free|giveaway)\b/i.test(normalized) && /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(raw)),
  },
  {
    name: "sexualSpam",
    description: "Sexual emoji spam combined with DM solicitation",
    reason: "Solicitation/adult spam",
    detect: (normalized, raw) => {
      const sexualEmojis = ['🍆', '🍑', '💦', '🔥', '🥵', '😈', '💋'];
      return sexualEmojis.some(e => raw.includes(e)) && /\b(inbox|dm|pm|message|contact|send)\b/i.test(normalized);
    },
  },
  {
    name: "solicitationSpam",
    description: "Generic solicitation with DM requests",
    reason: "Solicitation/adult spam",
    detect: (normalized) =>
      /\b(inbox|dm|pm)\b/i.test(normalized) && /\b(fun|service|interest|offer|available)\b/i.test(normalized),
  },
  {
    name: "raidShillSpam",
    description: "Raid team, shill squad, engagement boosting services",
    reason: "Raid/shill/boost bot promotion spam",
    detect: (normalized) =>
      /\b(raid\s*(team|group|squad|crew|service)s?|raid\s*team\s*of\s*\d+|shill(er)?s?\s*(team|group|squad|crew|service)s?|shill(er)?s?\s*to\s*boost|raider(s)?\s*(and|&)\s*shill(er)?s?|verified\s*(raider|shiller)s?|boost(ing)?\s*engag(ement|e)|engag(ement|e)\s*boost(ing|er|service|team|farm)?|free\s*test\s*run|paid\s*(raid|shill|promo|market)|hire\s*(raid|shill|market))\b/i.test(normalized),
  },
  {
    name: "paidServiceSpam",
    description: "Paid growth/marketing/listing/trending services",
    reason: "Raid/shill/boost bot promotion spam",
    detect: (normalized) =>
      /\b(growth\s*service|marketing\s*service|promotion\s*service|listing\s*service|trending\s*service|cmc\s*(list|trend)|coingecko\s*(list|trend)|dextools\s*trend|twitter\s*(raid|growth|boost)|telegram\s*(growth|member|boost))\b/i.test(normalized),
  },
  {
    name: "boostBotPromo",
    description: "Promoting boost/trend/pump bots or services",
    reason: "Raid/shill/boost bot promotion spam",
    detect: (normalized, raw) =>
      /@\w*(boost|trend|trending|pump|volume|shill|raid)\w*bot\b/i.test(raw) ||
      /\b(get|getting)\s*(us|a)\s*(a\s*)?(spot|listed|trending|featured)\b.{0,40}\b(bot|service|channel)\b/i.test(normalized) ||
      /\b(look\s*into|check\s*out|try|use)\b.{0,30}@\w*(boost|trend|pump|shill|raid)\w*/i.test(raw),
  },
  {
    name: "telegramInviteLink",
    description: "Unsolicited Telegram group/channel invite links",
    reason: "Unsolicited Telegram invite link spam",
    detect: (_normalized, raw) =>
      /(?:t\.me|telegram\.me)\/(\+|joinchat\/)[A-Za-z0-9_-]+/i.test(raw),
  },
  {
    name: "groupPromoShill",
    description: "Telegram group link + call-to-action to join/follow",
    reason: "Telegram group/channel promotion spam",
    detect: (normalized, raw) => {
      const hasTgLink = /t\.me\/[A-Za-z0-9_]+/i.test(raw);
      return hasTgLink && (
        /\b(join|check\s*out|visit|come\s*to|head\s*to|look\s*at)\b/i.test(normalized) &&
        /\b(tag|follow|support|help|pls|please|guys|fam|fren|ape)\b/i.test(normalized)
      );
    },
  },
  {
    name: "unsolicitedGroupLink",
    description: "Telegram link with 'join us/our/my' language",
    reason: "Telegram group/channel promotion spam",
    detect: (normalized, raw) => {
      const hasTgLink = /t\.me\/[A-Za-z0-9_]+/i.test(raw);
      return hasTgLink && /\b(join\s*(us|our|my|this|the)|come\s*join|check\s*(this|my|our)|new\s*(group|channel|community))\b/i.test(normalized);
    },
  },
  {
    name: "dmWithUsername",
    description: "DM/PM + @username combined with service/scam keywords",
    reason: "Aggressive DM solicitation spam",
    detect: (normalized) =>
      /\b(dm|pm)\s*.{0,5}@\w+/i.test(normalized) && /\b(call|signal|insider|profit|trade|print|miss|join|part|sticker|logo|banner|design|animation|website|promo|nft|mascot|gif|emoji|video|meme|drawing|whitepaper|white\s*paper|branding|graphic)s?\b/i.test(normalized),
  },
  {
    name: "insiderCallSpam",
    description: "Insider trading calls, VIP signal groups, paid call scams",
    reason: "Insider trading / paid call scam",
    detect: (normalized) =>
      (/\b(insider|my\s*(call|signal)|vip\s*(call|group|channel|access)|paid\s*(call|group|signal)|fading\s*me)\b/i.test(normalized) && /\b(dm|pm)\s*.{0,10}@\w+/i.test(normalized)) ||
      /\binsider\b.{0,20}\b(cook|member|call|signal|group)s?\b.{0,30}(print|profit|money|gain|earning)/i.test(normalized) ||
      /\bdrop\s*(cook|call|signal)s?\b.{0,20}(print|profit|member)/i.test(normalized) ||
      /\b(inner\s*circle|private\s*circle)\b.{0,40}(print|profit|\dx|\d+x\b|money|earning|gain)/i.test(normalized) ||
      /\d+(\.\d+)?x\s*(done|profit|gain|made)\b.{0,30}\b(inner|circle|member|private)/i.test(normalized),
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
      (/\b(buy|sell|pay(ing)?)\b.{0,30}\b(wall+ets?|accounts?)\b.{0,30}\b(history|transactions?|old|empty|aged|dead|month|year)\b/i.test(normalized)) ||
      (/\b(need|want|looking\s*for)\b.{0,30}\b(wall+ets?|accounts?)\b.{0,30}\b(history|transactions?|old|empty|aged|dead|month|year)\b/i.test(normalized) && /\b(pay|buy|sol|eth|usdt|write\s*me|contact|dm|pm)\b/i.test(normalized)) ||
      (/\b(need|want|looking\s*for)\b.{0,30}\b(wall+ets?|accounts?)\b.{0,30}\b(history|transactions?|old|empty|aged|dead|month|year)\b/i.test(normalized) && /\d+\s*(sol|eth|usdt|btc|bnb)\b/i.test(raw)) ||
      /\b(old|empty|aged|dead)\s*(wall+ets?|accounts?|tokens?)\b.{0,60}\b(pay|buy|sell|solana|sol|eth|usdt|btc)\b/i.test(normalized) ||
      (/\b(need|want|looking\s*for)\b.{0,15}\b(old|empty|aged|dead)\b.{0,15}\b(wall+ets?|accounts?|tokens?)\b/i.test(normalized) && /\b(pay|buy|sol|eth|usdt|write\s*me|contact|dm|pm)\b/i.test(normalized)) ||
      (/\b(need|want)\b.{0,30}\b(wall+ets?|accounts?)\b.{0,60}\b(pay|buy|paying)\b/i.test(raw) && /\d+\s*(sol|eth|usdt|btc|bnb)\b/i.test(raw)) ||
      (/\b(wall+ets?|accounts?)\s*(with|that\s*(has|have))\s*.{0,40}(transactions?|history|activit|dead\s*tokens?)/i.test(normalized) && /\b(pay|buy|sell|sol|eth|usdt|write\s*me|contact|dm|pm|need|want)\b/i.test(normalized)) ||
      (/\b(wall+ets?|accounts?)\s*(with|that\s*(has|have))\s*.{0,40}(transactions?|history|activit|dead\s*tokens?)/i.test(normalized) && /\d+\s*(sol|eth|usdt|btc|bnb)\b/i.test(raw)) ||
      (/\b(need|want|looking\s*for|buy)\b.{0,30}\b(solana|sol|eth|ethereum|crypto|btc|bitcoin)\b.{0,20}\b(wall+ets?|accounts?)\b/i.test(normalized) && /\b(pay|buy|write\s*me|contact|dm|pm)\b/i.test(normalized)) ||
      (/\b(need|want|looking\s*for|buy)\b.{0,30}\b(solana|sol|eth|ethereum|crypto|btc|bitcoin)\b.{0,20}\b(wall+ets?|accounts?)\b/i.test(normalized) && /\d+\s*(sol|eth|usdt|btc|bnb)\b/i.test(raw)) ||
      (/\b(plenty|dead)\s*(tokens?)\b/i.test(normalized) && /\b(wall+ets?|accounts?)\b/i.test(normalized) && /\b(pay|buy|need|want|sell)\b/i.test(normalized)),
  },
  {
    name: "pumpPromoSpam",
    description: "Token pump services, paid promotion on telegram channels",
    reason: "Token pump / paid promotion service offer",
    detect: (normalized) =>
      /\b(pump|boost)\s*(your|ur)\s*(token|project|coin|mc|market\s*cap)\b/i.test(normalized) ||
      /\b(i\s*(can|will)\s*(pump|boost|promote))\b.{0,40}\b(token|project|coin|mc|market\s*cap|profit)\b/i.test(normalized) ||
      /\bpromotion\s*on\s*my\s*(telegram|channel|group)\b/i.test(normalized) ||
      /\b(investor|holder)s?\s*(who\s*will|that\s*will|to)\s*(pump|buy|invest)/i.test(normalized) ||
      /\b(contact|message|reach)\s*(me|us)\s*(in\s*)?(my\s*)?(inbox|dm|pm)\b.{0,30}\b(pump|promo|boost)/i.test(normalized),
  },
  {
    name: "investmentServicePitch",
    description: "OTC capital, institutional investors, strategic funding pitches",
    reason: "Unsolicited OTC / investment service pitch",
    detect: (normalized) =>
      (/\b(i\s*help|we\s*help|i\s*connect|we\s*connect|we\s*unlock|i\s*unlock)\b/i.test(normalized) && /\b(otc|capital|fund(ing|s)?|institutional|strategic\s*(investor|buyer)|liquidity|market\s*disruption)\b/i.test(normalized)) ||
      /\b(are\s*you\s*open\s*(for|to))\b.{0,40}\b(otc|invest|capital|fund|partner)/i.test(normalized) ||
      (/\b(otc\s*(capital|deal|invest|round|fund|buy|service|partner|opportunit))/i.test(normalized) && /\b(unlock|access|enabl|private|institutional|strategic)\b/i.test(normalized)) ||
      /\b(unlock|access|secur)\b.{0,20}\$?\d+[km]?\s*[-–—]?\s*\$?\d*[km]?\s*(in\s*)?(capital|fund|invest|otc|liquidity)/i.test(normalized),
  },
  {
    name: "revenueSplitScam",
    description: "Multi-language revenue split pitches with percentage claims and @handle",
    reason: "Revenue split scam — percentage split pitch with contact handle",
    detect: (_normalized, raw) => {
      const percentages = raw.match(/\d+\s*%%?/g) || [];
      const hasAtHandleAtEnd = /@\w{3,}\s*$/.test(raw.trim());
      const multiLine = raw.split(/\n/).length >= 3;
      return (percentages.length >= 2 && hasAtHandleAtEnd && multiLine) ||
        (/\d+\s*(a|to|-|–|—)\s*\d+\s*(?:k|mil)\b/i.test(raw) && percentages.length >= 1 && hasAtHandleAtEnd && multiLine);
    },
  },
  {
    name: "formattedPitchScam",
    description: "Formatted scam pitches with checkmark bullets, urgency emojis, and @handle",
    reason: "Formatted scam pitch — checkmark bullet list with urgency emojis and contact handle",
    detect: (_normalized, raw) => {
      const checkmarkCount = (raw.match(/✅/g) || []).length;
      const hasAtHandleAtEnd = /@\w{3,}\s*$/.test(raw.trim());
      const multiLine = raw.split(/\n/).length >= 3;
      return checkmarkCount >= 3 && hasAtHandleAtEnd && /[🚨💰⚠️❗]/.test(raw) && multiLine;
    },
  },
  {
    name: "emojiDmSolicitation",
    description: "Using email/message emojis as DM solicitation",
    reason: "Aggressive DM solicitation spam",
    detect: (_normalized, raw) =>
      /[📩📬📭📮✉💌📧]\s*(me|us|now)\b/i.test(raw) || /\b(send|drop|shoot)\s*(a\s*)?[📩📬📭📮✉💌📧]/i.test(raw),
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
  const hasMultiplierClaim = /\b(\d{2,})\s*[-–—]?\s*(\d+)?\s*[xхΧχ×](?=\s|$|[^\w])|\b\d+[xхΧχ×]\s*(gain|return|profit|potential|move|play|gem|from\s*here)\b/i.test(raw);
  const hasPumpHypeLanguage = /\b(low[\s-]*(cap|mc)\s*(gem|play|pick|token|coin)?|hidden\s*gems?|new\s*gems?|found\s*.{0,10}gems?|next\s*\d+x|next\s*(play|move|call|gem)|moon\s*(shot|play|bag)|whale|rotate|rotating|accumulating|load(ing|ed)\s*(up|bag)|eye(ing)?\s*(a\s*few|some|these)|ape[ds]?\s*(in|into|now|early|before|this|it)|degen\s*(play|call|move)|don'?t\s*(sleep|fade)|early\s*(entry|bird|call)|bag\s*(these|this|it|now)|about\s*to\s*(pop|explode|moon|pump|rip|run|send|fly|break\s*out)|fill\s*(your|ur)\s*bag|lfg+\b|something\s*(huge|big|massive)\s*(is\s*)?(coming|brewing|loading|cooking)|get\s*ready|plays?\s*loading|print(ing)?\s*(money|gains?)|gonna\s*(be\s*)?print(ing)?)\b/i.test(normalized);
  const hasFomoUrgency = /🔥.*💸|💸.*🔥|🚀.*💰|💰.*🚀|🚀\s*🚀|🔥\s*🔥|\b(before\s*(it'?s?\s*too\s*late|the\s*(pump|train|bus|ship)|whales|liftoff|breakout|everyone)|still\s*early|not\s*too\s*late|thank\s*me\s*later|you'?ll\s*regret|mark\s*my\s*words|remember\s*(this|i\s*told)|nfa\s*(but|tho|though)|this\s*is\s*(it|the\s*one)|train\s*leav(es|ing)|make\s*sure.{0,20}don'?t\s*miss|don'?t\s*miss\s*out|secure\s*(your|a|my)\s*(spot|place|position|allocation|slot))\b/i.test(normalized) || /🔥\s*🔥/i.test(raw) || /\b(in\s*private)\b.{0,20}\b\d+x\b/i.test(raw);
  const hasLowMcGemShill = /\b(low[\s-]*(cap|mc)|gems?)\b/i.test(normalized) && /\b(found|new|hidden|just\s*launched|launched)\b/i.test(normalized) && /\b(gem|mc|cap)\b/i.test(normalized);

  return { hasMultiplierClaim, hasPumpHypeLanguage, hasFomoUrgency, hasLowMcGemShill, isForwardedMessage: isForwarded };
}

export function isFinancialShillHype(signals: FinancialHypeSignals): boolean {
  return (signals.hasMultiplierClaim && signals.hasPumpHypeLanguage) ||
    (signals.hasMultiplierClaim && signals.hasFomoUrgency) ||
    (signals.hasPumpHypeLanguage && signals.hasFomoUrgency) ||
    signals.hasLowMcGemShill ||
    (signals.isForwardedMessage && (signals.hasMultiplierClaim || signals.hasPumpHypeLanguage || signals.hasFomoUrgency));
}

export function runAllPatterns(normalized: string, raw: string): Map<string, boolean> {
  const results = new Map<string, boolean>();
  for (const pattern of scamPatterns) {
    results.set(pattern.name, pattern.detect(normalized, raw));
  }
  return results;
}

export function getPatternReason(name: string): string {
  const pattern = scamPatterns.find(p => p.name === name);
  return pattern?.reason || "Unknown scam pattern";
}
