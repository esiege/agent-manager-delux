// Helpers for `agentctl feedback`: which files can go with a request, capturing the screen, and
// turning the command line's questions (or a --form file) into the questions the manager takes.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { FEEDBACK_MEDIA_TYPES, LIMITS, type FeedbackMediaType } from '@agent-manager-delux/shared';

const BY_EXTENSION: Record<string, FeedbackMediaType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.weba': 'audio/webm',
};

export class FeedbackFileError extends Error {}

export interface FeedbackFile {
  path: string;
  name: string;
  contentType: FeedbackMediaType;
  bytes: Buffer;
}

/** Reads a picture, clip or sound, refusing types and sizes the manager won't take. */
export function readFeedbackFile(path: string): FeedbackFile {
  if (!existsSync(path) || !statSync(path).isFile()) throw new FeedbackFileError(`No file at ${path}`);
  const contentType = BY_EXTENSION[extname(path).toLowerCase()];
  if (!contentType) {
    throw new FeedbackFileError(
      `${basename(path)}: send a PNG, JPEG, WebP or GIF picture, an MP4 or WebM video, or an MP3, WAV, OGG or M4A sound`,
    );
  }
  const size = statSync(path).size;
  const max = FEEDBACK_MEDIA_TYPES[contentType] === 'image' ? LIMITS.feedbackImageBytes : LIMITS.feedbackClipBytes;
  if (size > max) {
    throw new FeedbackFileError(`${basename(path)} is ${(size / 1024 / 1024).toFixed(1)} MB; the limit is ${max / 1024 / 1024} MB. Shrink or trim it.`);
  }
  return { path, name: basename(path), contentType, bytes: readFileSync(path) };
}

/**
 * Captures the whole screen to a temporary JPEG and reads it. Not on Windows: Defender's script
 * scanning (AMSI) blocks a PowerShell screen grab as malware, and agentctl doesn't work around it.
 */
export function captureScreen(): FeedbackFile {
  if (process.platform === 'win32') {
    throw new FeedbackFileError(
      "--screen doesn't work on Windows (Defender blocks scripted screen captures). Attach a screenshot you have instead: --image <file>",
    );
  }
  const path = join(tmpdir(), `agent-manager-delux-screen-${Date.now()}.jpg`);
  try {
    if (process.platform === 'darwin') {
      execFileSync('screencapture', ['-x', '-t', 'jpg', path], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 30_000 });
    } else {
      captureLinux(path);
    }
  } catch (e) {
    const detail = (e as { stderr?: Buffer }).stderr?.toString().trim().split('\n').pop() || (e as Error).message;
    throw new FeedbackFileError(`Couldn't capture the screen: ${detail}`);
  }
  if (!existsSync(path)) throw new FeedbackFileError("Couldn't capture the screen: no image was written");
  try {
    return { ...readFeedbackFile(path), name: 'screen.jpg' };
  } finally {
    rmSync(path, { force: true });
  }
}

function captureLinux(path: string) {
  const tools: [string, string[]][] = [
    ['gnome-screenshot', ['-f', path]],
    ['grim', [path]],
    ['import', ['-window', 'root', path]],
    ['scrot', ['-o', path]],
  ];
  for (const [tool, args] of tools) {
    try {
      execFileSync(tool, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: 30_000 });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  throw new Error('no screenshot tool found (gnome-screenshot, grim, ImageMagick import or scrot); pass --image <file> instead');
}

// ---- Questions from the command line ----

export type QuestionFlag = 'question' | 'choice' | 'multi' | 'rating';
export const QUESTION_FLAGS: readonly QuestionFlag[] = ['question', 'choice', 'multi', 'rating'];

/** "a | b|c" → ["a", "b", "c"]; "\|" keeps a literal bar. */
function splitBars(value: string): string[] {
  return value
    .split(/(?<!\\)\|/)
    .map((p) => p.replace(/\\\|/g, '|').trim())
    .filter((p) => p !== '');
}

/**
 * One question from a flag, in the order the flags were given:
 *   --question "Anything else?"
 *   --choice "Which teeth?|Ivory|Gold*"       (* marks the option you recommend)
 *   --multi "Which levels feel slow?|Swamp|Mill|Dam"
 *   --rating "How menacing is it?|Cuddly|Terrifying"   (1 to 5; the words are for the ends)
 * The manager checks the rest (lengths, counts) and says what to fix.
 */
export function questionFromFlag(flag: QuestionFlag, value: string): Record<string, unknown> {
  const [prompt, ...rest] = splitBars(value);
  if (!prompt) throw new FeedbackFileError(`--${flag} needs the question first: --${flag} "<question>|..."`);
  if (flag === 'question') return { type: 'text', prompt: [prompt, ...rest].join(' | ') };
  if (flag === 'rating') {
    const [low, high] = rest;
    return { type: 'rating', prompt, max: 5, ...(low ? { low } : {}), ...(high ? { high } : {}) };
  }
  if (rest.length < 2) throw new FeedbackFileError(`--${flag} needs at least two options: --${flag} "${prompt}|<option>|<option>"`);
  let recommended: string | undefined;
  const options = rest.map((o, i) => {
    const marked = o.endsWith('*');
    const label = marked ? o.slice(0, -1).trim() : o;
    if (marked) recommended = String(i + 1);
    return { id: String(i + 1), label };
  });
  return { type: 'choice', prompt, options, ...(flag === 'multi' ? { multiple: true } : {}), ...(recommended ? { recommended } : {}) };
}

export interface Form {
  body: string | null;
  questions: Record<string, unknown>[];
  /** Files the form names, to attach. */
  files: string[];
}

/**
 * A --form file: a list of questions, or { "body", "questions" }. Media a question or option names
 * that's a file on disk (relative to the form) is attached, and the form keeps just its name.
 */
export function readForm(text: string, formPath: string | null): Form {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new FeedbackFileError(`The form isn't JSON: ${(e as Error).message}`);
  }
  const root = Array.isArray(raw) ? { questions: raw } : (raw as Record<string, unknown>);
  if (typeof root !== 'object' || root === null || !Array.isArray(root.questions)) {
    throw new FeedbackFileError('The form must be a list of questions, or { "body": "...", "questions": [...] }');
  }
  const base = formPath ? dirname(resolve(formPath)) : process.cwd();
  const files = new Set<string>();
  const attach = (name: unknown): unknown => {
    if (typeof name !== 'string') return name;
    const path = resolve(base, name);
    if (!existsSync(path)) return name; // a file attached some other way, by name
    files.add(path);
    return basename(path);
  };
  const questions = (root.questions as unknown[]).map((q) => {
    if (typeof q !== 'object' || q === null) return q as Record<string, unknown>;
    const out: Record<string, unknown> = { ...(q as Record<string, unknown>) };
    if (Array.isArray(out.media)) out.media = out.media.map(attach);
    else if (out.media !== undefined) out.media = attach(out.media);
    if (Array.isArray(out.options)) {
      out.options = out.options.map((o) =>
        typeof o === 'object' && o !== null && 'media' in o ? { ...o, media: attach((o as { media: unknown }).media) } : o,
      );
    }
    return out;
  });
  const body = typeof root.body === 'string' && root.body.trim() ? root.body.trim() : null;
  return { body, questions, files: [...files] };
}
