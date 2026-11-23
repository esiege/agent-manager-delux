// Turns README.md (Cloud tab selected) into the same page with the This PC tab selected, in place.
// .github/workflows/this-pc.yml runs it to make the this-pc branch, which the This PC tab links to.
// Fails if the README no longer has the parts it changes.
import { readFileSync, writeFileSync } from 'node:fs';

let text = readFileSync('README.md', 'utf8').replace(/\r\n/g, '\n');

function swap(what, from, to) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`README.md: expected one ${what}, found ${count}`);
  text = text.replace(from, () => to);
}

const repo = 'https://github.com/esiege/agent-manager-delux';
const tab = (name, state, alt) => {
  const file = `Docs/assets/tab-${name}-${state}`;
  return `<picture><source media="(prefers-color-scheme: light)" srcset="${file}-light.svg"><img src="${file}-dark.svg" alt="${alt}" width="50%"></picture>`;
};
const cloud = 'Cloud: works with every PC, and from your phone. Recommended.';
const pc = 'This PC: only reachable from this PC. Free.';

swap(
  'tab bar',
  `${tab('cloud', 'on', `${cloud} (selected)`)}<a href="${repo}/tree/this-pc#get-started">${tab('this-pc', 'off', pc)}</a>`,
  `<a href="${repo}#get-started">${tab('cloud', 'off', cloud)}</a>${tab('this-pc', 'on', `${pc} (selected)`)}`,
);
// The prompt is there twice: as the image's alt text, and as the hidden text the copy button copies.
const cloudPrompt = 'and deploy my own Agent Manager Delux to Azure from this folder.';
const pcPrompt = 'and set up Agent Manager Delux to run on this PC from this folder.';
swap('prompt image text', `${cloudPrompt}" width`, `${pcPrompt}" width`);
swap('prompt to copy', `${cloudPrompt}</rp>`, `${pcPrompt}</rp>`);
for (const theme of ['light', 'dark']) swap(`${theme} prompt image`, `prompt-cloud-${theme}.svg`, `prompt-this-pc-${theme}.svg`);
const note = text.match(/<a href="https:\/\/azure\.microsoft\.com\/free"><img [^\n]*<\/a>\n\n/);
if (!note) throw new Error('README.md: no Azure note');
// Same height as the Azure note, so the page doesn't jump between tabs.
const pcNote = 'No account needed. Phone alerts still work, through ntfy. Opens the ntfy site.';
swap(
  'Azure note',
  note[0],
  `<a href="https://ntfy.sh"><img src="Docs/assets/pc-note.svg" alt="${pcNote}" width="900"></a>

`,
);

writeFileSync('README.md', text);
