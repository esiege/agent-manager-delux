// Registers every HTTP function with the Azure Functions host (Node v4 programming model).
// Routes sit under the default "api" prefix: /api/v1/...

import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { guarded, type Ctx, type Handler } from './http';
import { getStore } from './store';
import { getMediaStore, getReleaseMediaStore } from './store/media';
import { heartbeat, report } from './handlers/ingest';
import { agent, agents, me } from './handlers/read';
import { createKey, listKeys, revokeKey } from './handlers/keys';
import { deleteAlert, listAlerts, saveAlert, sweepAlerts, testAlert } from './handlers/alerts';
import { agentctlStatus, requestAgentctlUpdate } from './handlers/agentctl';
import { crashDetail, listCrashes, machineNames, postCrash, setMachineName, unrealCrash } from './handlers/crashes';
import { ackMessage, inbox, sendMessage } from './handlers/messages';
import { hideAgents } from './handlers/hide';
import { reporting } from './handlers/reporting';
import { perfSamples, perfSession, perfSessionDetail, perfSessions } from './handlers/perf';
import { addReleaseScreenshot, createRelease, deleteRelease, listReleases, releaseScreenshot } from './handlers/releases';
import {
  addAnswerMedia,
  addFeedbackMedia,
  createFeedback,
  feedbackReady,
  linkAddAnswerMedia,
  linkFeedback,
  linkMedia,
  linkRemoveAnswerMedia,
  linkRespond,
  removeAnswerMedia,
  feedbackInbox,
  feedbackItem,
  feedbackList,
  feedbackMedia,
  feedbackStatus,
  legacyBlocker,
  respondFeedback,
} from './handlers/feedback';

function register(name: string, method: 'GET' | 'POST', route: string, handler: Handler) {
  app.http(name, {
    methods: [method],
    route,
    authLevel: 'anonymous', // callers are checked in code: the owner's sign-in or a machine key
    handler: async (request: HttpRequest, invocation: InvocationContext): Promise<HttpResponseInit> => {
      const env = process.env;
      let ctx: Ctx;
      try {
        ctx = { store: getStore(env), now: () => new Date(), env, media: getMediaStore(env), releaseMedia: getReleaseMediaStore(env) };
      } catch (e) {
        invocation.error((e as Error).message);
        return { status: 500, jsonBody: { error: (e as Error).message } };
      }
      const raw = method === 'GET' ? undefined : Buffer.from(await request.arrayBuffer());
      const body = raw ? raw.toString('utf8') : '';
      const res = await guarded(handler, (m) => invocation.error(m))(
        { method: request.method, url: request.url, headers: request.headers as unknown as Headers, body, raw },
        ctx,
      );
      // Refusals go to Application Insights with their reason (never secrets: errors don't contain them).
      if (res.status >= 400 && res.status < 500) {
        invocation.warn(`${name} answered ${res.status}: ${(res.body as { error?: string }).error ?? ''}`);
      }
      const headers = { 'cache-control': 'no-store', ...res.headers };
      if (res.bytes) return { status: res.status, body: res.bytes, headers };
      return { status: res.status, jsonBody: res.body, headers };
    },
  });
}

register('report', 'POST', 'v1/report', report);
register('heartbeat', 'POST', 'v1/heartbeat', heartbeat);

register('me', 'GET', 'v1/me', me);
register('agents', 'GET', 'v1/agents', agents);
register('agent', 'GET', 'v1/agent', agent);
register('hideAgents', 'POST', 'v1/agents/hide', hideAgents);
register('reporting', 'GET', 'v1/reporting', reporting);

register('perfSession', 'POST', 'v1/perf/session', perfSession);
register('perfSamples', 'POST', 'v1/perf/samples', perfSamples);
register('perfSessions', 'GET', 'v1/perf/sessions', perfSessions);
register('perfSessionDetail', 'GET', 'v1/perf/session', perfSessionDetail);
register('postCrash', 'POST', 'v1/perf/crash', postCrash);
register('crashDetail', 'GET', 'v1/perf/crash', crashDetail);
register('unrealCrash', 'POST', 'v1/perf/crash/unreal/{key}', unrealCrash);
register('listCrashes', 'GET', 'v1/perf/crashes', listCrashes);
register('machineNames', 'GET', 'v1/machine-names', machineNames);
register('setMachineName', 'POST', 'v1/machine-names', setMachineName);

register('createRelease', 'POST', 'v1/releases', createRelease);
register('listReleases', 'GET', 'v1/releases', listReleases);
register('deleteRelease', 'POST', 'v1/releases/delete', deleteRelease);
register('addReleaseScreenshot', 'POST', 'v1/releases/screenshot', addReleaseScreenshot);
register('releaseScreenshot', 'GET', 'v1/releases/screenshot', releaseScreenshot);

register('listKeys', 'GET', 'v1/keys', listKeys);
register('createKey', 'POST', 'v1/keys', createKey);
register('revokeKey', 'POST', 'v1/keys/revoke', revokeKey);

register('listAlerts', 'GET', 'v1/alerts', listAlerts);
register('saveAlert', 'POST', 'v1/alerts', saveAlert);
register('deleteAlert', 'POST', 'v1/alerts/delete', deleteAlert);
register('testAlert', 'POST', 'v1/alerts/test', testAlert);
register('sweepAlerts', 'POST', 'v1/alerts/sweep', sweepAlerts);

register('createFeedback', 'POST', 'v1/feedback', createFeedback);
register('addFeedbackMedia', 'POST', 'v1/feedback/media', addFeedbackMedia);
register('feedbackList', 'GET', 'v1/feedback', feedbackList);
register('feedbackItem', 'GET', 'v1/feedback/item', feedbackItem);
register('feedbackInbox', 'GET', 'v1/feedback/inbox', feedbackInbox);
register('feedbackMedia', 'GET', 'v1/feedback/media', feedbackMedia);
register('feedbackStatus', 'POST', 'v1/feedback/status', feedbackStatus);
register('respondFeedback', 'POST', 'v1/feedback/respond', respondFeedback);
register('feedbackReady', 'POST', 'v1/feedback/ready', feedbackReady);
register('addAnswerMedia', 'POST', 'v1/feedback/answer-media', addAnswerMedia);
register('removeAnswerMedia', 'POST', 'v1/feedback/answer-media/remove', removeAnswerMedia);
// From the page a feedback email links to: the signed link is the only key.
register('linkFeedback', 'GET', 'v1/feedback/link', linkFeedback);
register('linkMedia', 'GET', 'v1/feedback/link/media', linkMedia);
register('linkRespond', 'POST', 'v1/feedback/link/respond', linkRespond);
register('linkAddAnswerMedia', 'POST', 'v1/feedback/link/answer-media', linkAddAnswerMedia);
register('linkRemoveAnswerMedia', 'POST', 'v1/feedback/link/answer-media/remove', linkRemoveAnswerMedia);
// What agentctl versions from before feedback call.
register('createBlocker', 'POST', 'v1/blockers', createFeedback);
register('addBlockerMedia', 'POST', 'v1/blockers/media', addFeedbackMedia);
register('blocker', 'GET', 'v1/blocker', legacyBlocker);

register('agentctlStatus', 'GET', 'v1/agentctl', agentctlStatus);
register('requestAgentctlUpdate', 'POST', 'v1/agentctl/update', requestAgentctlUpdate);

register('sendMessage', 'POST', 'v1/messages', sendMessage);
register('inbox', 'POST', 'v1/inbox', inbox);
register('ackMessage', 'POST', 'v1/inbox/ack', ackMessage);
