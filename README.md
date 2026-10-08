![pi-ask main image](docs/media/pi-ask-main.png)

# pi-ask-better

[![npm downloads](https://badgen.net/npm/dm/pi-ask-better)](https://www.npmjs.com/package/pi-ask-better)
[![last commit](https://badgen.net/github/last-commit/rinaldo-rex/pi-ask-better?v=41123fb)](https://github.com/rinaldo-rex/pi-ask-better/commits/main)
[![stars](https://badgen.net/github/stars/rinaldo-rex/pi-ask-better)](https://github.com/rinaldo-rex/pi-ask-better/stargazers)

> [!IMPORTANT]
> Contributions are welcome in chill mode: please open an issue and link your fork or branch instead of expecting rapid pull-request reviews.

`pi-ask-better` is a personal-preference fork of [`@eko24ive/pi-ask`](https://github.com/eko24ive/pi-ask), an ask tool that cares about your answers. Credit for the original extension belongs to its upstream authors.

It lets an agent pause, ask structured questions in a terminal UI, and continue with normalized answers instead of guessing.

![pi-ask demo](docs/media/pi-ask-demo.gif)

High-quality video: [demo.mp4](https://github.com/user-attachments/assets/a8503ca9-afcb-4c31-9edc-353b985a0209)

## What this fork changes

This fork adds these features on top of upstream `@eko24ive/pi-ask`:

- **Per-question layman explanations** — press `l` on a confusing question to
  flag it for a plain-language explanation with examples, without abandoning
  the rest of the batch. Only the flag is submitted; your saved choices for
  that question are not.
- **Immediate explanations** — press `Shift+L` to pause the entire form and
  get an explanation in chat above a dimmed summary. The agent then resumes
  the questionnaire via `resume_ask_user` (or `/ask:continue`) with answers,
  custom text, notes, and `l` flags intact.

- **Visual UI options** — press `h` to flag questions for HTML mockups at
  submission, or `Shift+H` to pause and request the current question's mockups
  immediately. The agent generates temporary HTML, opens it in your browser,
  and resumes the saved form. Small surfaces share a page; complex ones can
  use separate files for focused feedback.

The fork keeps upstream's interface, settings, notifications, and replay
features, with additional configurable request shortcuts.

## Contributions: chill mode

This open source project is something I care about, and it genuinely brings me joy to see it help people. That said, I cannot promise rapid reviews or a normal pull-request turnaround.

If you have an idea, bug report, or change, please open an issue. If you already have code, link to your fork or branch with the changes. I will review it carefully when I have time, then either incorporate the forked changes or implement the idea myself.

I value contributions and will do my best to credit the people who help, whether that means a shout-out, a co-authored commit, or another fitting form of attribution.

## Install

### Project-local install (recommended for testing)

Run from the project where you want to use the fork:

```bash
pi install --local git:github.com/rinaldo-rex/pi-ask-better
```

The declaration goes into `.pi/settings.json` and the checkout into `.pi/git/`. Nothing is installed globally. Grant project trust when prompted, then run `/reload` or restart pi.

To replace a globally installed upstream pi-ask **only in this project**, add this package override alongside the fork entry in `.pi/settings.json`:

```json
{
  "packages": [
    {
      "source": "npm:@eko24ive/pi-ask",
      "autoload": false,
      "extensions": ["-src/index.ts"],
      "skills": ["-skills/ask-user/SKILL.md"]
    },
    "git:github.com/rinaldo-rex/pi-ask-better"
  ]
}
```

Preserve any other existing settings and package entries. This disables the original extension and skill here without uninstalling them globally. To keep this setup private, exclude `.pi/` in your checkout's `.git/info/exclude`.

### npm

The equivalent project-local npm install is:

```bash
pi install --local npm:pi-ask-better
```

Choose one fork source (Git or npm), not both, to avoid duplicate tool registrations.

### Other scopes

To install the fork globally, omit `--local`:

```bash
pi install git:github.com/rinaldo-rex/pi-ask-better
```

Or try it once without persisting an installation:

```bash
pi -e git:github.com/rinaldo-rex/pi-ask-better
```

The fork retains upstream config paths and remote-event names for compatibility; those identifiers do not mean the upstream extension is loaded. Stable version tags publish the committed version through GitHub Actions with npm trusted publishing; the inherited semantic-release job remains disabled. See [release setup](docs/releases.md).

## Features

Once installed, this package gives the agent a native way to ask for clarification instead of guessing.

- 🧭 Familiar ask-style interface: tabbed questions, single/multi select, and preview mode
- ⭐ Optional warning-colored `(recommended)` markers that do not preselect answers
- 💡 Per-question layman explanation requests (`l`) without abandoning the batch
- ⏸️ Immediate explanations (`Shift+L`) in chat above a frozen form, followed by state-preserving resume
- 🖼️ UI variation requests (`h`) or immediate HTML mockups (`Shift+H`), generated and opened by the agent
- ✍️ Inline free-form `Type your own` answers
- 📎 Native pi-style `@` file references inside answer and note editors
- 📝 Question-level and option-level notes
- 👀 Review tab with `Submit`, `Elaborate`, and `Cancel`
- 💬 Elaboration flow to capture note-based clarification before final submission
- ⌨️ Context-aware customizable keymaps with aliases for main flow, editors, and settings
- ⚙️ Ask settings with persisted behaviour, notifications, keymaps, and `/answer` extraction config
- 🔔 Optional external notifications when an ask flow is waiting for input
- 🔁 Slash commands for fallback/replay:
  - `/answer` extracts questions from the latest assistant message into an ask flow
  - `/answer:again` reopens the latest `/answer` form on the current branch
  - `/ask:replay` replays the latest real `ask_user` form on the current branch
  - `/ask:continue` restores a deliberately paused questionnaire, including saved answers and notes
- 🛟 Automatic recovery of an unanswered `ask_user` form after startup, resume, or fork
- 🗣️ You can talk to your agent to configure pi-ask; it will read the bundled configuration guide and tailor the config for you

## Feature walkthrough

### Native `@` file references
Use pi-style `@` file path autocomplete inside free-form answers and note editors.

![Native pi-style @ file references inside the ask flow](docs/media/feature-at-file-mentions.png)

### Option and question notes
Attach clarification notes to a specific option (`n`) or add broader question-level context (`Shift+N`).

| Option notes | Question notes |
|---|---|
| ![Option note editor with note text for selected option](docs/media/feature-option-note.png) | ![Question-level note editor with saved note](docs/media/feature-question-note.png) |

### Review tab — Elaborate and Submit
Ask the agent to elaborate on notes before finalizing choices, or review all answers before returning them to the agent.

| Elaborate | Submit |
|---|---|
| ![Review tab with Elaborate action and expanded note preview](docs/media/feature-review-elaborate.png) | ![Review tab with Submit action highlighted](docs/media/feature-review-submit.png) |

### Single-select and multi-select questions
Pick one option when answers are mutually exclusive, or choose multiple options when several answers apply.

| Single-select | Multi-select |
|---|---|
| ![Single-select question with one selected option](docs/media/feature-single-select.png) | ![Multi-select question with multiple selected options](docs/media/feature-multi-select.png) |

### Preview mode
Use a dedicated preview pane when options need richer detail.

![Preview question showing a dedicated preview pane](docs/media/feature-preview-pane.png)

### Custom answer (`Type your own`)
Capture free-form input inline without leaving the flow.

![Inline custom answer input for Type your own option](docs/media/feature-custom-answer-input.png)

## Default key bindings

Open ask settings with `?` during the ask flow, or with the `/ask-settings` command from pi.

Keymaps are context-aware and configurable in `~/.pi/agent/extensions/eko24ive-pi-ask.json`.
Each action accepts a key string or an array of aliases.

Default contexts:

- `global`: `dismiss` (`Ctrl+C`) and `settings` (`?`)
- `main`: confirm/cancel/toggle, tab navigation, option navigation, and note shortcuts
- `editor`: custom answer submit/close and empty-editor navigation
- `noteEditor`: note save/close and empty-editor navigation
- `settingsModal`: close, next/previous setting, and toggle

Press `l` on a confusing question to request a plain-language explanation of its options with examples. Its choices dim and pause; other questions remain usable. Press `l` again to undo the request and restore your saved choices. `Enter` or `Tab` continues to the next question. On submission, only the explanation request—not saved choices for that question—is sent alongside answers to other questions. The agent is instructed to explain and re-ask only the flagged questions. Auto-submit respects your setting and counts a flagged question as a response; existing notes still prevent auto-submit. Customize the shortcut with `keymaps.main.requestLaymanExplanation`.

Press `Shift+L` when you need an explanation **before continuing**. The entire form is saved and paused—not submitted or cancelled—and a dimmed summary stays visible while the main agent explains above it. The agent then calls `resume_ask_user` to return to the active question with your answers, custom text, all notes, question types, and other `l` flags intact. It may simplify the current or unanswered questions, but cannot silently replace other answered questions or discard selected/noted option values. `/ask:continue` is a manual fallback if the agent does not resume. Customize or disable this shortcut with `keymaps.main.requestImmediateLaymanExplanation` (`["shift+l"]` or `[]`). Both explanation shortcuts are ordinary text in editors and have no effect on Review.

Press `h` to flag the active question for visual UI mockups without submitting immediately; press it again to undo. On submission, the agent receives the flagged options and notes, not your saved choices, and is instructed to generate temporary HTML and open it in your default browser. Small/simple surfaces can share a page; complex surfaces can use separate files.

Press `Shift+H` to pause the whole form and request mockups for the current question immediately, then resume through `resume_ask_user` or `/ask:continue`. Only the served mockup flag is cleared; deferred `l` requests remain saved. The agent renders the existing options only, without extra designs. These shortcuts are configurable as `keymaps.main.requestUiVariations` and `keymaps.main.requestImmediateUiVariations`; use `[]` to disable. Both remain ordinary text in editors and have no effect on Review. HTML generation and browser opening depend on the agent's available tools, not a built-in HTML renderer.

Fixed bindings:

| Key | Context | Effect |
|---|---|---|
| `1..9` | Options list | Select or toggle matching option |
| `1` `2` `3` | Review tab | Trigger `Submit` / `Elaborate` / `Cancel` |
| `@` | Editors | File-reference affordance |
| Arrow keys / `Tab` | Non-empty editor | Stay in editor for cursor movement |

Review-tab shortcuts can optionally require the same number key twice via `behaviour.doublePressReviewShortcuts`. `behaviour.presentSingleAsMulti` can render future single-select questions as multi-select while preserving the requested type in results; use `main.changeQuestionType` (`t` by default) to change the active question type live.

You can edit the config file yourself, ask pi to edit it for you, or use `/ask-settings` to find the exact config path, toggle behaviour/notification settings, or reset config to defaults with a guarded double press. pi-ask treats the config file as user-owned: load-time migrations and invalid files are handled in memory without rewriting or backing up the file, and read-only/externally managed configs fail gracefully with a manual-edit message.

`/answer` keeps extraction within the current session model scope. Check a configured model before use with `pi auth check --provider <provider> --model <id>`.

```json
{
  "schemaVersion": 6,
  "answer": {
    "extractionModels": [
      { "provider": "openai-codex", "id": "gpt-5.4-mini" },
      { "provider": "github-copilot", "id": "gpt-5.4-mini" },
      { "provider": "anthropic", "id": "claude-haiku-4-5" }
    ],
    "extractionTimeoutMs": 30000,
    "extractionRetries": 1
  },
  "behaviour": {
    "autoSubmitWhenAnsweredWithoutNotes": false,
    "confirmDismissWhenDirty": true,
    "doublePressReviewShortcuts": true,
    "presentSingleAsMulti": false,
    "showFooterHints": true
  },
  "keymaps": {
    "global": { "dismiss": ["ctrl+c"], "settings": ["?"] },
    "main": {
      "confirm": ["enter"],
      "cancel": ["esc"],
      "toggle": ["space"],
      "changeQuestionType": ["t"],
      "requestLaymanExplanation": ["l"],
      "requestImmediateLaymanExplanation": ["shift+l"],
      "requestUiVariations": ["h"],
      "requestImmediateUiVariations": ["shift+h"],
      "nextTab": ["tab", "right"],
      "previousTab": ["shift+tab", "left"],
      "nextOption": ["down"],
      "previousOption": ["up"],
      "optionNote": ["n"],
      "questionNote": ["shift+n"]
    },
    "editor": {
      "submit": ["enter"],
      "close": ["esc"],
      "nextTabWhenEmpty": ["tab", "right"],
      "previousTabWhenEmpty": ["shift+tab", "left"],
      "nextOptionWhenEmpty": ["down"],
      "previousOptionWhenEmpty": ["up"]
    },
    "noteEditor": {
      "save": ["enter"],
      "close": ["esc"],
      "nextTabWhenEmpty": ["tab", "right"],
      "previousTabWhenEmpty": ["shift+tab", "left"],
      "nextOptionWhenEmpty": ["down"],
      "previousOptionWhenEmpty": ["up"]
    },
    "settingsModal": {
      "close": ["esc", "ctrl+c", "?"],
      "nextOption": ["down"],
      "previousOption": ["up"],
      "toggle": ["enter", "space"]
    }
  },
  "notifications": {
    "enabled": true,
    "channels": ["bell"]
  }
}
```

Accepted notation follows pi-tui key ids. Common aliases are normalized, for example `escape` → `esc`, `return` → `enter`, `control+c` → `ctrl+c`, and `Shift+N` → `shift+n`.

## Use

After installation, the extension registers `ask_user` and `resume_ask_user` tools plus `/ask-settings`, `/answer`, `/answer:again`, `/ask:replay`, and `/ask:continue` commands.

Agents can auto-discover and call `ask_user` when they need clarification instead of guessing. They can mark any number of grounded preferences with `recommended: true` and use option descriptions for reasons. In interactive sessions, it opens a terminal UI flow for structured answers, supports native pi-style `@` file references while typing answers or notes, and returns normalized answers back to the agent. Ask settings are available both from `?` in the ask flow and from the `/ask-settings` command. Behaviour and notification settings are binary `on`/`off` toggles that save immediately when the config file is writable; save failures revert the toggle and show a manual-edit message. The settings overlay includes a guarded double-press reset-to-defaults action; keymaps, notification channels, and extraction settings are changed by editing the shown config file path.

### Answer and replay commands

`/answer` is useful when the agent asked questions in plain text instead of using `ask_user`. It extracts questions from the latest completed assistant message and opens the same ask UI.

Replay commands are branch-aware. They read persisted entries from the current pi session branch, so they work naturally with `/resume`, `/tree`, and conversation branching:

- `/answer:again` reopens the latest form created by `/answer` on this branch
- `/ask:replay` reopens the latest real `ask_user` form on this branch

Cancellation is local to the UI: closing a replayed form does not start a new agent turn. Submitted answers are sent back as a normal user follow-up message.

### Interrupted ask forms

If Pi stops while an `ask_user` form is open, the tool call remains without a result. Starting, resuming, or forking that session reopens the newest unanswered form once. Submitting sends the result as a user message because the original tool execution no longer exists. Cancelling dismisses the automatic recovery. Either outcome prevents another automatic reopen, while `/ask:replay` remains available.

New sessions and extension reloads do not trigger interrupted-tool recovery. Intentionally paused forms instead restore their passive summary from the current branch, without opening a questionnaire or triggering an agent turn. Use `resume_ask_user` or `/ask:continue` to continue; replay starts a fresh form and is refused while a saved pause is pending.

Kudos to [@k0valik](https://github.com/k0valik) for the `/answer` idea.

You can also talk to pi to configure this extension. When asked to customize pi-ask settings, keymaps, notifications, or extraction behavior, the agent is instructed to read the bundled `docs/configuration.md` guide first and then edit the config file accordingly.

This package also bundles the `ask-user` skill profile from `skills/ask-user/SKILL.md`. It reinforces when to use the tool, is enabled by default when installed, and can be disabled via `pi config`. The skill was inspired by https://github.com/edlsh/pi-ask-user.

You can still add your own agent instruction if you want to further reinforce usage.

For exact input/output and UX guarantees, see [`docs/contract.md`](docs/contract.md).

## Local development

### Run locally in pi

```bash
pi -e ./src/index.ts
```

### Run in isolated test mode (extension + bundled skill only)

```bash
pnpm dev
pnpm dev ../test
```

`pnpm dev [path]` runs pi with `--no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files`, loads this repo’s extension and `skills/ask-user`, and starts pi from `[path]` by changing directories before launch (defaults to `.`).

### Install dependencies

```bash
pnpm install
```

### Install git hooks (contributors)

`lefthook` is not installed automatically. If you want the local commit hooks used by this repo, run:

```bash
pnpm exec lefthook install
```

### Development commands

```bash
pnpm format
pnpm lint
pnpm check
pnpm typecheck
pnpm test
```

### Commit workflow

This repo uses `lefthook`, Commitizen, conventional commitlint, and semantic-release.

If you want local hooks, install them once after `pnpm install`:

```bash
pnpm exec lefthook install
```

Recommended flow:

```bash
pnpm commit
```

## Project layout

- `src/` — TypeScript extension implementation
- `tests/` — behavior-focused tests
- `docs/` — small docs set for contract and architecture
- `docs/media/` — repository-only README media assets

## Documentation

Docs stay intentionally small:

- `docs/README.md` — index
- `docs/contract.md` — external behavior
- `docs/architecture.md` — module boundaries and invariants
- `docs/releases.md` — version-tag publishing and npm trust setup
