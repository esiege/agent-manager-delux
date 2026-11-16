// Typed client for the Agent Manager Delux read API (same origin, signed in as the owner).

import {
  type AgentctlStatusResponse,
  type CrashDetailResponse,
  type CrashesResponse,
  type MachineNamesResponse,
  type AgentctlUpdateResponse,
  API_BASE,
  OWNER_WRITE_HEADER,
  type SendMessageInput,
  type SendMessageResponse,
  type AgentDetailResponse,
  type AgentsResponse,
  type AlertsResponse,
  type AlertSubscription,
  type AlertSubscriptionInput,
  type ApiError,
  type Feedback,
  type FeedbackListResponse,
  type FeedbackMedia,
  type RespondFeedbackInput,
  type CreateKeyResponse,
  type HideAgentsResponse,
  type KeysResponse,
  type MachineKey,
  type KeyScope,
  type MeResponse,
  type PerfSessionDetailResponse,
  type PerfSessionsResponse,
  type ReleasesResponse,
  type ReportingResponse,
} from '@agent-manager-delux/shared';

/** A failed request. `status` is 0 when the server couldn't be reached. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export function toRequestError(e: unknown): ApiRequestError {
  if (e instanceof ApiRequestError) return e;
  return new ApiRequestError(e instanceof Error ? e.message : String(e), 0);
}

// The sign-in gate listens for 401 and 403 so an expired session shows the sign-in card.
type AuthListener = (status: 401 | 403) => void;
const authListeners = new Set<AuthListener>();

export function onAuthProblem(listener: AuthListener): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

function isApiError(body: unknown): body is ApiError {
  return typeof body === 'object' && body !== null && typeof (body as ApiError).error === 'string';
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
}

interface RawFile {
  bytes: Blob;
  contentType: string;
}

async function request<T>(path: string, { method = 'GET', body, signal }: RequestOptions = {}, file?: RawFile): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method: file ? 'POST' : method,
      signal,
      credentials: 'same-origin',
      // A redirect here means the sign-in expired and the site is sending us to the login page.
      redirect: 'manual',
      // Every change carries OWNER_WRITE_HEADER, which the API requires so other sites can't post here.
      headers: file
        ? { Accept: 'application/json', 'Content-Type': file.contentType, [OWNER_WRITE_HEADER]: '1' }
        : method === 'GET'
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json', [OWNER_WRITE_HEADER]: '1' },
      body: file ? file.bytes : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiRequestError("Can't reach Agent Manager Delux. Check your connection.", 0);
  }

  if (res.type === 'opaqueredirect') {
    authListeners.forEach((l) => l(401));
    throw new ApiRequestError('Your sign-in has expired.', 401);
  }

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!res.ok) {
    const message = isApiError(parsed) ? parsed.error : `${res.status} ${res.statusText || 'error'}`.trim();
    if (res.status === 401 || res.status === 403) {
      const status = res.status;
      authListeners.forEach((l) => l(status));
    }
    throw new ApiRequestError(message, res.status);
  }
  if (parsed === undefined) throw new ApiRequestError('The server sent a response that isn’t JSON.', res.status);
  return parsed as T;
}

export const api = {
  me: (signal?: AbortSignal) => request<MeResponse>('/me', { signal }),
  agents: (days: number, signal?: AbortSignal) => request<AgentsResponse>(`/agents?days=${days}`, { signal }),
  agent: (id: string, signal?: AbortSignal) =>
    request<AgentDetailResponse>(`/agent?${new URLSearchParams({ id }).toString()}`, { signal }),
  reporting: (days: number, signal?: AbortSignal) => request<ReportingResponse>(`/reporting?days=${days}`, { signal }),
  perfSessions: (days: number, signal?: AbortSignal, tests = false) =>
    request<PerfSessionsResponse>(`/perf/sessions?days=${days}${tests ? '&tests=1' : ''}`, { signal }),
  crashes: (days: number, signal?: AbortSignal, tests = false) => request<CrashesResponse>(`/perf/crashes?days=${days}${tests ? '&tests=1' : ''}`, { signal }),
  crash: (id: string, signal?: AbortSignal) => request<CrashDetailResponse>(`/perf/crash?${new URLSearchParams({ id }).toString()}`, { signal }),
  /** Names a machine ("gaming rig"); an empty name clears it. */
  setMachineName: (machine: string, name: string) => request<MachineNamesResponse>('/machine-names', { method: 'POST', body: { machine, name } }),
  perfSession: (id: string, signal?: AbortSignal) =>
    request<PerfSessionDetailResponse>(`/perf/session?${new URLSearchParams({ id }).toString()}`, { signal }),
  keys: (signal?: AbortSignal) => request<KeysResponse>('/keys', { signal }),
  createKey: (name: string, scope: KeyScope = 'all') => request<CreateKeyResponse>('/keys', { method: 'POST', body: { name, scope } }),
  revokeKey: (id: string) => request<{ key: MachineKey }>('/keys/revoke', { method: 'POST', body: { id } }),
  alerts: (signal?: AbortSignal) => request<AlertsResponse>('/alerts', { signal }),
  saveAlert: (input: AlertSubscriptionInput) =>
    request<{ subscription: AlertSubscription }>('/alerts', { method: 'POST', body: input }),
  deleteAlert: (id: string) => request<{ ok: true }>('/alerts/delete', { method: 'POST', body: { id } }),
  testAlert: (id: string) => request<{ subscription: AlertSubscription }>('/alerts/test', { method: 'POST', body: { id } }),
  hideAgents: (agentIds: string[], hidden: boolean) =>
    request<HideAgentsResponse>('/agents/hide', { method: 'POST', body: { agentIds, hidden } }),
  agentctl: (signal?: AbortSignal) => request<AgentctlStatusResponse>('/agentctl', { signal }),
  /** "Auto-update all PCs": each PC with self-updates on moves to the agentctl deployed now. */
  updateAllPcs: () => request<AgentctlUpdateResponse>('/agentctl/update', { method: 'POST', body: {} }),
  sendMessage: (input: SendMessageInput) => request<SendMessageResponse>('/messages', { method: 'POST', body: input }),
  feedback: (signal?: AbortSignal) => request<FeedbackListResponse>('/feedback', { signal }),
  releases: (signal?: AbortSignal) => request<ReleasesResponse>('/releases?limit=500', { signal }),
  deleteRelease: (id: string) => request<{ ok: true }>('/releases/delete', { method: 'POST', body: { id } }),
  respondFeedback: (input: RespondFeedbackInput) =>
    request<{ feedback: Feedback }>('/feedback/respond', { method: 'POST', body: input }),
  /** Attaches a file to your answer, while the request is open. */
  addAnswerMedia: (feedbackId: string, file: File, contentType: string) =>
    request<{ stored: FeedbackMedia }>(
      `/feedback/answer-media?${new URLSearchParams({ id: feedbackId, name: file.name }).toString()}`,
      {},
      { bytes: file, contentType },
    ),
  removeAnswerMedia: (feedbackId: string, mediaId: string) =>
    request<{ feedback: Feedback }>('/feedback/answer-media/remove', { method: 'POST', body: { id: feedbackId, media: mediaId } }),
};

/** A request's picture, clip or sound, for <img>, <video> or <audio> (same origin, so the sign-in cookie goes along). */
export function feedbackMediaUrl(feedbackId: string, mediaId: string): string {
  return `${API_BASE}/feedback/media?${new URLSearchParams({ id: feedbackId, media: mediaId }).toString()}`;
}

/** Who is signed in, from the site's built-in auth. Used to name a non-owner account. */
export async function fetchSignedInName(): Promise<string | null> {
  try {
    const res = await fetch('/.auth/me', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = (await res.json()) as { clientPrincipal?: { userDetails?: unknown } | null };
    const name = body.clientPrincipal?.userDetails;
    return typeof name === 'string' && name ? name : null;
  } catch {
    return null;
  }
}

export function loginUrl(returnTo: string): string {
  return `/.auth/login/github?post_login_redirect_uri=${encodeURIComponent(returnTo)}`;
}

export const LOGOUT_URL = '/.auth/logout';
