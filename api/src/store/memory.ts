// In-memory store for local development and tests. With a file path it survives restarts.
// Never used in Azure: see store/index.ts.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  FEEDBACK_DONE_STATUSES,
  feedbackFromStored,
  type Agent,
  type AgentEvent,
  type AgentKind,
  type AgentMessage,
  type AgentctlUpdateRequest,
  type AlertSubscription,
  type Feedback,
  type MachineRecord,
  type PerfSample,
  type PerfSession,
  type Release,
} from '@agent-manager-delux/shared';
import {
  FEEDBACK_RETENTION_SECONDS,
  isReportingEvent,
  MESSAGE_RETENTION_SECONDS,
  PERF_SAMPLE_RETENTION_SECONDS,
  PERF_SESSION_RETENTION_SECONDS,
  REPORTING_RETENTION_DAYS,
  RETENTION_DAYS,
  type MessageFilter,
  type Store,
  type StoredKey,
} from './types';

export interface Snapshot {
  keys: StoredKey[];
  agents: Agent[];
  events: AgentEvent[];
  /** Missing in files saved before alerts existed. */
  alerts?: AlertSubscription[];
  /** Missing in files saved before messages existed. */
  messages?: AgentMessage[];
  /** Missing in files saved before performance data existed. */
  perfSessions?: PerfSession[];
  perfSamples?: PerfSample[];
  /**
   * Feedback requests. Named for blockers, which they replaced: files saved before hold those,
   * and they're read with feedbackFromStored. Missing in files saved before blockers existed.
   */
  blockers?: Feedback[];
  /** Missing in files saved before self-updates existed. */
  machines?: MachineRecord[];
  updateRequest?: AgentctlUpdateRequest | null;
  /** Missing in files saved before releases existed. */
  releases?: Release[];
}

export class MemoryStore implements Store {
  private keys = new Map<string, StoredKey>();
  private agents = new Map<string, Agent>();
  private events: AgentEvent[] = [];
  private alerts = new Map<string, AlertSubscription>();
  private messages: AgentMessage[] = [];
  private perfSessions = new Map<string, PerfSession>();
  private perfSamples = new Map<string, PerfSample>();
  private feedback = new Map<string, Feedback>();
  private machines = new Map<string, MachineRecord>();
  private updateRequest: AgentctlUpdateRequest | null = null;
  private releases = new Map<string, Release>();

  constructor(
    private readonly file?: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (file && existsSync(file)) {
      const snap = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
      for (const k of snap.keys) this.keys.set(k.id, k);
      for (const a of snap.agents) this.agents.set(a.id, a);
      for (const s of snap.alerts ?? []) this.alerts.set(s.id, s);
      this.events = snap.events;
      this.messages = snap.messages ?? [];
      for (const p of snap.perfSessions ?? []) this.perfSessions.set(p.id, p);
      for (const p of snap.perfSamples ?? []) this.perfSamples.set(p.id, p);
      for (const b of snap.blockers ?? []) this.feedback.set(b.id, feedbackFromStored(b));
      for (const m of snap.machines ?? []) this.machines.set(machineKey(m), m);
      this.updateRequest = snap.updateRequest ?? null;
      for (const r of snap.releases ?? []) this.releases.set(r.id, r);
      this.prune();
    }
  }

  private prune() {
    const cutoff = new Date(this.now().getTime() - RETENTION_DAYS * 86_400_000).toISOString();
    const reportingCutoff = new Date(this.now().getTime() - REPORTING_RETENTION_DAYS * 86_400_000).toISOString();
    this.events = this.events.filter((e) => e.receivedAt >= (isReportingEvent(e) ? reportingCutoff : cutoff));
    const messageCutoff = new Date(this.now().getTime() - MESSAGE_RETENTION_SECONDS * 1000).toISOString();
    this.messages = this.messages.filter((m) => m.createdAt >= messageCutoff);
    const ago = (seconds: number) => new Date(this.now().getTime() - seconds * 1000).toISOString();
    for (const [id, p] of this.perfSessions) if (p.lastSeen < ago(PERF_SESSION_RETENTION_SECONDS)) this.perfSessions.delete(id);
    for (const [id, p] of this.perfSamples) if (p.receivedAt < ago(PERF_SAMPLE_RETENTION_SECONDS)) this.perfSamples.delete(id);
    for (const [id, f] of this.feedback) if (f.updatedAt < ago(FEEDBACK_RETENTION_SECONDS)) this.feedback.delete(id);
  }

  private save() {
    if (!this.file) return;
    const snap: Snapshot = {
      keys: [...this.keys.values()],
      agents: [...this.agents.values()],
      events: this.events,
      alerts: [...this.alerts.values()],
      messages: this.messages,
      perfSessions: [...this.perfSessions.values()],
      perfSamples: [...this.perfSamples.values()],
      blockers: [...this.feedback.values()],
      machines: [...this.machines.values()],
      updateRequest: this.updateRequest,
      releases: [...this.releases.values()],
    };
    writeFileSync(this.file, JSON.stringify(snap));
  }

  async getKey(id: string) {
    return structuredClone(this.keys.get(id) ?? null);
  }
  async listKeys() {
    return structuredClone([...this.keys.values()]);
  }
  async putKey(key: StoredKey) {
    this.keys.set(key.id, structuredClone(key));
    this.save();
  }

  async getAgent(id: string) {
    return structuredClone(this.agents.get(id) ?? null);
  }
  async putAgent(agent: Agent) {
    this.agents.set(agent.id, structuredClone(agent));
    this.save();
  }
  async listAgentsSeenSince(since: string) {
    return structuredClone([...this.agents.values()].filter((a) => a.lastSeen >= since));
  }
  async listAgentsOn(machine: string, kind: AgentKind) {
    return structuredClone([...this.agents.values()].filter((a) => a.machine === machine && a.kind === kind));
  }
  async listChildren(parentId: string) {
    return structuredClone([...this.agents.values()].filter((a) => a.parentId === parentId));
  }

  async addEvents(events: AgentEvent[]) {
    this.events.push(...structuredClone(events));
    this.prune();
    this.save();
  }
  async listEvents(agentId: string, limit: number) {
    return structuredClone(
      this.events
        .filter((e) => e.agentId === agentId)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit),
    );
  }

  async listReportingEvents(since: string) {
    return structuredClone(this.events.filter((e) => e.at >= since && isReportingEvent(e)));
  }

  async getAlert(id: string) {
    return structuredClone(this.alerts.get(id) ?? null);
  }
  async listAlerts() {
    return structuredClone([...this.alerts.values()]);
  }
  async putAlert(subscription: AlertSubscription) {
    this.alerts.set(subscription.id, structuredClone(subscription));
    this.save();
  }
  async deleteAlert(id: string) {
    this.alerts.delete(id);
    this.save();
  }

  async getMessage(machine: string, id: string) {
    return structuredClone(this.messages.find((m) => m.machine === machine && m.id === id) ?? null);
  }
  async putMessage(message: AgentMessage) {
    this.messages = [...this.messages.filter((m) => m.id !== message.id), structuredClone(message)];
    this.prune();
    this.save();
  }
  async listMessages(machine: string, f: MessageFilter) {
    return structuredClone(
      this.messages
        .filter((m) => m.machine === machine && (!f.agentId || m.agentId === f.agentId) && (!f.status || m.status === f.status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, f.limit),
    );
  }

  async getFeedback(id: string) {
    const f = this.feedback.get(id);
    return f ? feedbackFromStored(structuredClone(f)) : null;
  }
  async putFeedback(feedback: Feedback) {
    this.feedback.set(feedback.id, structuredClone(feedback));
    this.prune();
    this.save();
  }
  async listFeedback(since: string) {
    return structuredClone(
      [...this.feedback.values()]
        .map(feedbackFromStored)
        .filter((f) => !FEEDBACK_DONE_STATUSES.includes(f.status) || f.updatedAt >= since)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }
  async listFeedbackFor(keyName: string) {
    return structuredClone(
      [...this.feedback.values()]
        .map(feedbackFromStored)
        .filter((f) => f.keyName === keyName && !FEEDBACK_DONE_STATUSES.includes(f.status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  async getPerfSession(id: string) {
    return structuredClone(this.perfSessions.get(id) ?? null);
  }
  async putPerfSession(session: PerfSession) {
    this.perfSessions.set(session.id, structuredClone(session));
    this.save();
  }
  async listPerfSessions(since: string, limit: number) {
    return structuredClone(
      [...this.perfSessions.values()]
        .filter((p) => p.lastSeen >= since)
        .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
        .slice(0, limit),
    );
  }
  async addPerfSamples(samples: PerfSample[]) {
    const added: PerfSample[] = [];
    for (const sample of samples) {
      if (this.perfSamples.has(sample.id)) continue;
      this.perfSamples.set(sample.id, structuredClone(sample));
      added.push(sample);
    }
    this.prune();
    this.save();
    return added;
  }
  async listPerfSamples(sessionId: string, limit: number) {
    return structuredClone(
      [...this.perfSamples.values()]
        .filter((p) => p.sessionId === sessionId)
        .sort((a, b) => a.t - b.t)
        .slice(-limit),
    );
  }

  async getRelease(id: string) {
    return structuredClone(this.releases.get(id) ?? null);
  }
  async putRelease(release: Release) {
    this.releases.set(release.id, structuredClone(release));
    this.save();
  }
  async listReleases(limit: number) {
    return structuredClone([...this.releases.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit));
  }
  async deleteRelease(id: string) {
    this.releases.delete(id);
    this.save();
  }

  async putMachine(record: MachineRecord) {
    this.machines.set(machineKey(record), structuredClone(record));
    this.save();
  }
  async listMachines() {
    return structuredClone([...this.machines.values()]);
  }

  async getUpdateRequest() {
    return structuredClone(this.updateRequest);
  }
  async putUpdateRequest(request: AgentctlUpdateRequest) {
    this.updateRequest = structuredClone(request);
    this.save();
  }
}

function machineKey(m: Pick<MachineRecord, 'machine' | 'kind'>): string {
  return `${m.kind}:${m.machine}`;
}

