// Reads the crash reports Unreal's CrashReportClient uploads when its DataRouterUrl points here
// (web/public/performance.md, "Crashes from Unreal's crash reporter").
//
// The upload is zlib-compressed. Inside: the report's folder name, a file name, the uncompressed
// size and the file count, then each file as an index, a name and its bytes. Strings are
// Unreal FStrings: an int32 length that counts the terminating null, then the characters (ANSI
// when the length is positive, UTF-16 when negative). Integers are little-endian.
//
// From the files we keep what a person can read: CrashContext.runtime-xml (the error, callstack,
// engine and build, and the game data the game set) and the end of the game's log. The minidump
// isn't kept.

import { gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';
import { LIMITS, maskSecrets } from '@agent-manager-delux/shared';

export interface UnrealCrashFile {
  name: string;
  data: Buffer;
}

export class UnrealCrashError extends Error {}

function decompress(body: Buffer): Buffer {
  for (const inflate of [inflateSync, gunzipSync, inflateRawSync]) {
    try {
      return inflate(body);
    } catch {
      // Try the next one.
    }
  }
  return body;
}

class Cursor {
  pos = 0;
  constructor(private readonly buf: Buffer) {}

  i32(): number {
    if (this.pos + 4 > this.buf.length) throw new UnrealCrashError('The crash report ends early');
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  bytes(n: number): Buffer {
    if (n < 0 || this.pos + n > this.buf.length) throw new UnrealCrashError('The crash report ends early');
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  fstring(): string {
    const len = this.i32();
    if (len === 0) return '';
    if (Math.abs(len) > 64 * 1024) throw new UnrealCrashError('The crash report has a string too long to be a file name');
    const text = len > 0 ? this.bytes(len).toString('latin1') : this.bytes(-len * 2).toString('utf16le');
    return text.replace(/\0+$/, '');
  }
}

/** The files in an upload. Throws UnrealCrashError when it isn't an Unreal crash report. */
export function readUnrealCrash(body: Buffer): UnrealCrashFile[] {
  let buf = decompress(body);
  // Some versions put a "CR1" tag in front.
  if (buf.subarray(0, 3).toString('latin1') === 'CR1') buf = buf.subarray(3);
  const c = new Cursor(buf);
  c.fstring(); // the report's folder name
  c.fstring(); // a file name
  c.i32(); // the uncompressed size
  const count = c.i32();
  if (count < 1 || count > 500) throw new UnrealCrashError(`This isn't an Unreal crash report (it says it holds ${count} files)`);
  const files: UnrealCrashFile[] = [];
  for (let i = 0; i < count; i++) {
    c.i32(); // the file's index
    const name = c.fstring();
    const length = c.i32();
    files.push({ name, data: Buffer.from(c.bytes(length)) });
  }
  return files;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  const v = m?.[1] ? unescapeXml(m[1]).trim() : '';
  return v || null;
}

/** The children of <GameData>: what the game set with FGenericCrashContext::SetGameData. */
function gameData(xml: string): Record<string, string> {
  const block = /<GameData>([\s\S]*?)<\/GameData>/.exec(xml)?.[1] ?? '';
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/<([A-Za-z_][\w.-]*)>([\s\S]*?)<\/\1>/g)) out[m[1]!] = unescapeXml(m[2]!).trim();
  return out;
}

/** Hides the user name in paths like C:\Users\<name>\... and /home/<name>/..., then masks secrets. */
export function scrub(text: string): string {
  return maskSecrets(
    text
      .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\r\n"'<>]+/gi, '$1<user>')
      .replace(/(\/(?:home|Users)\/)[^/\r\n"'<>]+/g, '$1<user>'),
  );
}

export interface UnrealCrash {
  reason: string;
  callstack: string | null;
  log: string | null;
  breadcrumbs: string[];
  game: string | null;
  machine: string | null;
  build: string | null;
  sessionId: string | null;
  scene: string | null;
  kind: string | null;
  t: number | null;
  platform: string | null;
  details: Record<string, unknown>;
}

/** What's worth keeping from an uploaded crash report. */
export function summarizeUnrealCrash(files: UnrealCrashFile[]): UnrealCrash {
  const context = files.find((f) => /CrashContext\.runtime-xml$/i.test(f.name));
  const xml = context ? context.data.toString('utf8') : '';
  const data = gameData(xml);
  const logFile = files.find((f) => /\.log$/i.test(f.name));
  const logText = logFile ? logFile.data.toString('utf8') : '';
  const callstack = tag(xml, 'CallStack') ?? tag(xml, 'PCallStack');
  const reason = tag(xml, 'ErrorMessage') ?? tag(xml, 'CrashType') ?? 'Unreal crash report with no error message';
  const crumbs = (data.AMBreadcrumbs ?? '')
    .split(/\r?\n| \| /)
    .map((s) => s.trim())
    .filter(Boolean);
  const seconds = Number(tag(xml, 'SecondsSinceStart'));
  const gameName = tag(xml, 'GameName')?.replace(/^UE[45]-/, '') ?? null;
  const details: Record<string, unknown> = {};
  for (const [key, name] of [
    ['engineVersion', 'EngineVersion'],
    ['crashType', 'CrashType'],
    ['crashGuid', 'CrashGUID'],
    ['buildConfiguration', 'BuildConfiguration'],
    ['cpu', 'Misc.CPUBrand'],
    ['gpu', 'Misc.PrimaryGPUBrand'],
    ['os', 'Misc.OSVersionMajor'],
  ] as const) {
    const v = tag(xml, name);
    if (v) details[key] = v;
  }
  for (const [k, v] of Object.entries(data)) if (!k.startsWith('AM')) details[k] = v;
  details.files = files.map((f) => `${f.name} (${f.data.length} bytes)`);

  return {
    reason: scrub(reason.split(/\r?\n/)[0]!.trim()).slice(0, LIMITS.perfCrashReasonLength),
    callstack: callstack ? scrub(callstack).slice(0, LIMITS.perfCrashCallstackLength) : null,
    log: logText ? scrub(logText.slice(-LIMITS.crashLogLength)) : null,
    breadcrumbs: crumbs.slice(-LIMITS.crashBreadcrumbs).map((s) => scrub(s).slice(0, LIMITS.crashBreadcrumbLength)),
    game: data.AMGame || gameName,
    machine: data.AMMachine || null,
    build: data.AMBuild || tag(xml, 'BuildVersion'),
    sessionId: data.AMSessionId || null,
    scene: data.AMScene || null,
    kind: data.AMKind || null,
    t: Number.isFinite(seconds) && seconds >= 0 ? seconds : null,
    platform: tag(xml, 'PlatformNameIni') ?? tag(xml, 'PlatformName'),
    details,
  };
}
