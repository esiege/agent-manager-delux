// Files you attach to an answer: which types the manager takes, and the size limits it enforces,
// checked here first so a wrong file fails at once instead of after the upload.

import { FEEDBACK_MEDIA_TYPES, LIMITS, type FeedbackMediaKind, type FeedbackMediaType } from '@agent-manager-delux/shared';

/** What browsers call some types, and the names the manager uses. */
const ALIASES: Record<string, FeedbackMediaType> = {
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/mp3': 'audio/mpeg',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'image/jpg': 'image/jpeg',
};

const BY_EXTENSION: Record<string, FeedbackMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  weba: 'audio/webm',
};

/** The file's type as the manager names it, or null when it isn't one it takes. */
export function mediaTypeOf(file: File): FeedbackMediaType | null {
  const type = file.type.toLowerCase();
  if (type in FEEDBACK_MEDIA_TYPES) return type as FeedbackMediaType;
  if (type in ALIASES) return ALIASES[type]!;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[ext] ?? null;
}

export function mediaKindOf(type: FeedbackMediaType): FeedbackMediaKind {
  return FEEDBACK_MEDIA_TYPES[type];
}

/** Why the file can't go, or null when it can. */
export function whyNotAttach(file: File): string | null {
  const type = mediaTypeOf(file);
  if (!type) return `${file.name}: attach a picture (PNG, JPEG, WebP, GIF), a video (MP4, WebM) or a sound (MP3, WAV, OGG, M4A)`;
  const max = mediaKindOf(type) === 'image' ? LIMITS.feedbackImageBytes : LIMITS.feedbackClipBytes;
  if (file.size > max) return `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${max / 1024 / 1024} MB`;
  return null;
}

/** Accept list for a file input. */
export const MEDIA_ACCEPT = [...Object.keys(FEEDBACK_MEDIA_TYPES), '.m4a', '.mp3', '.wav', '.ogg'].join(',');
