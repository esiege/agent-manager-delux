import { describe, expect, it } from 'vitest';
import { releaseLinkArg } from '../src/release';

describe('releaseLinkArg', () => {
  it('takes a bare URL, keeping any = in it', () => {
    expect(releaseLinkArg('https://example.com/get?file=win.zip')).toEqual({ url: 'https://example.com/get?file=win.zip' });
  });
  it('takes a label and a URL', () => {
    expect(releaseLinkArg('Windows build = https://example.com/win.zip?v=2')).toEqual({ label: 'Windows build', url: 'https://example.com/win.zip?v=2' });
  });
  it('refuses anything else', () => {
    expect(() => releaseLinkArg('Windows build')).toThrow(/--link takes/);
    expect(() => releaseLinkArg('Store=ftp://example.com')).toThrow(/--link takes/);
  });
});
