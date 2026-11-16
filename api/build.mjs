// Bundles the API into one file, so the deployed folder needs no node_modules.
// @azure/functions-core is supplied by the Functions host at run time and must stay external.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

// The agentctl.js deployed alongside this API (the reporter builds first). PCs whose agentctl
// hashes differently are offered it when the owner asks every PC to update.
const agentctl = '../reporter/dist/agentctl.js';
const agentctlSha256 = existsSync(agentctl) ? createHash('sha256').update(readFileSync(agentctl)).digest('hex') : '';
if (!agentctlSha256) console.warn('api build: reporter/dist/agentctl.js is missing, so this build cannot offer self-updates');

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  external: ['@azure/functions-core'],
  define: { __AGENTCTL_SHA256__: JSON.stringify(agentctlSha256) },
  logLevel: 'info',
});

// Run by scripts/move-data.ps1 to copy data between a local install and a cloud install. Not deployed.
await build({
  entryPoints: ['src/tools/move-data.ts'],
  outfile: 'dist/move-data.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  logLevel: 'info',
});
