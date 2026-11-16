// agentctl perf and agentctl crashes: reading what games sent, with a machine key.

import {
  perfSessionStatus,
  perfStats,
  type CrashDetailResponse,
  type CrashesResponse,
  type PerfSessionDetailResponse,
  type PerfSessionsResponse,
  type PerfSessionStatus,
} from '@agent-manager-delux/shared';
import { loadConfig } from './config';
import { get } from './send';

export class PerfUsageError extends Error {}

const STATUSES: PerfSessionStatus[] = ['running', 'ended', 'crashed', 'lost'];

function table(rows: string[][]) {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  for (const r of rows) console.log(r.map((cell, i) => cell.padEnd(widths[i]!)).join('  ').trimEnd());
}

/** "gaming rig (pc-0dc004594da2)" when it has a nickname. */
function machine(name: string, names: Record<string, string> | undefined): string {
  const nick = names?.[name];
  return nick ? `${nick} (${name})` : name;
}

/** --machine matches the machine's name or its nickname. */
function machineMatches(name: string, names: Record<string, string> | undefined, wanted: string | undefined): boolean {
  if (!wanted) return true;
  const w = wanted.toLowerCase();
  return name.toLowerCase() === w || names?.[name]?.toLowerCase() === w;
}

export async function perfCommand(positional: string[], flags: Record<string, string>) {
  const config = loadConfig();
  if (positional[0]) {
    const detail = await get<PerfSessionDetailResponse>(config, `/perf/session?${new URLSearchParams({ id: positional[0] })}`);
    console.log(JSON.stringify(detail, null, 2));
    return;
  }
  const status = flags.status as PerfSessionStatus | undefined;
  if (status && !STATUSES.includes(status)) throw new PerfUsageError(`--status must be one of ${STATUSES.join(', ')}`);
  const narrowed = Boolean(flags.machine || flags.scene || status);
  // Filters on this side need the whole window; --limit applies after them.
  const params = new URLSearchParams({ days: flags.days ?? '30', limit: narrowed ? '2000' : (flags.limit ?? '50') });
  if (flags.game) params.set('game', flags.game);
  if ('tests' in flags) params.set('tests', '1');
  const list = await get<PerfSessionsResponse>(config, `/perf/sessions?${params}`);
  const now = Date.parse(list.now);
  const sessions = list.sessions
    .filter((s) => machineMatches(s.machine, list.machineNames, flags.machine))
    .filter((s) => !flags.scene || (s.scenes ?? []).some((sc) => sc.toLowerCase() === flags.scene!.toLowerCase()))
    .filter((s) => !status || perfSessionStatus(s, now) === status)
    .slice(0, Number(flags.limit ?? 50));
  if (flags.json) {
    console.log(JSON.stringify({ ...list, sessions }, null, 2));
    return;
  }
  if (sessions.length === 0) {
    console.log(`No performance sessions in the last ${list.days} days match${'tests' in flags ? '' : ' (test runs are hidden; --tests shows them)'}.`);
    return;
  }
  const num = (v: number | null, unit: string, digits = 0) => (v === null ? '-' : `${v.toFixed(digits)}${unit}`);
  table(
    sessions.map((s) => {
      const stats = perfStats(s.totals);
      return [
        s.id,
        `${s.startedAt.slice(0, 16)}Z`,
        s.game,
        s.build ?? '-',
        machine(s.machine, list.machineNames),
        s.gpu ?? '-',
        s.resolution ?? '-',
        num(stats.seconds, 's'),
        num(stats.avgFps, ' fps'),
        `p99 ${num(stats.frameMsP99, ' ms', 1)}`,
        `worst ${num(stats.frameMsMax, ' ms', 1)}`,
        `${stats.hitches} hitches`,
        stats.bound ? `${stats.bound}-bound` : '-',
        `${stats.errors + stats.ensures} errors`,
        `${perfSessionStatus(s, now)}${s.kind === 'test' ? ' (test)' : ''}`,
      ];
    }),
  );
  if (list.truncated) console.log(`(more sessions exist; raise --limit or narrow with --game)`);
}

export async function crashesCommand(positional: string[], flags: Record<string, string>) {
  const config = loadConfig();
  if (positional[0]) {
    const d = await get<CrashDetailResponse>(config, `/perf/crash?${new URLSearchParams({ id: positional[0] })}`);
    if (flags.json) {
      console.log(JSON.stringify(d, null, 2));
      return;
    }
    const c = d.crash;
    const lines = [
      `${c.game}${c.build ? ` ${c.build}` : ''} crashed on ${machine(c.machine, d.machineNames)}${c.scene ? `, in ${c.scene}` : ''}`,
      `When:      ${c.at}${c.t !== null ? ` (${Math.round(c.t)} s into the run)` : ''}`,
      `Reason:    ${c.reason}`,
      `From:      ${c.source}${c.kind === 'test' ? ', test run' : ''}${c.sessionId ? `; session ${c.sessionId}` : ''}`,
      `Doing:     ${d.answer ? `${d.answer.text} (${d.answer.by})` : c.feedbackId ? 'not answered yet' : 'not asked'}`,
      '',
      'Breadcrumbs (oldest first):',
      ...(c.breadcrumbs.length ? c.breadcrumbs.map((b) => `  - ${b}`) : ['  (none)']),
      '',
      'Callstack:',
      c.callstack ?? '  (none)',
      '',
      'End of the log:',
      c.log ?? '  (none)',
    ];
    console.log(lines.join('\n'));
    return;
  }
  const params = new URLSearchParams({ days: flags.days ?? '30' });
  if (flags.game) params.set('game', flags.game);
  if (flags.machine) params.set('machine', flags.machine);
  if ('tests' in flags) params.set('tests', '1');
  const list = await get<CrashesResponse>(config, `/perf/crashes?${params}`);
  const crashes = list.crashes.slice(0, Number(flags.limit ?? 50));
  if (flags.json) {
    console.log(JSON.stringify({ ...list, crashes }, null, 2));
    return;
  }
  if (crashes.length === 0) {
    console.log(`No crashes in the last ${list.days} days${'tests' in flags ? '' : ' (test runs are hidden; --tests shows them)'}.`);
    return;
  }
  table(
    crashes.map((c) => [
      c.id,
      `${c.at.slice(0, 16)}Z`,
      `${c.game}${c.build ? ` ${c.build}` : ''}`,
      machine(c.machine, list.machineNames),
      c.scene ?? '-',
      c.reason.length > 80 ? `${c.reason.slice(0, 79)}…` : c.reason,
    ]),
  );
  console.log(`(agentctl crashes <id> shows one: breadcrumbs, callstack, log and what the person was doing)`);
}
