# Critic: worfy-harness-standalone — 2026-11-09

Plan: `docs/product/roadmap-worfy/drafts/worfy-harness-standalone.md`
Verdict: Reorder — the eleven tickets are the right ones, but the CI job that the spec calls its main test seam comes last, the `/worfy:to-tickets` fix that story 11 and the acceptance depend on has no ticket and no `Blocked by:` edge, and ticket 01 carries a version change that the GitHub channel does not need.

## Objections

### 1. Ticket 01 writes a version into the plugin source, but a plugin from a Git-hosted marketplace without a version already gets the commit SHA and tracks every commit

Fact: The spec, `docs/product/roadmap-worfy/drafts/worfy-harness-standalone.md:97`, says "Сейчас её пишет сборка приложения, а каналу GitHub версия нужна в самом plugin-е". The Claude Code docs (https://code.claude.com/docs/en/plugins/loading, "How Claude Code computes the version") say that for a "Relative path inside a Git-hosted marketplace" with no `version` field the version is "The commit SHA of the installed directory". They also say that a pinned version "keeps every user on the cached copy until its author changes the string", and "To let users track commits instead, leave `version` out of both the manifest and the entry". The repository has no git tags (`git tag` prints nothing). `package.json:3` semver has changed twice since 2026-10-05, the last time in `e8784a2f5` on 2026-10-15.

Judgement: If the source pins a version, users of the GitHub channel stay on one copy for weeks: the semver moves about twice a month and there is no release step that would bump it. Story 2 ("обновлять одной командой") then fails in practice. The spec also makes the app installer accept a version it did not build (`:98`). That changes the version rules in `docs/features/harness.md:94-99` for no gain. Leave `version` out of `harness/.claude-plugin/plugin.json`, as it is today. Let the SHA be the visible version of the GitHub channel. Ticket 01 then shrinks to the ADR and the root manifest. Ticket 02 already covers the case where the app finds a version that is not its build version.

Owner decision: accepted — по всему да

### 2. Story 11 and the acceptance need the `/worfy:to-tickets` "Done when" fix, and that fix has no ticket yet and no `Blocked by:` edge in this epic

Fact: The spec puts the fix outside the epic (`:49` "чинит отдельный Ticket `worfy-polish` до Epic-а"; `:189` "идёт до этого Epic-а (Q14)"). Yet its "Готово, когда" list keeps the line "Ticket-ы от `/worfy:to-tickets` проходят `ticket evidence`" (`:179`), and no row of the ticket table (`:140-152`) owns that line. The highest ticket in `.scratch/worfy-polish/issues/` is `74-electron-из-actions-cache.md`, and none of them is about the template. The local ticket template of `harness/skills/to-tickets/SKILL.md:69-82` still has only "Acceptance criterion" checkboxes and no `## Done when` section. `harness/bin/TICKETS.md:62` says the evidence section defaults to `## Done when`.

Judgement: The acceptance (ticket 11) is one owner Wave run on a fresh project, and it will fail at `ticket evidence` unless the fix lands first. Nothing in the plan makes that ordering hold: the fix has no ticket, so ticket 11 cannot name it in `Blocked by:`. Create the `worfy-polish` ticket now and put it in ticket 11's `Blocked by:`. Ticket 06 (the Waves table in `/worfy:to-spec`) is the twin fix in the planning skills, and the research note counted the two as one gap (`research-harness-без-приложения.md`, section 9, row 7). So 06 can move into that same polish ticket, which leaves the epic at ten tickets.

Owner decision: accepted — по всему да

### 3. The CI job that the spec names as its main seam comes in Wave 3, after the nine tickets it is meant to guard, although it can start against today's Harness

Fact: The spec calls the CI job "Главный seam … Один seam покрывает почти весь Epic" (`:120-122`) and also says "Ядро при этом уже работает без приложения: hooks, gate, скрипты Harness и Profile к приложению не обращаются" (`:25`). Yet the Waves table puts ticket 10 alone in Wave 3 (`:160`). The open risk "нужны ли команде `claude plugin` вход и сеть на runner-е, проверяет Ticket 10" (`:170`) is therefore answered last. The parts the job chains together already have shell tests: `harness/bin/tests/project-connect.test.sh`, `epic-status.test.sh` and the `harness/hooks/tests/gate-*.test.sh` files. They run "with `HOME` in an empty temporary folder" in CI on Linux (`harness/README.md:87-91`) and in the `windows (harness-scripts 1/2, 2/2)` jobs (`.github/workflows/ci.yml:472-473`).

Judgement: With the job last, Waves 1 and 2 change the installer, `connect-project`, the status line and `epic-wave` with no end-to-end check of the no-app path. The one unknown that could change ticket 10's shape is whether the runner needs a Claude login, and it surfaces only after everything else is merged. Put a first cut of the job in Wave 1. It installs the plugin from the repository folder into a temporary Claude Code folder, then runs `project-connect`, `gate fast` and `epic-status`, all of which work today. Later tickets add their own step to it: the machine check from 03, qmd from 04. Most of its pieces come from the existing shell tests, so the first cut is small.

Owner decision: accepted — по всему да

## Alternative

The same tickets, with these changes:

- **Before the epic:** one `worfy-polish` ticket fixes both planning skills: the `## Done when` section in `/worfy:to-tickets` and the Waves table in `/worfy:to-spec`. This replaces ticket 06.
- **Wave 1:** 01 (the ADR and the root manifest, no version in the source), 10a (the first cut of the CI job on three OSes against today's Harness), 05, 07 and 08.
- **Wave 2:** 02, 03 and 04. Each adds its step to the CI job.
- **Wave 3:** 09 (the instructions). It comes after 03 and 04 because it describes their commands.
- **Wave 4:** 11 (the acceptance). Its `Blocked by:` names the polish ticket.

The draft's order is shorter on paper. It saves one CI change per ticket and keeps 06 inside the epic, so the epic owns everything it ships. That is worth it only if the polish fix is certain to land first, and today nothing records that it will.

## What the critic cannot know

- No install was run. The critic did not check whether a root `marketplace.json` with a relative `./harness` source installs from GitHub, or whether `claude plugin` needs a login on a CI runner. Both points rest on the Claude Code docs only, as the research note's own "Что не проверено" section also says.
- There is no product analytics. How many people would install the Harness without the app, and on which OS, is not known.
- A `worfy-polish` ticket for the template may exist in a worktree or branch that is not on `main`. The critic searched `main`, the main checkout and the PR titles on GitHub only.
