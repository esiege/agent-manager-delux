// The API the answer page uses. An email link's token is the only key: no sign-in, no cookies,
// and none of the owner's calls.

import { API_BASE, type ApiError, type Feedback, type FeedbackLinkResponse, type FeedbackMedia, type LinkRespondInput } from '@agent-manager-delux/shared';

export class LinkError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'LinkError';
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { credentials: 'omit', ...init, headers: { Accept: 'application/json', ...init.headers } });
  } catch {
    throw new LinkError("Can't reach Agent Manager Delux. Check your connection.", 0);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const error = typeof body === 'object' && body !== null && typeof (body as ApiError).error === 'string' ? (body as ApiError).error : null;
    throw new LinkError(error ?? `${res.status} ${res.statusText || 'error'}`.trim(), res.status);
  }
  if (body === undefined) throw new LinkError('The server sent a response that isn’t JSON.', res.status);
  return body as T;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const linkApi = {
  load: (t: string) => call<FeedbackLinkResponse>(`/feedback/link?${new URLSearchParams({ t }).toString()}`),
  respond: (input: LinkRespondInput) => call<{ feedback: Feedback }>('/feedback/link/respond', json(input)),
  addAnswerMedia: (t: string, file: File, contentType: string) =>
    call<{ stored: FeedbackMedia }>(`/feedback/link/answer-media?${new URLSearchParams({ t, name: file.name }).toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: file,
    }),
  removeAnswerMedia: (t: string, media: string) => call<{ feedback: Feedback }>('/feedback/link/answer-media/remove', json({ t, media })),
};
