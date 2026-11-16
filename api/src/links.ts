// Signed links in feedback emails. A token names one request and the subscription the email went
// to, and expires; it's the only key the answer page needs, so the owner can answer from the email
// without signing in. Signed with LINK_SECRET, or a secret derived from the email service's key.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { FEEDBACK_LINK_DAYS } from '@agent-manager-delux/shared';
import { HttpError } from './http';
import { inAzure } from './store/index';

export interface LinkClaims {
  /** The feedback request. */
  f: string;
  /** The alert subscription the email went to. */
  s: string;
  /** Expiry, in seconds since 1970. */
  x: number;
}

function secret(env: Record<string, string | undefined>): Buffer | null {
  if (env.LINK_SECRET) return Buffer.from(env.LINK_SECRET, 'utf8');
  if (env.EMAIL_KEY) return createHmac('sha256', env.EMAIL_KEY).update('agent-manager-feedback-links').digest();
  // Off Azure, a fixed secret is fine: nothing outside this PC sees the links.
  return inAzure(env) ? null : Buffer.from('local-feedback-links', 'utf8');
}

const b64 = (b: Buffer) => b.toString('base64url');

/** Whether links can be made here at all. */
export function canSignLinks(env: Record<string, string | undefined>): boolean {
  return secret(env) !== null;
}

export function signLink(env: Record<string, string | undefined>, feedbackId: string, subscriptionId: string, now: Date): string {
  const key = secret(env);
  if (!key) throw new Error('No LINK_SECRET or EMAIL_KEY to sign email links with');
  const claims: LinkClaims = { f: feedbackId, s: subscriptionId, x: Math.floor(now.getTime() / 1000) + FEEDBACK_LINK_DAYS * 86_400 };
  const payload = b64(Buffer.from(JSON.stringify(claims), 'utf8'));
  return `${payload}.${b64(createHmac('sha256', key).update(payload).digest())}`;
}

/** The token's claims, or a 401 saying why it can't be used. */
export function readLink(env: Record<string, string | undefined>, token: string | null | undefined, now: Date): LinkClaims {
  const key = secret(env);
  const [payload, sig] = (token ?? '').split('.');
  if (!key || !payload || !sig) throw new HttpError(401, "This link isn't valid. Open the request on the Feedback tab instead.");
  const want = createHmac('sha256', key).update(payload).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    throw new HttpError(401, "This link isn't valid. Open the request on the Feedback tab instead.");
  }
  let claims: LinkClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LinkClaims;
  } catch {
    throw new HttpError(401, "This link isn't valid. Open the request on the Feedback tab instead.");
  }
  if (typeof claims.f !== 'string' || typeof claims.s !== 'string' || typeof claims.x !== 'number') {
    throw new HttpError(401, "This link isn't valid. Open the request on the Feedback tab instead.");
  }
  if (claims.x * 1000 < now.getTime()) {
    throw new HttpError(401, `This link has expired (links last ${FEEDBACK_LINK_DAYS} days). Open the request on the Feedback tab instead.`);
  }
  return claims;
}
