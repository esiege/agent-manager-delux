# Agent Manager Delux: update to the latest

Updated: **2026-11-17** · Instructions version: **8**

You are an AI agent on a PC that already reports to Agent Manager Delux, and the person wants this PC on the latest version. This page tells you how. It takes a minute and changes nothing else on the PC. (Setting up a new PC? Use `$MANAGER_URL/instructions.md` instead.)

## If this was sent to you: check for an update first

Run:

```bash
node "$HOME/.agent-manager/agentctl.js" version
```

- It prints `agentctl, instructions version 8 (2026-11-17)` or a later version or date: this PC is up to date. Only check step 5 below (the `CLAUDE.md` section), then tell the person "Already up to date" and stop.
- It prints an older version, a version without a date, or nothing (the file is missing): follow the steps below. If the file is missing, this PC was never set up: follow `$MANAGER_URL/instructions.md` instead.

- **`$MANAGER_URL`** below means the address you fetched this page from, without `/update.md` (for example `https://agents.example.net`).
- If a tool gave you a summary of this page, fetch the raw file (`curl -fsSL $MANAGER_URL/update.md`) so you have the exact commands.
- **The machine key is a secret.** It is never on this page and the update doesn't need it on the command line: `install` reuses the saved one. Don't print it, log it or write it anywhere.

## What's new in version 8

- **Release dates and corrections**: `agentctl release` takes `--date <YYYY-MM-DD>`, when the release came out, so you can announce older releases with their real dates (it defaults to now). Sending a version again now corrects just what you give: `agentctl release "v0.20.0" --notes-file CHANGELOG-0.20.md` or `--date 2025-03-14` fixes those and keeps the rest, without `--url`. An empty value clears one (`--comment ""`).
- **Release screenshots**: `--screenshot <file>` (up to 6) puts pictures of the release on its card.

## In version 7

- **Releases**: announce what you ship on the new **Releases** tab with `agentctl release "<version>" --url <link> --notes "<change notes>" --comment "<your comments>"`. See "Announcing a release" in `$MANAGER_URL/instructions.md`. The `CLAUDE.md` section in step 5 has a new line for it.

## In version 6

- **Updates from the site**: after this update, the person can update every PC at once with **Auto-update all PCs** on the Instructions tab, without sending each one this page. agentctl downloads the new version itself, checks its SHA-256 and that it runs, installs it and restarts its heartbeat. `agentctl install --no-auto-update` turns it off on a PC; `agentctl doctor` shows it.
- **Game crashes and errors**: games can report crashes and logged errors (see `$MANAGER_URL/performance.md`), and `agentctl perf` shows each session's error count and status.

## In version 5

- **Feedback from email**: the person can subscribe to feedback emails and answer from them, so answers may now come "by email". Nothing changes for you.
- **More in a feedback request**: captions on files (`--caption "<file>=<text>"`, or `{"file", "caption"}` in a form), a "didn't see it" answer on ratings, `--group <tag>` to group requests (a release), `--supersedes <id>` to replace an older request, and `--json` output for scripts.
- **Answers can carry more**: a note under any question, and the person's own pictures, clips or sounds (`agentctl feedback <id> --save <folder>` downloads them).
- **No silent gaps**: a `--form` that names a missing file stops before anything is sent, and a file that fails to upload makes agentctl exit with 7.

## In version 4

- **Feedback** replaces Blockers. Agents ask the person for feedback with `agentctl feedback ask`: a title, a Markdown body, pictures, clips and **sounds**, and questions (free text, a choice with a recommended option, a pick-any, a 1-to-5 rating). The person answers on the Feedback tab.
- Agents then report what they do with each answer, so the person can follow it: **viewed** (on its own when the agent reads it), **planning**, **implementing**, and **closed** or a **follow-up** request. See "Asking the person for feedback" in `$MANAGER_URL/instructions.md`.
- `agentctl blocker` still works: it's the old name for `agentctl feedback ask`.

## In version 3

- Each request and sub-agent reports the **tokens** it used, per model, so the Reporting tab can show what the work would cost on the API. Only the counts leave the PC.
- Agents can say what **kind of work** they're doing (`agentctl story "..." --type level-design`), so the Reporting tab can split time and tokens into technical and non-technical work.

## In version 2

- Each session reports its **story** (the ticket in the branch name with the session's title), its **task** (what it's doing now) and the person's latest **prompt**.
- When a request ends with a new commit, the session reports the **finished work**: the commit's subject and link, the prompt, a summary, and what the person should see now. Agents can write a better one with `agentctl done`.
- Requests that never finish (an API error, a closed session, a lost connection) show as **unfinished**.

## Claude Code

1. Check this PC is set up: `node "$HOME/.agent-manager/agentctl.js" doctor` should show a config and `Hooks: installed`. If the file isn't there, stop and follow `$MANAGER_URL/instructions.md` instead.
2. Download the latest agentctl over the old one.

   PowerShell:
   ```powershell
   Invoke-WebRequest "$MANAGER_URL/agentctl.js" -OutFile "$HOME\.agent-manager\agentctl.js" -UseBasicParsing
   ```
   bash or zsh:
   ```bash
   curl -fsSL "$MANAGER_URL/agentctl.js" -o "$HOME/.agent-manager/agentctl.js"
   ```
3. Install it again. This keeps the saved URL, key and machine name, refreshes the hooks in `~/.claude/settings.json` (after backing it up), turns on messages from Agent Manager Delux, and restarts the heartbeat on the new version. (If the person turned messages off on purpose, leave out `--allow-messages`.)
   ```bash
   node "$HOME/.agent-manager/agentctl.js" install --allow-messages
   ```
4. Check:
   - `node "$HOME/.agent-manager/agentctl.js" version` says `instructions version 8`.
   - `node "$HOME/.agent-manager/agentctl.js" doctor` shows `Updates: on`.
   - `node "$HOME/.agent-manager/agentctl.js" doctor` shows `Hooks: installed`, `Messages: on` and `Connection: OK`.
5. Update the `## Agent Manager Delux` section (older installs call it `## Agent Manager`) of the user's `~/.claude/CLAUDE.md` (and of the project's `CLAUDE.md`, if it has one) to the text below. Replace the old section rather than adding a second one; add it if there is none. Leave the rest of the file alone.

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
6. Tell the person it's done. Sessions that are already open pick up the new version at their next step; there's nothing to restart. On the Agents tab, this PC's sessions lose their "old version" badge once they report again.

### If you can't finish the update yourself

Claude Code in auto mode won't let an agent change Claude Code's own settings, so step 3 may be blocked. That's expected: don't try to work around it. Do step 2 if you're allowed to, then give the person these commands to run in their own PowerShell window (a VS Code terminal works), filled in and as one code block:

```powershell
Invoke-WebRequest "<$MANAGER_URL>/agentctl.js" -OutFile "$HOME\.agent-manager\agentctl.js" -UseBasicParsing
node "$HOME\.agent-manager\agentctl.js" install --allow-messages
node "$HOME\.agent-manager\agentctl.js" doctor
```

Then do step 5 yourself if you can, or show the person the new section to paste.

## Any other agent or service

Nothing to install. Version 8 adds `releasedAt` and screenshots (`POST /api/v1/releases/screenshot`) to releases, and lets a resend correct only the fields it gives. Version 7 adds releases: see "Releases" under "Any other agent or service" in `$MANAGER_URL/instructions.md`. Version 6 only changes agentctl. Version 5 adds captions, groups, replacements and "n/a" ratings to feedback requests, and `POST /api/v1/feedback/ready`. Version 4 adds feedback requests: see "Feedback" under "Any other agent or service" in `$MANAGER_URL/instructions.md`. Version 3 adds two optional report fields: `workType` (the kind of work you're doing) and `usage` (the tokens you used, if you know them). Version 2 added `story`, `task`, `prompt`, `turn` (`start` and `end` of a request) and `result` (the report of finished work). See "Report" in `$MANAGER_URL/instructions.md` for what each one means, start sending the ones that fit, and send `"instructionsVersion": 8` with your reports.
