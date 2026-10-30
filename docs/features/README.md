# worfy feature documentation

Permanent documentation of worfy as it is today: how each Feature behaves, the principles it works by and how
it is implemented. A Feature is a capability of the product that a developer uses, such as Canvas, Terminal or
Autopilot. A Feature outlives any Epic and several Epics change it, so these pages are organised by Feature and
not by Epic or Ticket.

The pages are for developers who use worfy and for developers who change it, on equal terms. The reader is
assumed to be a developer: there is no separate text for anyone else.

Russian translation: [docs/features/ru/README.md](ru/README.md). New to the terms: start with
[Concepts](concepts.md). Plans are not here: they are in the [roadmap](../roadmap.md). Reasons and history stay in
the [ADRs](../adr/) and in Tickets, and a page links to them.

## Pages

| Page | Sections |
|---|---|
| [Autopilot](autopilot.md) | Autopilot |
| [Terminal](terminal.md) | Terminal, Terminal AI |
| [Cards](cards.md) | Card as a file, Card API, Canvas MCP |
| [Canvas](canvas.md) | Node and Layout, Find, inserting images |
| [Epic frames](epic-frames.md) | Epic frame, Done shelf |
| [Focus mode](focus-mode.md) | Focus mode |
| [Projects](projects.md) | Full mode and Silent mode, the switch between them, viewing ADRs and HANDOFF |
| [Workflow](workflow.md) | Ticket and Epic on the Canvas, Pipeline, Binding |
| [Sessions](sessions.md) | Session, Subagent |
| [Transcripts and usage](transcripts-and-usage.md) | Transcript, Claude home, Memory, Limits |
| [Gate and GitHub](gate-and-github.md) | Gate, Gate full, PR and CI badges |
| [Browser](browser.md) | Browser, Browser profile |
| [Link](link.md) | Machine, Linked machine |
| [App shell](app-shell.md) | Command palette, shortcuts, menu, Settings, theme |
| [Notifications](notifications.md) | Notifications |
| [Onboarding](onboarding.md) | First run, Getting started, Demo project |
| [Storage and diagnostics](storage-and-diagnostics.md) | data folder, diagnostics |
| [Harness](harness.md) | installing from the app, plugin, skills, agents, hooks |

A page that is not written yet holds its heading and one line that says so. A pull request (PR) that writes a page
replaces that line and does not edit this index.

## Section template

One page covers one Feature or several close ones, and each Feature gets a section. A section has three blocks, in
order from the user to the code, so that one section answers both readers:

- **Behaviour**: what the developer sees and does, the states, the limits. No file paths.
- **How it works**: the principles and the model. "Why it is so" takes one or two sentences and a link to an ADR.
- **Implementation**: modules and entry points with their paths, the data flow, the main tests. No line numbers and
  no copied signatures: they go out of date first.

Platform differences and work on a Linked machine go under a subheading inside the block they concern (`On a Linked
machine`). Windows has no page of its own, and Linux is not described: it has no package. A Feature with many states
may use subheadings and tables inside Behaviour. Concrete numbers stay on a page.

A page describes only the present: no changelog and no retelling of ADRs. Code and tests are the source of a page,
and a claim they do not confirm stays off it. A difference between a page and the code is a bug to fix. There are
no screenshots: they go out of date and nothing checks them. A page longer than about 400 lines is split in two.

## Form of paths

The path check of `pnpm lint` (added by Ticket 02 of Epic `worfy-feature-docs`) reads this form on the English
pages `docs/features/*.md` and fails only when a path does not exist. Two things count as a path:

- inline code without spaces that starts with `src/`, `test/`, `scripts/`, `harness/`, `docs/`, `build/` or
  `.github/`, read from the repository root;
- a relative Markdown link to a file of the repository, read from the folder of the page. External addresses do
  not count, and the part after `#` is not part of the path.

Code inside fenced blocks is not read. A token with `<`, `>`, `*` or `{` is a template and is skipped. The check
does not read the Russian files: a translation may lag, and a lagging translation must not break lint after a
rename.

## Translation

The English version is the only source ([ADR-0088](../adr/0088-feature-pages-in-english.md)). A PR that changes the
behaviour of a Feature edits only the English page. Terms and UI names stay in English in both languages.

The Russian version is in `docs/features/ru/` and may lag behind. The first line under its heading says so, and it
is visible when the page is read on GitHub:

```markdown
> Перевод [английской версии](../autopilot.md), commit `1a2b3c4d`.
```

The commit is the last commit that changed the English file the translation was made from. The first version of a
page merges its English and Russian files in one PR. Merges in this repository are squashed, so the SHA of that
commit is not known in advance, and the line carries the word `same-pr`:

```markdown
> Перевод [английской версии](../autopilot.md), commit `same-pr`.
```

`same-pr` means that the translation matches the English version at the commit that last changed the Russian file.
The lag of such a page is counted from that commit. Any separate edit of a translation, a batch update included,
replaces `same-pr` with a real SHA: by then the English file is in `main` and its commit is known. Otherwise the new
edit would move the starting point of the count and hide the lag.

A report script (Ticket 02 of Epic `worfy-feature-docs`) prints the pages whose English version has moved past the
commit in this line. An agent updates such translations in a batch. A page that is not written yet has no such line
in either language.
