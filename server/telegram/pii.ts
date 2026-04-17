export function redactPII(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(/0x[a-fA-F0-9]{40}/g, "[wallet]");
  out = out.replace(/[13][a-km-zA-HJ-NP-Z1-9]{25,34}/g, "[wallet]");
  out = out.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email]");
  out = out.replace(/\+?\d[\d\s\-().]{8,}\d/g, "[phone]");
  out = out.replace(/\b(?:\d[ -]*?){13,19}\b/g, "[card]");
  return out;
}

export function extractKeywords(text: string, max = 8): string[] {
  const stop = new Set(["the","and","for","with","this","that","have","from","what","when","where","your","you","are","but","not","can","will","was","they","them","his","her","its","our","all","any","one","two","just","like","get","got","how","why","who","into","out","about","over","more","most","some","any","than","then","now","new","very","much","many","also","only","really","actually","still","even","ever","never","yes","no","ok"]);
  const words = redactPII(text).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 3 && !stop.has(w));
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  return Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
}

const PII_KEYWORD_PATTERNS = [
  /^0x[a-f0-9]{6,}/i,
  /@[a-z0-9._-]+\.[a-z]{2,}/i,
  /\b\d{6,}\b/,
  /\[wallet\]|\[email\]|\[phone\]|\[card\]/i,
];

export function sanitizeKeywords(keywords: string[]): string[] {
  return keywords
    .map(k => redactPII(String(k)).toLowerCase().trim())
    .filter(k => k.length >= 2 && k.length <= 24)
    .filter(k => !PII_KEYWORD_PATTERNS.some(p => p.test(k)))
    .map(k => k.replace(/[^a-z0-9_-]/g, ""))
    .filter(Boolean);
}
