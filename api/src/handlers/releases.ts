// Releases: agents announce what they've shipped (a link, change notes and their comments) with a
// machine key. The Releases tab reads them as the owner, who can add playtest notes to one (each a
// Feedback item for the agent that sent it); agents read them too.
// Sending the same game and version again corrects that release instead of adding another: what's
// left out stays as it was, so an agent can fix just the notes or the date.

import { createHash, randomUUID } from 'node:crypto';
import {
  LIMITS,
  maskSecrets,
  releasedAtOf,
  validateRelease,
  type AgentEvent,
  type Release,
  type ReleaseCreateResponse,
  type ReleaseNotesResponse,
  type ReleaseScreenshot,
  type ReleasesResponse,
} from '@agent-manager-delux/shared';
import { requireKey, requireOwnerOrKey, requireOwnerWrite } from '../auth';
import { HttpError, fail, ok, publicOrigin, query, readJson, type Ctx, type Handler } from '../http';
import type { MediaStore } from '../store/media';
import { fileName, looksLike, parseRange, playtestNote } from './feedback';

const MAX_RELEASES = 500;
const DEFAULT_RELEASES = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One release per game (or agent, without one) and version, whatever their case. */
export function releaseId(project: string | null, agentName: string, version: string): string {
  const owner = (project ?? `agent:${agentName}`).trim().toLowerCase();
  return createHash('sha256').update(`${owner}\n${version.trim().toLowerCase()}`).digest('hex').slice(0, 32);
}

export function releasePage(origin: string, id: string): string {
  return `${origin}/releases?id=${encodeURIComponent(id)}`;
}

const mask = (v: string | null | undefined) => (v ? maskSecrets(v) : null);

const SCREENSHOT_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function releaseMedia(ctx: Ctx): MediaStore {
  if (!ctx.releaseMedia) throw new HttpError(503, "Screenshots aren't set up on this Agent Manager Delux (no BLOB_ACCOUNT); the release was kept without them");
  return ctx.releaseMedia;
}

/** Removes screenshot files, best effort: a file left behind costs little, a failed request more. */
async function dropScreenshots(ctx: Ctx, releaseIdValue: string, shots: readonly ReleaseScreenshot[]) {
  if (!ctx.releaseMedia || shots.length === 0) return;
  await Promise.all(shots.map((s) => ctx.releaseMedia!.delete(`${releaseIdValue}/${s.id}`).catch(() => {})));
}

function idParam(value: string | null | undefined): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) throw new HttpError(400, 'id is required: the release (its id from agentctl release --json or the answer when it was sent)');
  return value;
}

/** POST /api/v1/releases: announce a release, or update one sent before. */
export const createRelease: Handler = async (req, ctx) => {
  const key = await requireKey(req, ctx);
  const result = validateRelease(readJson(req, LIMITS.reportBytes));
  if (!result.ok) return fail(400, result.error);
  const input = result.value;

  const agent = await ctx.store.getAgent(input.agentId);
  if (!agent) throw new HttpError(404, `No agent with id ${input.agentId}: report it first (POST /api/v1/report), then send the release`);

  const project = input.project ?? agent.project ?? null;
  const id = releaseId(project, agent.name, input.version);
  const existing = await ctx.store.getRelease(id);
  const url = input.url ?? existing?.url;
  if (!url) return fail(400, 'url is required: where the release is (its GitHub release, store page or download)');
  const at = ctx.now().toISOString();
  if (input.releasedAt && Date.parse(input.releasedAt) > ctx.now().getTime() + DAY_MS) {
    throw new HttpError(400, `releasedAt ${input.releasedAt} is in the future: give the date it came out`);
  }
  const release: Release = {
    id,
    agentId: agent.id,
    agentName: agent.name,
    kind: agent.kind,
    project,
    machine: agent.machine,
    version: maskSecrets(input.version),
    title: input.title !== undefined ? mask(input.title) : (existing?.title ?? null),
    url,
    links: input.links ? input.links.map((l) => ({ label: maskSecrets(l.label), url: l.url })) : (existing?.links ?? []),
    notes: input.notes !== undefined ? mask(input.notes) : (existing?.notes ?? null),
    comment: input.comment !== undefined ? mask(input.comment) : (existing?.comment ?? null),
    screenshots: input.clearScreenshots ? [] : (existing?.screenshots ?? []),
    // A resend without a date keeps the one sent before.
    releasedAt: input.releasedAt ?? (existing ? releasedAtOf(existing) : at),
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    keyName: key.name,
  };
  const releaseUrl = releasePage(publicOrigin(req, ctx.env), id);
  const body: ReleaseCreateResponse = {
    ok: true,
    test: Boolean(input.test),
    stored: release,
    updated: Boolean(existing),
    releaseUrl,
    warnings: result.warnings,
  };
  if (input.test) return ok(body);

  await ctx.store.putRelease(release);
  if (input.clearScreenshots) await dropScreenshots(ctx, id, existing?.screenshots ?? []);
  const event: AgentEvent = {
    id: randomUUID(),
    agentId: agent.id,
    type: 'release',
    at,
    receivedAt: at,
    state: null,
    activity: `${existing ? 'Updated release' : 'Released'} ${release.version}${release.title ? `: ${release.title}` : ''}`.slice(0, LIMITS.activityLength),
    link: releaseUrl,
    details: null,
  };
  await ctx.store.addEvents([event]);
  return ok(body, existing ? 200 : 201);
};

/** GET /api/v1/releases[?game=<name>][&limit=<n>]: newest release date first. */
export const listReleases: Handler = async (req, ctx) => {
  await requireOwnerOrKey(req, ctx);
  const params = query(req);
  const game = params.get('game')?.trim().toLowerCase();
  const limitParam = params.get('limit');
  const limit = limitParam === null ? DEFAULT_RELEASES : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RELEASES) {
    throw new HttpError(400, `limit must be a whole number from 1 to ${MAX_RELEASES}`);
  }
  // Read them all, then filter and order by release date here: there are few releases, a game's
  // may be old, and an old one announced today belongs further down. Older ones lack a date.
  const found = (await ctx.store.listReleases(MAX_RELEASES)).map((r) => ({ ...r, releasedAt: releasedAtOf(r), screenshots: r.screenshots ?? [] }));
  const matching = (game ? found.filter((r) => (r.project ?? '').toLowerCase() === game) : found).sort(
    (a, b) => b.releasedAt.localeCompare(a.releasedAt) || b.createdAt.localeCompare(a.createdAt),
  );
  const body: ReleasesResponse = {
    now: ctx.now().toISOString(),
    releases: matching.slice(0, limit),
    truncated: matching.length > limit,
  };
  return ok(body);
};

/** POST /api/v1/releases/delete {"id"}: the owner removes a release. */
export const deleteRelease: Handler = async (req, ctx) => {
  requireOwnerWrite(req, ctx);
  const raw = readJson(req, 4096) as { id?: unknown };
  if (typeof raw?.id !== 'string' || !/^[0-9a-f]{32}$/.test(raw.id)) throw new HttpError(400, 'id is required: the release to delete');
  const found = await ctx.store.getRelease(raw.id);
  await ctx.store.deleteRelease(raw.id);
  await dropScreenshots(ctx, raw.id, found?.screenshots ?? []);
  return ok({ ok: true });
};

/** POST /api/v1/releases/notes {"id","notes":["…"]}: the owner's playtest notes on a release. */
export const addReleaseNotes: Handler = async (req, ctx) => {
  const owner = requireOwnerWrite(req, ctx);
  const raw = readJson(req, LIMITS.reportBytes) as { id?: unknown; notes?: unknown };
  const id = idParam(typeof raw?.id === 'string' ? raw.id : null);
  if (!Array.isArray(raw?.notes) || raw.notes.some((n) => typeof n !== 'string')) throw new HttpError(400, 'notes must be a list of text');
  const notes = (raw.notes as string[]).map((n) => n.trim()).filter(Boolean);
  if (notes.length === 0) throw new HttpError(400, 'Write a note first');
  if (notes.length > LIMITS.releaseNotesPerSave) throw new HttpError(400, `Save at most ${LIMITS.releaseNotesPerSave} notes at once`);
  const tooLong = notes.find((n) => n.length > LIMITS.feedbackAnswerLength);
  if (tooLong) throw new HttpError(400, `A note is longer than ${LIMITS.feedbackAnswerLength} characters`);
  const release = await ctx.store.getRelease(id);
  if (!release) throw new HttpError(404, `No release with id ${id}`);
  const url = releasePage(publicOrigin(req, ctx.env), id);
  const feedback = [];
  for (const note of notes) feedback.push(await playtestNote(ctx, release, owner.login, note, url));
  const body: ReleaseNotesResponse = { feedback };
  return ok(body, 201);
};

/**
 * POST /api/v1/releases/screenshot?id=<release>&name=<file name>: adds a screenshot to a release.
 * The body is the picture itself (PNG, JPEG, WebP or GIF), with its Content-Type.
 */
export const addReleaseScreenshot: Handler = async (req, ctx) => {
  await requireKey(req, ctx);
  const params = query(req);
  const id = idParam(params.get('id'));
  const found = await ctx.store.getRelease(id);
  if (!found) throw new HttpError(404, `No release with id ${id}`);
  if ((found.screenshots ?? []).length >= LIMITS.releaseScreenshots) {
    throw new HttpError(409, `A release holds at most ${LIMITS.releaseScreenshots} screenshots; send it again with clearScreenshots to replace them`);
  }
  const contentType = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!SCREENSHOT_TYPES.includes(contentType)) throw new HttpError(415, `Content-Type must be one of ${SCREENSHOT_TYPES.join(', ')}`);
  const type = contentType as ReleaseScreenshot['contentType'];
  const bytes = req.raw ?? Buffer.from(req.body, 'utf8');
  if (bytes.length === 0) throw new HttpError(400, 'The body is empty; send the picture itself');
  if (bytes.length > LIMITS.feedbackImageBytes) {
    throw new HttpError(413, `The picture is ${bytes.length} bytes; the limit is ${LIMITS.feedbackImageBytes / 1024 / 1024} MB. Shrink it.`);
  }
  if (!looksLike(type, bytes)) throw new HttpError(415, `The file doesn't look like ${type}`);
  const shot: ReleaseScreenshot = { id: randomUUID(), contentType: type, bytes: bytes.length, name: fileName(params.get('name')), at: ctx.now().toISOString() };
  await releaseMedia(ctx).put(`${id}/${shot.id}`, bytes, type);
  // Read again: two pictures sent at once must both be kept.
  const latest = (await ctx.store.getRelease(id)) ?? found;
  await ctx.store.putRelease({ ...latest, screenshots: [...(latest.screenshots ?? []), shot] });
  return ok({ ok: true, test: false, stored: shot, warnings: [] }, 201);
};

/** GET /api/v1/releases/screenshot?id=<release>&shot=<id>: one screenshot, for the owner or a key. */
export const releaseScreenshot: Handler = async (req, ctx) => {
  await requireOwnerOrKey(req, ctx);
  const params = query(req);
  const id = idParam(params.get('id'));
  const found = await ctx.store.getRelease(id);
  const shot = found?.screenshots?.find((s) => s.id === params.get('shot'));
  if (!shot) throw new HttpError(404, 'No such screenshot');
  const range = parseRange(req.headers.get('range'), shot.bytes);
  const file = await releaseMedia(ctx).get(`${id}/${shot.id}`, range ?? undefined);
  if (!file) throw new HttpError(404, 'The screenshot is gone');
  const headers: Record<string, string> = {
    'content-type': shot.contentType,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=86400, immutable',
    // Agents send these files: never let one run as a page.
    'content-security-policy': "default-src 'none'; sandbox",
    'content-disposition': 'inline',
  };
  if (range) headers['content-range'] = `bytes ${range.start}-${range.start + file.bytes.length - 1}/${file.size}`;
  return { status: range ? 206 : 200, body: null, bytes: file.bytes, headers };
};
