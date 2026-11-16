// Sending email. In Azure, through Azure Communication Services (its REST API, signed with the
// resource's access key, so the bundle needs no SDK). Off Azure, emails are written to a folder as
// .html files, so they can be opened and their links clicked while testing.

import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inAzure } from './store/index';

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  send(email: Email): Promise<void>;
}

const SEND_TIMEOUT_MS = 10_000;
const API_VERSION = '2023-03-31';

/** Azure Communication Services Email: POST /emails:send, signed with HMAC-SHA256. */
export class AcsMailer implements Mailer {
  constructor(
    private readonly endpoint: string,
    private readonly key: string,
    private readonly sender: string,
  ) {}

  async send(email: Email): Promise<void> {
    const url = new URL(`/emails:send?api-version=${API_VERSION}`, this.endpoint);
    const body = JSON.stringify({
      senderAddress: this.sender,
      recipients: { to: [{ address: email.to }] },
      content: { subject: email.subject, html: email.html, plainText: email.text },
      userEngagementTrackingDisabled: true,
    });
    const date = new Date().toUTCString();
    const hash = createHash('sha256').update(body, 'utf8').digest('base64');
    const toSign = `POST\n${url.pathname}${url.search}\n${date};${url.host};${hash}`;
    const signature = createHmac('sha256', Buffer.from(this.key, 'base64')).update(toSign, 'utf8').digest('base64');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ms-date': date,
        'x-ms-content-sha256': hash,
        authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (res.status !== 202 && !res.ok) {
      const detail = await res.text().catch(() => '');
      let why = detail;
      try {
        why = (JSON.parse(detail) as { error?: { message?: string } }).error?.message ?? detail;
      } catch {
        // Not JSON: keep the text.
      }
      throw new Error(`The email service answered ${res.status}${why ? `: ${why.slice(0, 200)}` : ''}`);
    }
  }
}

/** Off Azure: each email is a file in a folder. */
export class FolderMailer implements Mailer {
  constructor(private readonly dir: string) {}

  async send(email: Email): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${email.to.replace(/[^a-z0-9@.-]/gi, '_')}.html`;
    const head = `<!-- To: ${email.to} -->\n<!-- Subject: ${email.subject.replace(/--/g, '-')} -->\n`;
    writeFileSync(join(this.dir, name), head + email.html);
  }
}

let mailer: Mailer | null | undefined;

/** The mailer for this environment, or null in Azure when email isn't set up. */
export function getMailer(env: Record<string, string | undefined>): Mailer | null {
  if (mailer !== undefined) return mailer;
  if (env.EMAIL_ENDPOINT && env.EMAIL_KEY && env.EMAIL_SENDER) {
    mailer = new AcsMailer(env.EMAIL_ENDPOINT, env.EMAIL_KEY, env.EMAIL_SENDER);
  } else if (inAzure(env)) {
    mailer = null;
  } else {
    mailer = new FolderMailer(env.LOCAL_MAIL_PATH || '.local-mail');
  }
  return mailer;
}

/** For tests. */
export function setMailer(m: Mailer | null | undefined) {
  mailer = m;
}

/** Escapes text for HTML. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
