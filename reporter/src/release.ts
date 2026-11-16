// Helpers for `agentctl release`.

/** A --link value: "<url>" (the server labels it with its host) or "<label>=<url>". Throws on anything else. */
export function releaseLinkArg(value: string): { label?: string; url: string } {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return { url: v };
  const at = v.indexOf('=');
  const url = at > 0 ? v.slice(at + 1).trim() : '';
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(`--link takes "<label>=<https URL>" or a URL; "${value}" is neither`);
  return { label: v.slice(0, at).trim(), url };
}
