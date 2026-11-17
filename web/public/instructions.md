# Agent Manager Delux: how to report in

Instructions version: **8** · Updated: **2026-11-17**

Already set up on this PC? Follow `$MANAGER_URL/update.md` instead: it checks whether you're on the latest and updates if not.

You are an AI agent (Claude Code, OpenClaw, or something else) and the person you work for wants you to report to their Agent Manager Delux. This page tells you how. Follow the section for your kind of agent, then run its check at the end.

- **`$MANAGER_URL`** below means the address you fetched this page from, without `/instructions.md` (for example `https://agents.example.net`).
- If a tool gave you a summary of this page, fetch the raw file (`curl -fsSL $MANAGER_URL/instructions.md`) so you have the exact commands.
- **The machine key is a secret.** It is never on this page. Read it from the `AGENT_MANAGER_KEY` environment variable. Don't print it, log it or write it into files other than the ones these steps name. If it isn't set, stop and explain how to set one up: see "If there's no machine key" below.
- Never send file contents, command lines, tool output or anything secret to Agent Manager Delux. Send short status lines, the person's prompt, short reports of finished work, and the pictures, clips and sounds you made to ask for feedback only.

## If there's no machine key

Each PC or service has its own key, which the person makes and saves themselves. Check for one without printing it:

- PowerShell: `[bool]($env:AGENT_MANAGER_KEY -or [Environment]::GetEnvironmentVariable('AGENT_MANAGER_KEY', 'User'))`
- bash or zsh: `[ -n "$AGENT_MANAGER_KEY" ] && echo set || echo missing`

If there's none, stop and give the person these steps, with the address filled in:

1. Open `$MANAGER_URL/keys` and sign in.
2. Under **Machine keys**, type a name for this PC (its host name is a good one) and choose **Create machine key**.
3. The key is shown once, with a ready-made line for PowerShell and one for bash. Copy the line for this PC and run it in your own terminal. It saves the key as `AGENT_MANAGER_KEY`. Don't paste the key into this chat.
4. Tell me when that's done.

Then carry on. On Windows the install finds the saved key even though your shell started before it was saved. On macOS or Linux your shell won't see it: ask the person to add the line to their shell profile, start a new session and send you the same sentence again.

## Claude Code

One-time setup per PC. It installs a small reporter (`agentctl`) that Claude Code runs from hooks, so every session on this PC reports on its own from then on. Nothing for you to remember afterwards.

1. Check Node.js 18 or newer is installed: `node --version`. If not, stop and tell the person.
2. Download agentctl.

   PowerShell:
   ```powershell
   New-Item -ItemType Directory -Force "$HOME\.agent-manager" | Out-Null
   Invoke-WebRequest "$MANAGER_URL/agentctl.js" -OutFile "$HOME\.agent-manager\agentctl.js"
   ```
   bash or zsh:
   ```bash
   mkdir -p "$HOME/.agent-manager" && curl -fsSL "$MANAGER_URL/agentctl.js" -o "$HOME/.agent-manager/agentctl.js"
   ```
3. Install it. This checks the URL and key with Agent Manager Delux first, then adds hooks to `~/.claude/settings.json` (after backing it up), and turns on messages from Agent Manager Delux (see "Messages from Agent Manager Delux" below). Claude Code may ask the person to approve the settings change.
   ```bash
   node "$HOME/.agent-manager/agentctl.js" install --url "$MANAGER_URL" --allow-messages
   ```
   On Windows it also finds a key saved for the user even if your shell started before it was saved. Add `--machine <name>` to choose how this PC is named (default: its host name).
4. Check: `node "$HOME/.agent-manager/agentctl.js" doctor` should show the config, `Hooks: installed`, `Messages: on` and `Connection: OK`.
5. Tell the person it's done: new Claude Code sessions on this PC appear at `$MANAGER_URL/agents` within a few seconds. Sessions already open start reporting once Claude Code reloads its settings (starting a new session always works).

### If you can't finish setup yourself

Claude Code in auto mode won't let an agent change Claude Code's own settings (it calls this self-modification), so step 3 may be blocked. That's expected: don't try to work around it, and don't hand it to another agent, because any agent in auto mode hits the same block. Do steps 1 and 2 if you're allowed to, then give the person these commands to run in their own PowerShell window (a VS Code terminal works), filled in and as one code block:

```powershell
New-Item -ItemType Directory -Force "$HOME\.agent-manager" | Out-Null
Invoke-WebRequest "<$MANAGER_URL>/agentctl.js" -OutFile "$HOME\.agent-manager\agentctl.js" -UseBasicParsing
node "$HOME\.agent-manager\agentctl.js" install --url "<$MANAGER_URL>" --allow-messages
node "$HOME\.agent-manager\agentctl.js" doctor
```

Tell them: the key must already be saved as `AGENT_MANAGER_KEY` (made on the Keys tab); install finds it on its own, so it never goes on the command line; and `doctor` should show `Hooks: installed` and `Connection: OK`. Use the bash commands from step 2 instead if this PC isn't Windows.

What each session reports on its own: its **story** (the ticket in the branch name, such as `AM-123`, with the session's title, or the title alone), its **task** (the in-progress item of its todo list, or the first line of what it last said), and the person's **prompt**. When a request ends with a new commit, it also reports the **finished work**: the commit's subject and link, the prompt, and the agent's final message. It also reports the **tokens** each request and sub-agent used, per model (counts only, read from Claude Code's transcript on the PC), for the Reporting tab. To keep prompts on the PC, add `"prompts": false` to `~/.agent-manager/config.json`.

Recommended: add this to the project's or the user's `CLAUDE.md`, so agents name their story and the kind of work it is, and write a proper report of finished work:

```markdown
## Agent Manager Delux
- When you start on a story or ticket, run
  `node "$HOME/.agent-manager/agentctl.js" story "<KEY-123: the story's title, or one line on the goal>" --type <kind of work>`,
  where the kind of work is one of: feature, bugfix, testing, refactor, infra, docs, level-design,
  game-design, writing, art, community, planning, other. Run it again with the new type when the work changes kind.
- When you finish a request that changed files: commit it (one commit, with a clear subject: it
  becomes the report's name), then report it:
  `node "$HOME/.agent-manager/agentctl.js" done "<2 to 5 short Markdown bullets: what you did>" --check "<what the person should see now>" --check "..."`
  Keep the checks few and concrete: where to look, and what they'll see there.
- To ask the person for feedback (a design pick, "does this look right?", a sound check), ask on
  the Feedback tab: one item per request, named in the title. Don't wait on it: build your default
  first and say what it is.
  `node "$HOME/.agent-manager/agentctl.js" feedback ask "<the item>" --body "<what's built; the default you go with>" --image <shot> --choice "<question>|<option>|<option>*"`
  When an answer arrives (posted into the session, or listed by `agentctl feedback list`), read it
  with `node "$HOME/.agent-manager/agentctl.js" feedback <id>`, then keep its status current as you
  work: `feedback status <id> planning`, then `implementing`, then
  `closed --note "<what you did, in their words>"`. If you have more questions, ask them with
  `feedback ask ... --follows <id>` instead.
- When you ship a release (a tag, a build, a store update), announce it on the Releases tab with
  its link, change notes and what the person should know about it:
  `node "$HOME/.agent-manager/agentctl.js" release "<version>" --url <where it is> --notes "<Markdown change notes>" --comment "<what to try first; what's rough>"`
- Keep everything short and plain. Never include secrets, file contents or command lines.
```

`agentctl done` refuses while there are uncommitted changes, so the report always links to the work (`--uncommitted` sends it anyway). `agentctl task "<text>"` pins the technical step until the next prompt, and `agentctl status "<text>"` sets the one-line activity.

To remove it: `node "$HOME/.agent-manager/agentctl.js" uninstall`.

### Asking the person for feedback

When you want the person's view (which of two designs, whether a level feels right, how a sound
lands), ask on the **Feedback** tab instead of by email or in chat. They answer there, or straight
from an email if they've subscribed, in a click or two, and the answer comes back to you.

```bash
node "$HOME/.agent-manager/agentctl.js" feedback ask "New Clunk: Beaverlogger" \
  --body "Built with ivory teeth (the default I keep if you don't answer). Not about: the walk cycle." \
  --image ivory.png --image gold.png --audio roar.mp3 \
  --choice "Which teeth?|Ivory|Gold*" --rating "How menacing is it?|Cuddly|Terrifying" \
  --question "Anything else?"
```

- **Questions**, in the order given: `--question` (free text), `--choice "<question>|<option>|<option>*"` (pick one; `*` marks the one you recommend, which starts picked), `--multi` (pick any), `--rating "<question>|<low end>|<high end>"` (1 to 5; add a fourth part, such as `|Didn't see it`, to let them say they couldn't judge it). With none, the person gets one free-text box. They can add a note under any question, and attach their own pictures, clips or sounds.
- **Files**: `--image` (PNG, JPEG, WebP, GIF up to 8 MB), `--video` (MP4, WebM), `--audio` (MP3, WAV, OGG, M4A), each up to 25 MB, as many as 12. `--caption "<file>=<text>"` puts a caption under one. `--screen` captures the screen on macOS and Linux. If a file doesn't attach, agentctl says so and exits with 7: fix it and ask again with `--supersedes <id>`.
- **Pictures as options** (an A/B pick) and anything more: write the form as JSON and pass `--form form.json`. It's a list of questions, each `{"type": "text" | "choice" | "rating", "prompt", "options": [{"label", "detail", "media": "gold.png"}], "recommended": "<an option's label>", "multiple", "max" (2 to 10), "low", "high", "notApplicable": "Didn't see it", "media": ["clip.mp4"]}`. Ids are optional (filled in as q1, q2… and 1, 2…). Anywhere a file goes, `{"file": "gold.png", "caption": "Gold teeth, from the front"}` adds a caption. Every file the form names is attached for you, relative to the form; if one isn't there, nothing is sent.
- **Groups**: `--group v0.20.0` tags the request (a release, say), so the person can filter by it. For a release with several items, ask once per item with the same group.
- **Follow-ups and replacements**: `--follows <id>` makes the request the next round of an earlier one (the earlier one shows "Follow-up questions"). `--supersedes <id>` replaces an earlier request, such as one about an older build: the old one is closed, so questions don't pile up.
- **Scripts**: `--json` on `feedback ask`, `feedback <id>`, `feedback list` and `feedback status` prints JSON (`ask` gives the id; `list` says whether each is answered and viewed).

Then, in this order:

1. **Don't wait.** Carry on with your default. When they answer, the answer is posted into the session if messages are on for this PC; otherwise `agentctl feedback list` shows what's answered.
2. **Read the answer** with `agentctl feedback <id>`. That tells the person you've seen it (the card shows "Agent viewed"). If they attached files, `--save <folder>` downloads them.
3. **Keep the status current** as you act on it, so the person can see where their feedback got to:
   - `agentctl feedback status <id> planning` when you start planning the change,
   - `agentctl feedback status <id> implementing` when you start building it,
   - `agentctl feedback status <id> closed --note "You wrote: '…'. Done in v0.18."` when it's done, in their words,
   - or ask a follow-up with `--follows <id>` if you have more questions.

If they close it without filling anything in (status "Dismissed"), they have no opinion: go ahead with your default, and close it the same way. They can also **reopen** a request to change their answer: you're told in the session, and it's back to "Waiting on you". Hold off acting on the earlier answer, and read the new one when it comes.

### Announcing a release

When you ship a release (a git tag, a GitHub release, a build on a store or a download page),
announce it on the **Releases** tab, so the person has every release of every game in one place:

```bash
node "$HOME/.agent-manager/agentctl.js" release "v0.20.0"   --url https://github.com/example/vanworld/releases/tag/v0.20.0 --title "The Winter Update"   --notes-file CHANGELOG-0.20.md   --comment "Try the frozen lake level first. Known rough: snow drops frames on low-end GPUs."   --link "Windows build=https://example.com/vanworld-0.20-win.zip"
```

- **`--url`** (required) is where the release is: its GitHub release, store page or download.
- **`--notes`** is the change notes in Markdown (up to 20,000 characters; `-` reads them from stdin), or **`--notes-file <file>`** reads them from a file. Write them for the person, not for a commit log: what's new, what's fixed.
- **`--comment`** is what you have to say about it: what to try first, what's known to be rough, what's next.
- **`--link "<label>=<url>"`** adds more links (downloads, store pages), up to 8. **`--title`** names the release.
- **`--game <name>`** says which game or app it is; it defaults to this session's project.
- **`--date <YYYY-MM-DD>`** is when it came out; it defaults to now. Give it when announcing an older release, so the list stays in release order.
- Sending the same game and version again **corrects** that release instead of adding another: only what you give changes, and `--url` isn't needed then. `agentctl release "v0.20.0" --notes-file CHANGELOG-0.20.md` fixes the notes; `--date 2025-03-14` fixes the date; an empty value clears one (`--comment ""`, `--link ""`).
- `agentctl release list [--game <name>]` lists the releases sent so far; `--json` on either prints JSON.

### Updates from Agent Manager Delux

Once this PC is set up, the person can update it from the site: **Auto-update all PCs** on the Instructions tab. At its next heartbeat (about a minute, while a session is open), agentctl downloads the new `agentctl.js` from the same site, checks that its SHA-256 matches what the site says it deployed and that it runs, keeps the old one as `agentctl.js.bak`, installs the new one and restarts its heartbeat. Nothing for you to do. To turn this off on a PC:

```bash
node "$HOME/.agent-manager/agentctl.js" install --no-auto-update
```

(`--auto-update` turns it on again.) `agentctl doctor` shows whether it's on and how the last update went.

### Messages from Agent Manager Delux

The person can send a message to a running session from its page in Agent Manager Delux. agentctl on the session's PC picks it up within about 5 seconds and posts it into the session. Answers to feedback requests arrive the same way. The setup above turns it on. It's set separately on each PC; on a PC set up without it, turn it on with:

```bash
node "$HOME/.agent-manager/agentctl.js" install --allow-messages
```

(`--no-messages` turns it off again, if the person doesn't want the site to be able to message this PC's sessions.) A session can take messages only after it has run a hook since messages were turned on, so the person should send it one prompt first. A session that skips permission prompts never takes messages.

If a message stays at "Waiting for the PC" for more than a few seconds, agentctl on that PC isn't collecting it. After 10 minutes it shows as "Expired", without saying why. Run `node "$HOME/.agent-manager/agentctl.js" doctor` **on the PC the session runs on**, and check:

- `Messages: off`: run the install command above, then send the session a prompt.
- `Messages: on; 0 of N open sessions can take one`: send that session a prompt so its hook saves its inbox, then send the message again.
- Messages are on and the session can take one, but nothing arrives: the PC may have an old `agentctl.js` (download it again as in step 2), or its background daemon may not be running. Look for `inbox:` lines in `~/.agent-manager/reporter.log`.

## OpenClaw

Each persona (for example the community manager for the website, and the one for the game) reports as its own agent. Use your own way of making HTTP calls (a skill, a tool or a script) and your scheduler for the heartbeat.

- **agentId**: `openclaw/<persona>`, for example `openclaw/community-web`. Keep it the same across restarts.
- **kind**: `openclaw`. **machine**: the host you run on. **name**: the persona's display name.
- **Every 2 minutes**, and whenever your state changes, send a report with `state` and a one-line `activity`. Set `"lostAfterSeconds": 300` so Agent Manager Delux shows you as Lost after 5 minutes of silence.
- **Every public action** (posted patch notes, answered a comment, ran a survey) is a report with `link` set to what you posted, and `activity` saying what you did.

See "Any other agent or service" for the exact calls.

## Any other agent or service

One call covers most agents: **report** your state. Every call is a `POST` with the header `X-Agent-Manager-Key: $AGENT_MANAGER_KEY` (not `Authorization`, which the host replaces) and a JSON body. Answers are JSON. A refused call returns 4xx with `{"error": "<one line saying what to fix>"}`. Add `"test": true` to any call to check it without storing anything.

### Report: `POST $MANAGER_URL/api/v1/report`

| Field | Required | Meaning |
| --- | --- | --- |
| `agentId` | yes | Stable id for you, unique across everything that reports (up to 200 characters). |
| `kind` | yes | `claude-code`, `openclaw`, `service` or `other`. |
| `machine` | yes | The PC or host you run on. |
| `name` | no | Display name. Defaults to `agentId`. |
| `project` | no | The project or product you work on. |
| `parentId` | no | The `agentId` of the agent that started you, if you are a sub-agent. |
| `state` | no | `working`, `waiting` (waiting on the person), `idle`, `stopped` or `failed`. Agent Manager Delux works out `lost` itself from silence. |
| `activity` | no | One line: what you're doing now (up to 500 characters). |
| `story` | no | The story or goal you're on: a ticket and its title (`AM-123: Export to CSV`), or a one-line summary (up to 300). |
| `task` | no | The technical step you're on now (up to 300). |
| `workType` | no | The kind of work, for the Reporting tab: `feature`, `bugfix`, `testing`, `refactor`, `infra`, `docs`, `level-design`, `game-design`, `writing`, `art`, `community`, `planning` or `other`. |
| `usage` | no | Tokens used since your last report that carried usage, one entry per model: `[{"model", "input", "output", "cacheWrite", "cacheWrite1h", "cacheRead"}]`. The counts don't overlap: `input` leaves out cache reads and writes. |
| `prompt` | no | The person's latest request to you (up to 2,000). Values that look like secrets are masked. |
| `turn` | no | `start` when a request starts, `end` when you've finished it. A request that fails (`state: failed`), stops, or goes silent before `end` shows as unfinished. |
| `result` | no | The report of finished work: `{"title", "summary" (Markdown), "checks": ["what the person should see"], "commitUrl", "commit", "branch", "pushed"}`. `title` and `summary` are required. |
| `link` | no | An http(s) link to something you made or posted. |
| `details` | no | Any other JSON you want shown. Unknown top-level fields are kept here too. |
| `lostAfterSeconds` | no | How long silence means Lost. Default 180. |
| `instructionsVersion` | no | The version at the top of this page, so the person can see who is out of date. |
| `at` | no | ISO 8601 time it happened. Defaults to when it arrived. |

Report when you start, when your state changes, and at least every couple of minutes while you run. Send `"state": "stopped"` when you finish.

curl:
```bash
curl -fsS -X POST "$MANAGER_URL/api/v1/report" \
  -H "X-Agent-Manager-Key: $AGENT_MANAGER_KEY" -H "Content-Type: application/json" \
  -d '{"agentId":"openclaw/community-web","kind":"openclaw","machine":"claw-host","name":"Community manager (web)","state":"working","activity":"Answering new comments","lostAfterSeconds":300,"instructionsVersion":5}'
```

PowerShell:
```powershell
$body = @{ agentId = 'gma/functions'; kind = 'service'; machine = 'azure'; name = 'Game Master Assistant'; state = 'working'; activity = 'Serving requests'; instructionsVersion = 5 } | ConvertTo-Json
Invoke-RestMethod -Method Post "$MANAGER_URL/api/v1/report" -Headers @{ "X-Agent-Manager-Key" = $env:AGENT_MANAGER_KEY } -ContentType 'application/json' -Body $body
```

Python:
```python
import json, os, urllib.request

def report(manager_url: str, **fields) -> dict:
    req = urllib.request.Request(
        f"{manager_url}/api/v1/report",
        data=json.dumps(fields).encode(),
        headers={"X-Agent-Manager-Key": os.environ['AGENT_MANAGER_KEY'], "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.load(res)

report("https://agents.example.net", agentId="openclaw/community-game", kind="openclaw", machine="claw-host",
       state="working", activity="Posted patch notes for 1.4", link="https://example.com/news/1-4", instructionsVersion=5)
```

The answer includes `agentUrl`, the agent's page in Agent Manager Delux, and `warnings` for anything that was adjusted (for example a field that was too long).

### Feedback: `POST $MANAGER_URL/api/v1/feedback`

Ask the person for feedback; they answer on the Feedback tab or from an email. The body: `agentId`, `title` (the item, up to 200), `body` (Markdown, up to 8,000), `questions` (up to 8, in the `--form` shape under "Asking the person for feedback" above), `captions` (`{"<file name>": "<caption>"}`), `group`, `follows` or `supersedes` (an earlier request's id), and `expectFiles` (how many files you'll attach next). The answer's `stored.id` is the request's id. Then:

- `POST /api/v1/feedback/media?id=<id>&name=<file name>` with the file as the body and its `Content-Type` attaches a picture, clip or sound. Questions and options refer to files by that name.
- `POST /api/v1/feedback/ready` with `{"id"}` once you've attached everything. Alerts and emails wait until the files you said you'd send are attached, or until this call, so the email has its pictures.
- `GET /api/v1/feedback/item?id=<id>` returns the request with `status` and `response` (`answers` by question id, `notes` by question id, and a `note`; a rating answered "didn't see it" is `"n/a"`), and `answerMedia`, the files the person attached (download each from `GET /api/v1/feedback/media?id=<id>&media=<media id>`). Reading an answered request marks it viewed.
- `GET /api/v1/feedback/inbox` lists your requests that aren't closed.
- `POST /api/v1/feedback/status` with `{"id", "status": "planning" | "implementing" | "closed" | "followup", "note"}` moves it on.

### Releases: `POST $MANAGER_URL/api/v1/releases`

Announce a release on the Releases tab. The body: `agentId`, `version` (up to 80), `url` (where the release is; http or https), and optionally `title`, `notes` (Markdown change notes, up to 20,000), `comment` (up to 4,000), `links` (up to 8 of `{"label", "url"}`), `project` (the game; defaults to the agent's project) and `releasedAt` (when it came out, ISO 8601 or a date like `2025-03-14`; defaults to now). Sending the same project and version again corrects that release: fields left out keep their values (so `url` is only required the first time), and `null` or `""` clears one. The answer's `updated` says which happened, and `releaseUrl` links to it. `GET /api/v1/releases[?game=<name>][&limit=<n>]` lists releases, newest release date first.

### Heartbeat for many agents: `POST $MANAGER_URL/api/v1/heartbeat`

If one process watches several agents of one kind on a machine, it can send `{"machine": "...", "kind": "...", "agentIds": ["...", "..."]}` every minute instead of a report per agent. Listed agents stay alive. Agents of that machine and kind that aren't listed are marked stopped. Ids Agent Manager Delux has never seen come back in `stored.unknown`, so you can send a full report for each.

## Performance data from games

A game or app you build can send its frame rate, frame times and memory from every machine it runs on, for the Game tab. That uses its own two calls and its own kind of key: follow `$MANAGER_URL/performance.md`. To read what games have sent, run `node "$HOME/.agent-manager/agentctl.js" perf` (one line a session) or `perf <sessionId>` (everything about one, as JSON).

## Check that it works

Send a test report. It is checked but not stored:

```bash
curl -fsS -X POST "$MANAGER_URL/api/v1/report" \
  -H "X-Agent-Manager-Key: $AGENT_MANAGER_KEY" -H "Content-Type: application/json" \
  -d '{"agentId":"setup-check","kind":"other","machine":"'"$(hostname)"'","test":true}'
```

A working setup answers `{"ok":true,"test":true,...}`. A 401 means the key is missing, wrong or revoked: ask the person for a new one from the Keys tab. Then send one real report and tell the person where to see it (the `agentUrl` in the answer).
