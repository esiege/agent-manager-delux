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
  const file = `${repo}/raw/main/Docs/assets/step1-mode-${name}-${state}`;
  return `<picture><source media="(prefers-color-scheme: light)" srcset="${file}-light.svg"><img src="${file}-dark.svg" alt="${alt}" width="50%" align="top"></picture>`;
};
const cloud = 'Cloud: works with every PC, and from your phone. Recommended.';
const pc = 'This PC: only reachable from this PC. Free.';

swap(
  'tab bar',
  `${tab('cloud', 'on', `${cloud} (selected)`)}<a href="${repo}/tree/this-pc#get-started">${tab('this-pc', 'off', pc)}</a>`,
  `<a href="${repo}#get-started">${tab('cloud', 'off', cloud)}</a>${tab('this-pc', 'on', `${pc} (selected)`)}`,
);
// The prompt is there three times: drawn in the image, as its alt text, and as the hidden text (<rp>)
// that the copy button copies. Keep Docs/assets/promptbox-{cloud,pc}-*.svg in step with the wording here.
for (const end of ['" width="762"', '</rp>']) {
  swap(
    'cloud prompt',
    `and deploy my own Agent Manager Delux to Azure from this folder.${end}`,
    `and set up Agent Manager Delux to run on this PC from this folder.${end}`,
  );
}
for (const theme of ['light', 'dark']) {
  swap('prompt image', `/promptbox-cloud-${theme}.svg`, `/promptbox-pc-${theme}.svg`);
}
const note = text.match(/<a href="https:\/\/azure\.microsoft\.com\/free"><picture>[^\n]*<\/a>\n\n/);
if (!note) throw new Error('README.md: no Azure note');
// Same height as the Azure note, so the page doesn't jump between tabs.
const pcNote = 'No account needed. Your dashboard will run on localhost.';
swap(
  'Azure note',
  note[0],
  `<picture><source media="(prefers-color-scheme: light)" srcset="Docs/assets/note-local-light.svg"><img src="Docs/assets/note-local-dark.svg" alt="${pcNote}" width="900"></picture>

`,
);

// Step 2: its pictures, their alt text, and the prompt, which is in the alt text and the hidden text.
for (const name of ['step2-connect', 'promptbox-connect']) {
  for (const theme of ['light', 'dark']) {
    swap('step 2 picture', `/${name}-cloud-${theme}.svg`, `/${name}-pc-${theme}.svg`);
  }
}
swap('step 2 title', "Step 2: Connect this project. Send this to Claude Code on each PC, with your site's address.", "Step 2: Connect this project. Send this to Claude Code on this PC. It sets itself up.");
for (const start of ['alt="', '<rp>']) {
  swap('step 2 prompt', `${start}Read https://&lt;your-site&gt;/instructions.md`, `${start}Read http://localhost:5173/instructions.md`);
}

writeFileSync('README.md', text);
