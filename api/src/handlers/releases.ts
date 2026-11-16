// Releases: agents announce what they've shipped (a link, change notes and their comments) with a
// machine key. The Releases tab reads them as the owner, who can delete one; agents read them too.
// Sending the same game and version again updates that release instead of adding another.

import { createHash, randomUUID } from 'node:crypto';
import {
  LIMITS,
  maskSecrets,
  validateRelease,
  type AgentEvent,
  type Release,
  type ReleaseCreateResponse,
  type ReleasesResponse,
} from '@agent-manager-delux/shared';
import { requireKey, requireOwnerOrKey, requireOwnerWrite } from '../auth';
import { HttpError, fail, ok, publicOrigin, query, readJson, type Handler } from '../http';

const MAX_RELEASES = 500;
const DEFAULT_RELEASES = 200;

/** One release per game (or agent, without one) and version, whatever their case. */
export function releaseId(project: string | null, agentName: string, version: string): string {
  const owner = (project ?? `agent:${agentName}`).trim().toLowerCase();
  return createHash('sha256').update(`${owner}\n${version.trim().toLowerCase()}`).digest('hex').slice(0, 32);
}

export function releasePage(origin: string, id: string): string {
  return `${origin}/releases?id=${encodeURIComponent(id)}`;
}

const mask = (v: string | null | undefined) => (v ? maskSecrets(v) : null);

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
  const at = ctx.now().toISOString();
  const release: Release = {
    id,
    agentId: agent.id,
    agentName: agent.name,
    kind: agent.kind,
    project,
    machine: agent.machine,
    version: maskSecrets(input.version),
    title: mask(input.title),
    url: input.url,
    links: (input.links ?? []).map((l) => ({ label: maskSecrets(l.label), url: l.url })),
    notes: mask(input.notes),
    comment: mask(input.comment),
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

/** GET /api/v1/releases[?game=<name>][&limit=<n>]: newest first. */
export const listReleases: Handler = async (req, ctx) => {
  await requireOwnerOrKey(req, ctx);
  const params = query(req);
  const game = params.get('game')?.trim().toLowerCase();
  const limitParam = params.get('limit');
  const limit = limitParam === null ? DEFAULT_RELEASES : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RELEASES) {
    throw new HttpError(400, `limit must be a whole number from 1 to ${MAX_RELEASES}`);
  }
  // With a game, read them all and filter: there are few releases, and a game's may be old.
  const found = await ctx.store.listReleases(game ? MAX_RELEASES : limit + 1);
  const matching = game ? found.filter((r) => (r.project ?? '').toLowerCase() === game) : found;
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
  await ctx.store.deleteRelease(raw.id);
  return ok({ ok: true });
};
