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
  const file = `${repo}/raw/main/Docs/assets/panel-tab-${name}-${state}`;
  return `<picture><source media="(prefers-color-scheme: light)" srcset="${file}-light.svg"><img src="${file}-dark.svg" alt="${alt}" width="50%" align="top"></picture>`;
};
const cloud = 'Cloud: works with every PC, and from your phone. Recommended.';
const pc = 'This PC: only reachable from this PC. Free.';

swap(
  'tab bar',
  `${tab('cloud', 'on', `${cloud} (selected)`)}<a href="${repo}/tree/this-pc#get-started">${tab('this-pc', 'off', pc)}</a>`,
  `<a href="${repo}#get-started">${tab('cloud', 'off', cloud)}</a>${tab('this-pc', 'on', `${pc} (selected)`)}`,
);
swap('cloud prompt', 'and deploy it to Azure</code>', 'and run it on this PC</code>');
const note = text.match(/<a href="https:\/\/azure\.microsoft\.com\/free"><picture>[^\n]*<\/a>\n\n/);
if (!note) throw new Error('README.md: no Azure note');
// Same height as the Azure note, so the page doesn't jump between tabs.
const pcNote = 'No cloud account needed. Phone alerts still work, through ntfy. Opens the ntfy site.';
swap(
  'Azure note',
  note[0],
  `<a href="https://ntfy.sh"><picture><source media="(prefers-color-scheme: light)" srcset="Docs/assets/note-pc-light.svg"><img src="Docs/assets/note-pc-dark.svg" alt="${pcNote}" width="900"></picture></a>

`,
);

writeFileSync('README.md', text);
