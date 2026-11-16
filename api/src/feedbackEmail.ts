// The email for a new feedback request: the whole request, with one-click answers. Each option and
// rating number links to the answer page with it picked; the page needs no sign-in (the link is
// signed: links.ts), so one more click sends it. Email clients don't run forms, hence links.

import { FEEDBACK_LINK_DAYS, type Feedback, type FeedbackMedia, type FeedbackQuestion } from '@agent-manager-delux/shared';
import { esc, type Email } from './email';

const ACCENT = '#b8860b';
const MUTED = '#6b6b6b';
const BORDER = '#dddddd';

export interface FeedbackEmailLinks {
  /** The answer page, with an optional preselection. */
  answer: (q?: string, a?: string) => string;
  /** A signed address for one of the request's files. */
  media: (mediaId: string) => string;
  /** The request on the Feedback tab (needs sign-in). */
  tab: string;
}

/** Just enough Markdown for an email: paragraphs, lists, bold, italics, code and links. */
export function miniMarkdown(md: string): string {
  const inline = (t: string) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, `<a href="$2" style="color:${ACCENT}">$1</a>`);
  const out: string[] = [];
  for (const block of md.trim().split(/\n\s*\n/)) {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*] /.test(l))) {
      out.push(`<ul style="margin:0 0 12px;padding-left:20px">${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`);
    } else {
      out.push(`<p style="margin:0 0 12px">${lines.map(inline).join('<br>')}</p>`);
    }
  }
  return out.join('');
}

function button(href: string, label: string, primary = false): string {
  const style = primary
    ? `background:${ACCENT};color:#ffffff;border:1px solid ${ACCENT}`
    : `background:#ffffff;color:#222222;border:1px solid ${BORDER}`;
  return `<a href="${esc(href)}" style="${style};display:inline-block;padding:8px 14px;margin:0 6px 6px 0;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">${label}</a>`;
}

function mediaBlock(f: Feedback, m: FeedbackMedia, links: FeedbackEmailLinks, href?: string): string {
  const caption = m.name ? f.captions?.[m.name] : undefined;
  const cap = caption ? `<div style="color:${MUTED};font-size:13px;margin-top:4px">${esc(caption)}</div>` : '';
  const url = links.media(m.id);
  if (m.kind === 'image') {
    const img = `<img src="${esc(url)}" alt="${esc(m.name ?? 'Picture')}" width="100%" style="max-width:560px;border-radius:6px;border:1px solid ${BORDER};display:block">`;
    return `<div style="margin:0 0 12px">${href ? `<a href="${esc(href)}">${img}</a>` : img}${cap}</div>`;
  }
  const verb = m.kind === 'audio' ? 'Listen to' : 'Watch';
  return `<div style="margin:0 0 12px">${button(url, `&#9654; ${verb} ${esc(m.name ?? m.kind)}`)}${cap}</div>`;
}

function byName(f: Feedback, name: string | null | undefined): FeedbackMedia | undefined {
  return name ? f.media.find((m) => m.name === name) : undefined;
}

function questionBlock(f: Feedback, q: FeedbackQuestion, links: FeedbackEmailLinks): string {
  const parts = [`<div style="font-weight:700;font-size:15px;margin:0 0 8px">${esc(q.prompt)}</div>`];
  for (const name of q.media ?? []) {
    const m = byName(f, name);
    if (m) parts.push(mediaBlock(f, m, links));
  }
  if (q.type === 'choice') {
    for (const o of q.options) {
      const href = links.answer(q.id, o.id);
      const m = byName(f, o.media);
      const rec = q.recommended === o.id ? ` <span style="color:#2e7d32;font-size:12px;font-weight:600">Recommended</span>` : '';
      const detail = o.detail ? `<div style="color:${MUTED};font-size:13px">${esc(o.detail)}</div>` : '';
      const caption = m?.name ? f.captions?.[m.name] : undefined;
      const capLine = caption ? `<div style="color:${MUTED};font-size:12px;margin:0 0 4px">${esc(caption)}</div>` : '';
      const pic =
        m && m.kind === 'image'
          ? `<img src="${esc(links.media(m.id))}" alt="" width="100%" style="max-width:260px;border-radius:4px;display:block;margin-bottom:4px">${capLine}`
          : capLine;
      const clip = m && m.kind !== 'image' ? `<div>${button(links.media(m.id), `&#9654; ${m.kind === 'audio' ? 'Listen' : 'Watch'}`)}</div>` : '';
      parts.push(
        `<a href="${esc(href)}" style="display:block;border:1px solid ${BORDER};border-radius:8px;padding:10px 12px;margin:0 0 8px;text-decoration:none;color:#222222">${pic}<span style="font-weight:600">${q.multiple ? '&#9744;' : '&#9675;'} ${esc(o.label)}</span>${rec}${detail}</a>${clip}`,
      );
    }
    if (q.multiple) parts.push(`<div style="color:${MUTED};font-size:12px;margin:0 0 4px">Pick one here; you can tick more on the page.</div>`);
  } else if (q.type === 'rating') {
    const nums = Array.from({ length: q.max }, (_, i) => button(links.answer(q.id, String(i + 1)), String(i + 1))).join('');
    const na = q.notApplicable ? button(links.answer(q.id, 'n/a'), esc(q.notApplicable)) : '';
    const ends = q.low || q.high ? `<div style="color:${MUTED};font-size:12px">${esc(q.low ?? '')}${q.low && q.high ? ' &rarr; ' : ''}${esc(q.high ?? '')}</div>` : '';
    parts.push(`<div>${nums}${na}</div>${ends}`);
  } else {
    parts.push(button(links.answer(q.id), 'Write your answer'));
  }
  return `<div style="margin:0 0 20px">${parts.join('')}</div>`;
}

export function feedbackEmail(f: Feedback, to: string, links: FeedbackEmailLinks, followsTitle: string | null): Email {
  const who = f.project || f.agentName;
  const referenced = new Set([...f.questions.flatMap((q) => [...(q.media ?? []), ...(q.type === 'choice' ? q.options.map((o) => o.media) : [])])]);
  const loose = f.media.filter((m) => !m.name || !referenced.has(m.name));
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f3ef">
<div style="max-width:600px;margin:0 auto;padding:20px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#222222;font-size:15px;line-height:1.45">
<div style="background:#ffffff;border:1px solid ${BORDER};border-radius:10px;padding:20px">
<div style="color:${MUTED};font-size:13px;margin:0 0 6px">${esc(who)} asks for your feedback${f.group ? ` &middot; ${esc(f.group)}` : ''}</div>
<h1 style="font-size:20px;margin:0 0 12px">${esc(f.title)}</h1>
${followsTitle ? `<div style="color:${MUTED};font-size:13px;margin:0 0 12px">${f.supersedes ? 'Replaces' : 'Follows up on'}: ${esc(followsTitle)}</div>` : ''}
${f.body ? miniMarkdown(f.body) : ''}
${loose.map((m) => mediaBlock(f, m, links)).join('')}
${f.questions.map((q) => questionBlock(f, q, links)).join('')}
<div style="margin:8px 0 0">${button(links.answer(), f.questions.length ? 'Add a note or files, or dismiss' : 'Write your feedback', f.questions.length === 0)}</div>
</div>
<div style="color:${MUTED};font-size:12px;margin:14px 4px 0">
Clicking an answer opens a page with it filled in; one more click sends it. The links work without signing in for ${FEEDBACK_LINK_DAYS} days or until it's answered, so anyone you forward this to can answer it.<br>
<a href="${esc(links.tab)}" style="color:${MUTED}">Open it on the Feedback tab</a> &middot; Turn these emails off on the Feedback tab.
</div></div></body></html>`;

  const text = [
    `${who} asks for your feedback${f.group ? ` (${f.group})` : ''}: ${f.title}`,
    '',
    f.body ?? '',
    '',
    ...f.questions.map((q) => {
      if (q.type === 'choice') return `${q.prompt}\n${q.options.map((o) => `  - ${o.label}: ${links.answer(q.id, o.id)}`).join('\n')}`;
      if (q.type === 'rating') return `${q.prompt} (1 to ${q.max}): ${links.answer(q.id)}`;
      return `${q.prompt}: ${links.answer(q.id)}`;
    }),
    '',
    `Answer: ${links.answer()}`,
    `On the Feedback tab: ${links.tab}`,
  ].join('\n');

  return { to, subject: `Feedback: ${f.title} (${who})`, html, text };
}
