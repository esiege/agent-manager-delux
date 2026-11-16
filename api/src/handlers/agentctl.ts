// Updating agentctl on every PC from the site. The API is built with the hash of the agentctl.js
// deployed next to it (api/build.mjs). Heartbeats say which agentctl each PC runs; when the owner
// presses "Auto-update all PCs", a heartbeat from a PC running anything else is answered with the
// update, and agentctl downloads it, checks the hash and installs it (reporter/src/selfupdate.ts).

import type {
  AgentctlStatusResponse,
  AgentctlUpdateRequest,
  AgentctlUpdateResponse,
  HeartbeatInput,
  HeartbeatResponse,
} from '@agent-manager-delux/shared';
import { requireOwner, requireOwnerWrite } from '../auth';
import { HttpError, ok, publicOrigin, type Ctx, type Handler, type Req } from '../http';

declare const __AGENTCTL_SHA256__: string | undefined;

/** SHA-256 of the deployed agentctl.js. AGENTCTL_SHA256 overrides it (tests, local runs). */
export function latestAgentctl(ctx: Ctx): string | null {
  const baked = typeof __AGENTCTL_SHA256__ === 'string' ? __AGENTCTL_SHA256__ : '';
  return ctx.env.AGENTCTL_SHA256 || baked || null;
}

/** GET /api/v1/agentctl: the deployed agentctl, the latest request, and every PC heard from. */
export const agentctlStatus: Handler = async (req, ctx) => {
  requireOwner(req, ctx);
  const latest = latestAgentctl(ctx);
  const machines = (await ctx.store.listMachines())
    .map((m) => ({ ...m, upToDate: latest !== null && m.agentctl.sha256 === latest }))
    .sort((a, b) => b.beatAt.localeCompare(a.beatAt));
  const body: AgentctlStatusResponse = {
    now: ctx.now().toISOString(),
    latest,
    request: await ctx.store.getUpdateRequest(),
    machines,
  };
  return ok(body);
};

/** POST /api/v1/agentctl/update: every PC with self-updates on moves to the deployed agentctl. */
export const requestAgentctlUpdate: Handler = async (req, ctx) => {
  const owner = requireOwnerWrite(req, ctx);
  const latest = latestAgentctl(ctx);
  if (!latest) throw new HttpError(409, 'This build of Agent Manager Delux has no agentctl to offer: deploy it with scripts/deploy.ps1');
  const request: AgentctlUpdateRequest = { requestedAt: ctx.now().toISOString(), sha256: latest, by: owner.login };
  await ctx.store.putUpdateRequest(request);
  const body: AgentctlUpdateResponse = { ok: true, request };
  return ok(body);
};

/**
 * Called by the heartbeat: records the PC's agentctl, and says whether it should update. It
 * should when the owner asked for the agentctl deployed now, the PC runs a different one, and it
 * hasn't already tried this request.
 */
export async function agentctlForHeartbeat(req: Req, ctx: Ctx, input: HeartbeatInput): Promise<HeartbeatResponse['update']> {
  const state = input.agentctl;
  if (!state || input.test) return undefined;
  await ctx.store.putMachine({ machine: input.machine, kind: input.kind, beatAt: ctx.now().toISOString(), agentctl: state });

  const latest = latestAgentctl(ctx);
  const request = await ctx.store.getUpdateRequest();
  if (!latest || !request || request.sha256 !== latest) return undefined;
  if (!state.autoUpdate || state.sha256 === latest) return undefined;
  if (state.update?.requestedAt === request.requestedAt && state.update.sha256 === latest) return undefined;
  return { requestedAt: request.requestedAt, sha256: latest, url: `${publicOrigin(req, ctx.env)}/agentctl.js` };
}
