function shell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e5e5;">
        <tr><td style="padding:20px 24px;border-bottom:1px solid #e5e5e5;">
          <div style="font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#666;">TeliGent</div>
        </td></tr>
        <tr><td style="padding:28px 24px 32px 24px;font-size:15px;line-height:1.55;">${bodyHtml}</td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #e5e5e5;font-size:11px;color:#888;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;">
          You received this because someone used this email to interact with TeliGent. If that was not you, you can safely ignore this message.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function buttonHtml(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0;"><tr><td style="background:#111;">
    <a href="${href}" style="display:inline-block;padding:12px 22px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:.02em;">${label}</a>
  </td></tr></table>`;
}

export function renderVerificationEmail(link: string): { subject: string; html: string; text: string } {
  const subject = "Verify your TeliGent email";
  const body = `
    <p style="margin:0 0 12px 0;">Confirm this is your email so you can manage your TeliGent account, take payments, and register on-chain identities.</p>
    ${buttonHtml(link, "Verify email")}
    <p style="margin:0 0 8px 0;font-size:13px;color:#555;">Or paste this link into your browser:</p>
    <p style="margin:0;word-break:break-all;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;color:#333;">${link}</p>
    <p style="margin:18px 0 0 0;font-size:12px;color:#888;">This link expires in 24 hours.</p>`;
  const text = [
    "Verify your TeliGent email",
    "",
    "Confirm this is your email so you can manage your TeliGent account, take payments, and register on-chain identities.",
    "",
    `Open this link to verify: ${link}`,
    "",
    "This link expires in 24 hours.",
    "If you did not request this, you can safely ignore this message.",
  ].join("\n");
  return { subject, html: shell(subject, body), text };
}

export function renderPasswordResetEmail(link: string): { subject: string; html: string; text: string } {
  const subject = "Reset your TeliGent password";
  const body = `
    <p style="margin:0 0 12px 0;">We received a request to reset your TeliGent password. Click below to choose a new one.</p>
    ${buttonHtml(link, "Reset password")}
    <p style="margin:0 0 8px 0;font-size:13px;color:#555;">Or paste this link into your browser:</p>
    <p style="margin:0;word-break:break-all;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;color:#333;">${link}</p>
    <p style="margin:18px 0 0 0;font-size:12px;color:#888;">This link expires in 60 minutes. Other active sessions will be signed out once you reset.</p>`;
  const text = [
    "Reset your TeliGent password",
    "",
    "We received a request to reset your TeliGent password.",
    "",
    `Open this link to choose a new password: ${link}`,
    "",
    "This link expires in 60 minutes.",
    "Other active sessions will be signed out once you reset.",
    "If you did not request this, you can safely ignore this message.",
  ].join("\n");
  return { subject, html: shell(subject, body), text };
}
