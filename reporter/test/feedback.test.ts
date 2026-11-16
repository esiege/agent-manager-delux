import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeFeedback, readFeedbackForm, readFeedbackQuestions, type Feedback } from '@agent-manager-delux/shared';
import { FeedbackFileError, questionFromFlag, readFeedbackFile, readForm } from '../src/feedback';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'am-feedback-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readFeedbackFile', () => {
  it('names the type from the extension', () => {
    const file = join(dir, 'Login Screen.PNG');
    writeFileSync(file, Buffer.from([1, 2, 3]));
    expect(readFeedbackFile(file)).toMatchObject({ name: 'Login Screen.PNG', contentType: 'image/png' });
    writeFileSync(join(dir, 'clip.webm'), Buffer.from([1]));
    expect(readFeedbackFile(join(dir, 'clip.webm')).contentType).toBe('video/webm');
    writeFileSync(join(dir, 'roar.mp3'), Buffer.from([1]));
    expect(readFeedbackFile(join(dir, 'roar.mp3')).contentType).toBe('audio/mpeg');
    writeFileSync(join(dir, 'voice.m4a'), Buffer.from([1]));
    expect(readFeedbackFile(join(dir, 'voice.m4a')).contentType).toBe('audio/mp4');
  });

  it('refuses missing files, other types and files over the limit', () => {
    expect(() => readFeedbackFile(join(dir, 'nope.png'))).toThrow(FeedbackFileError);
    writeFileSync(join(dir, 'notes.txt'), 'x');
    expect(() => readFeedbackFile(join(dir, 'notes.txt'))).toThrow(/PNG, JPEG, WebP or GIF/);
    writeFileSync(join(dir, 'big.png'), Buffer.alloc(8 * 1024 * 1024 + 1));
    expect(() => readFeedbackFile(join(dir, 'big.png'))).toThrow(/limit is 8 MB/);
  });
});

describe('questions from flags', () => {
  it('reads each kind, marking the recommended option', () => {
    expect(questionFromFlag('question', 'Anything else?')).toEqual({ type: 'text', prompt: 'Anything else?' });
    expect(questionFromFlag('choice', 'Which teeth? | Ivory | Gold*')).toEqual({
      type: 'choice',
      prompt: 'Which teeth?',
      options: [
        { id: '1', label: 'Ivory' },
        { id: '2', label: 'Gold' },
      ],
      recommended: '2',
    });
    expect(questionFromFlag('multi', 'Slow levels?|Swamp|Mill|Dam')).toMatchObject({ multiple: true, options: [{}, {}, {}] });
    expect(questionFromFlag('rating', 'How menacing?|Cuddly|Terrifying')).toEqual({
      type: 'rating',
      prompt: 'How menacing?',
      max: 5,
      low: 'Cuddly',
      high: 'Terrifying',
    });
    expect(questionFromFlag('choice', 'A or B?|A \\| one|B')).toMatchObject({ options: [{ label: 'A | one' }, { label: 'B' }] });
    expect(questionFromFlag('rating', "Roar?|Quiet|Loud|Didn't hear it")).toMatchObject({ notApplicable: "Didn't hear it" });
  });

  it('needs two options for a choice', () => {
    expect(() => questionFromFlag('choice', 'Which?|Only')).toThrow(/at least two options/);
  });

  it('makes questions the manager takes', () => {
    expect(() => readFeedbackQuestions([questionFromFlag('choice', 'Which?|A|B*'), questionFromFlag('rating', 'Score')])).not.toThrow();
  });
});

describe('readForm', () => {
  it('attaches the files a form names, keeping just their names and captions', () => {
    writeFileSync(join(dir, 'gold.png'), Buffer.from([1]));
    writeFileSync(join(dir, 'clip.mp4'), Buffer.from([1]));
    const form = readForm(
      JSON.stringify({
        body: 'Built with ivory teeth.',
        questions: [
          { type: 'choice', prompt: 'Teeth?', options: [{ label: 'Ivory' }, { label: 'Gold', media: 'gold.png' }] },
          { prompt: 'x', media: [{ file: 'clip.mp4', caption: 'The roar' }, 'shot.png'] },
        ],
      }),
      join(dir, 'form.json'),
      ['shot.png'],
    );
    expect(form.body).toBe('Built with ivory teeth.');
    expect(form.files.sort()).toEqual([join(dir, 'clip.mp4'), join(dir, 'gold.png')]);
    expect((form.questions[0]!.options as { media?: string }[])[1]!.media).toBe('gold.png');
    expect(form.questions[1]!.media).toEqual([{ file: 'clip.mp4', caption: 'The roar' }, 'shot.png']);
    expect(readFeedbackForm(form.questions).captions).toEqual({ 'clip.mp4': 'The roar' });
  });

  it('stops before sending when the form names a file that is not there', () => {
    const text = JSON.stringify([{ prompt: 'x', media: 'missing.png' }]);
    expect(() => readForm(text, join(dir, 'form.json'))).toThrow(/a file that isn't there: missing.png.*Nothing was sent/);
  });

  it('takes a bare list and refuses what is not a form', () => {
    expect(readForm('[{"prompt":"x"}]', null).questions).toHaveLength(1);
    expect(() => readForm('{', null)).toThrow(/isn't JSON/);
    expect(() => readForm('{"a":1}', null)).toThrow(/list of questions/);
  });
});

describe('describeFeedback', () => {
  const base: Feedback = {
    id: '6f1c2c1e-0000-4000-8000-000000000001',
    agentId: 'pc/claude/s1',
    agentName: 'Beaverlogger',
    kind: 'claude-code',
    project: 'Twisted Vanworld',
    machine: 'pc',
    title: 'New Clunk: Beaverlogger',
    body: null,
    questions: readFeedbackQuestions([
      { type: 'choice', prompt: 'Which teeth?', options: ['Ivory', 'Gold'], recommended: '2' },
      { type: 'rating', prompt: 'How menacing?', max: 5, high: 'Terrifying' },
    ]),
    media: [],
    status: 'open',
    createdAt: '2026-11-15T12:00:00.000Z',
    updatedAt: '2026-11-15T12:00:00.000Z',
    history: [{ status: 'open', at: '2026-11-15T12:00:00.000Z', by: 'Beaverlogger', note: null }],
    response: null,
    follows: null,
    followedBy: null,
    delivery: null,
    messageId: null,
    keyName: 'pc',
  };

  it('says when nobody has answered yet', () => {
    expect(describeFeedback(base)).toContain("hasn't answered yet");
  });

  it('prints the answers and what to report next', () => {
    const text = describeFeedback({
      ...base,
      status: 'viewed',
      response: { answers: { q1: '2', q2: 5 }, note: 'Love it', by: 'me', at: '2026-11-15T12:05:00.000Z' },
    });
    expect(text).toContain('Status: Agent viewed.');
    expect(text).toContain('- Which teeth?\n  Gold [2] (your recommendation)');
    expect(text).toContain('- How menacing?\n  5 of 5 (Terrifying)');
    expect(text).toContain('Their note:\nLove it');
    expect(text).toContain(`agentctl feedback status ${base.id} planning`);
  });

  it('tells the agent to go ahead with its default when dismissed', () => {
    expect(describeFeedback({ ...base, status: 'dismissed' })).toContain('Go ahead with your default');
  });

  it('gives the closing note instead of next steps once closed', () => {
    const text = describeFeedback({
      ...base,
      status: 'closed',
      response: { answers: {}, note: 'ok', by: 'me', at: base.createdAt },
      history: [...base.history, { status: 'closed', at: base.createdAt, by: 'Beaverlogger', note: 'Done in v0.18' }],
    });
    expect(text).toContain('Closing note: Done in v0.18');
    expect(text).not.toContain('feedback status');
  });
});
