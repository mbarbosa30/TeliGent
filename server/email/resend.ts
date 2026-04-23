let cached: any | null | undefined;

export async function getResendClient(): Promise<any | null> {
  if (cached !== undefined) return cached;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    cached = null;
    return null;
  }
  try {
    const mod: any = await import("resend").catch(() => null);
    const Resend = mod?.Resend;
    if (!Resend) {
      console.warn("[email/resend] 'resend' package not installed yet. Email delivery is disabled.");
      cached = null;
      return null;
    }
    cached = new Resend(apiKey);
    return cached;
  } catch (err: any) {
    console.warn("[email/resend] failed to init Resend:", err?.message || err);
    cached = null;
    return null;
  }
}
