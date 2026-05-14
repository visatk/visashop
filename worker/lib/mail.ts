/**
 *  Resend email client.
 *
 *  We use the REST API directly (not the SDK) because the SDK currently
 *  pulls in dependencies that bloat the Worker bundle. The signatures
 *  below mirror the SDK shapes for familiarity.
 */
import type { AppEnv } from '../env';

interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
}

export async function sendEmail(env: AppEnv, args: SendArgs): Promise<{ id?: string; error?: string }> {
  if (!env.RESEND_API_KEY) {
    console.warn('[mail] RESEND_API_KEY missing — email not sent');
    return { error: 'mailer-not-configured' };
  }
  const body = {
    from: env.MAIL_FROM,
    to: Array.isArray(args.to) ? args.to : [args.to],
    subject: args.subject,
    html: args.html,
    text: args.text,
    reply_to: args.replyTo ?? env.MAIL_REPLY_TO,
    tags: args.tags,
  };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('[mail] resend failed', res.status, t);
    return { error: `resend-${res.status}` };
  }
  const json = (await res.json()) as { id: string };
  return { id: json.id };
}

/* -------------------------- Email templates ------------------------------- */

const baseShell = (env: AppEnv, content: string) => /* html */ `
<!doctype html>
<html lang="en">
<body style="margin:0;background:#f5f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1623;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border-radius:14px;border:1px solid #e7e5ec;padding:32px;">
      <div style="font-size:18px;font-weight:600;margin-bottom:24px;color:#5b2dba;">${env.APP_NAME}</div>
      ${content}
    </div>
    <p style="font-size:12px;color:#8a8794;text-align:center;margin-top:16px;">
      ${env.APP_NAME} · <a href="${env.APP_URL}" style="color:#8a8794;">${new URL(env.APP_URL).host}</a>
    </p>
  </div>
</body>
</html>`;

export function welcomeEmail(env: AppEnv, name: string) {
  return baseShell(
    env,
    `<h2 style="margin:0 0 12px;font-size:22px;">Welcome${name ? ', ' + escape(name) : ''}!</h2>
     <p>Your ${env.APP_NAME} account is ready.</p>
     <p style="margin-top:16px;"><a href="${env.APP_URL}/account" style="background:#5b2dba;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;">Go to your account</a></p>`,
  );
}

export function orderCreatedEmail(env: AppEnv, args: {
  orderNumber: string;
  amount: string;
  currency: string;
  cryptoCurrency: string;
  cryptoAddress: string;
  cryptoAmount: string;
  payUrl: string;
}) {
  return baseShell(
    env,
    `<h2 style="margin:0 0 12px;font-size:22px;">Order ${escape(args.orderNumber)} created</h2>
     <p>Send <strong>${escape(args.cryptoAmount)} ${escape(args.cryptoCurrency.toUpperCase())}</strong> (~${escape(args.amount)} ${escape(args.currency)}) to:</p>
     <pre style="background:#f4f3ec;padding:12px;border-radius:8px;font-size:13px;overflow-x:auto;">${escape(args.cryptoAddress)}</pre>
     <p style="margin-top:16px;"><a href="${args.payUrl}" style="background:#5b2dba;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;">View payment page</a></p>
     <p style="font-size:13px;color:#6b6375;margin-top:16px;">Once your transaction confirms (1+ confirmation) we will deliver your products instantly.</p>`,
  );
}

export function orderFulfilledEmail(env: AppEnv, args: {
  orderNumber: string;
  items: { name: string; key?: string; downloadUrl?: string }[];
}) {
  const itemsHtml = args.items
    .map(
      (it) => `
        <div style="border-top:1px solid #efeef3;padding:12px 0;">
          <div style="font-weight:600;">${escape(it.name)}</div>
          ${it.key ? `<div style="font-family:ui-monospace,Consolas,monospace;background:#f4f3ec;padding:8px;border-radius:6px;margin-top:6px;">${escape(it.key)}</div>` : ''}
          ${it.downloadUrl ? `<div style="margin-top:6px;"><a href="${it.downloadUrl}" style="color:#5b2dba;">Download (link valid for 1 hour)</a></div>` : ''}
        </div>`,
    )
    .join('');
  return baseShell(
    env,
    `<h2 style="margin:0 0 12px;font-size:22px;">Order ${escape(args.orderNumber)} delivered</h2>
     <p>Your products are ready.</p>
     ${itemsHtml}
     <p style="font-size:13px;color:#6b6375;margin-top:16px;">Need a hand? Reply to this email or contact us anytime.</p>`,
  );
}

export function passwordResetEmail(env: AppEnv, link: string) {
  return baseShell(
    env,
    `<h2 style="margin:0 0 12px;font-size:22px;">Reset your password</h2>
     <p>Click the button below to set a new password. The link expires in 1 hour.</p>
     <p style="margin-top:16px;"><a href="${link}" style="background:#5b2dba;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;">Reset password</a></p>
     <p style="font-size:13px;color:#6b6375;">If you didn't request this, ignore this email.</p>`,
  );
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
