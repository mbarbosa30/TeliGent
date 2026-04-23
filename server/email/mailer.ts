import { renderVerificationEmail, renderPasswordResetEmail } from "./templates";

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

const FROM_EMAIL = process.env.MAIL_FROM || "TeliGent <noreply@teli.gent>";

let resendClientPromise: Promise<any> | null = null;

async function getResendClient(): Promise<any | null> {
  if (resendClientPromise) return resendClientPromise;
  resendClientPromise = (async () => {
    try {
      const mod = await import("./resend");
      return await mod.getResendClient();
    } catch (err: any) {
      if (err?.code !== "ERR_MODULE_NOT_FOUND" && err?.code !== "MODULE_NOT_FOUND") {
        console.warn("[mailer] resend client unavailable:", err?.message || err);
      }
      return null;
    }
  })();
  return resendClientPromise;
}

export async function sendEmail({ to, subject, html, text }: SendArgs): Promise<{ delivered: boolean; via: "resend" | "console" }> {
  const client = await getResendClient();
  if (!client) {
    console.warn(`[mailer] (no provider) would send to=${to} subject="${subject}"\n--- TEXT ---\n${text}\n--- END ---`);
    return { delivered: false, via: "console" };
  }
  try {
    await client.emails.send({ from: FROM_EMAIL, to, subject, html, text });
    return { delivered: true, via: "resend" };
  } catch (err: any) {
    console.error("[mailer] resend send failed:", err?.message || err);
    return { delivered: false, via: "console" };
  }
}

export async function sendVerificationEmail(to: string, link: string) {
  const { html, text, subject } = renderVerificationEmail(link);
  return sendEmail({ to, subject, html, text });
}

export async function sendPasswordResetEmail(to: string, link: string) {
  const { html, text, subject } = renderPasswordResetEmail(link);
  return sendEmail({ to, subject, html, text });
}
