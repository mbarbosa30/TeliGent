import { convert } from "html-to-text";

export async function scrapeUrl(url: string): Promise<string> {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }
  const hostname = parsed.hostname.toLowerCase();
  const isPrivateIp = (h: string): boolean => {
    if (h === "localhost" || h === "0.0.0.0" || h === "[::1]" || h === "::1") return true;
    if (h.endsWith(".internal") || h.endsWith(".local")) return true;
    const parts = h.split(".").map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      if (parts[0] === 10) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 127) return true;
      if (parts[0] === 169 && parts[1] === 254) return true;
      if (parts[0] === 0) return true;
    }
    const stripped = h.replace(/^\[|\]$/g, "");
    if (stripped.includes(":")) {
      const lower = stripped.toLowerCase();
      if (lower === "::1" || lower === "::" || lower === "::0") return true;
      if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
      if (lower.startsWith("fe80")) return true;
      if (lower.startsWith("::ffff:")) return true;
      if (lower.startsWith("100:") || lower.startsWith("2001:db8")) return true;
    }
    return false;
  };
  if (isPrivateIp(hostname)) {
    throw new Error("Internal/private URLs are not allowed");
  }
  const dns = await import("dns");
  const resolved = await dns.promises.resolve4(hostname).catch(() => [] as string[]);
  const resolved6 = await dns.promises.resolve6(hostname).catch(() => [] as string[]);
  for (const ip of [...resolved, ...resolved6]) {
    if (isPrivateIp(ip)) {
      throw new Error("Internal/private URLs are not allowed");
    }
  }
  let finalUrl = url;
  let response: globalThis.Response;
  let redirectCount = 0;
  const maxRedirects = 5;
  while (true) {
    response = await fetch(finalUrl, {
      headers: { "User-Agent": "TeliGent/1.0" },
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      if (++redirectCount > maxRedirects) throw new Error("Too many redirects");
      const redirectUrl = new URL(response.headers.get("location")!, finalUrl);
      const rHost = redirectUrl.hostname.toLowerCase();
      if (isPrivateIp(rHost)) throw new Error("Redirect to internal/private URL is not allowed");
      const rResolved = await dns.promises.resolve4(rHost).catch(() => [] as string[]);
      const rResolved6 = await dns.promises.resolve6(rHost).catch(() => [] as string[]);
      for (const ip of [...rResolved, ...rResolved6]) {
        if (isPrivateIp(ip)) throw new Error("Redirect to internal/private URL is not allowed");
      }
      finalUrl = redirectUrl.toString();
      continue;
    }
    break;
  }
  if (!response!.ok) {
    throw new Error(`Failed to fetch website: ${response!.status}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error("URL must return HTML or text content");
  }
  const html = await response.text();
  const text = convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "noscript", format: "skip" },
      { selector: "svg", format: "skip" },
      { selector: "nav", format: "skip" },
      { selector: "footer", format: "skip" },
      { selector: "header", format: "skip" },
      { selector: "aside", format: "skip" },
      { selector: "iframe", format: "skip" },
    ],
    limits: { maxInputLength: 500000 },
  });
  return text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .replace(/^ +| +$/gm, "")
    .trim()
    .slice(0, 10000);
}
