# Harness

Two Features. **Installing from the app** puts the Harness on a Machine. The **Plugin** is what gets installed: scripts,
a Profile for each Project and the search over documents. The parts of the plugin that act have their own page, [Skills,
agents and hooks](skills-agents-and-hooks.md). Terms are explained in [Concepts](concepts.md). The Gate has [its own
page](gate-and-github.md).

## Installing from the app

### Behaviour

Each build of worfy carries a copy of the Harness and installs it as the Claude Code plugin `worfy`, in the user scope.
The Harness home is the folder of the Harness on a Machine, by default `worfy-harness` inside the Claude home, and the
copy goes into its folder `plugin`. Three places offer the install: the Harness item of the toolbar, the [First
run](onboarding.md) checks, and Settings → Pipeline when the Harness has no script for the Pipeline editor. All three
use one installer. A second request during an install gets the same run, and an install that may have changed something
reaches every window.

**The toolbar item.** It is the last item of the toolbar. Its second line holds the app version and worfy's own memory
([Storage and diagnostics](storage-and-diagnostics.md)). The version is `v<major>.<minor>.<N>` with the build number
([Settings → General → Version](app-shell.md#settings)), and its tooltip is the build version with the commit; a build
without a number shows the build version `v<semver>+<short SHA>` with no tooltip. In the Stable copy the version is the
version chip of [Update](updates.md), whose tooltip names the Update while one waits.

| State | Text | Icon button | When |
|---|---|---|---|
| Not installed | `Harness not installed` | Install | The plugin folder is missing, or Claude Code does not list the plugin |
| Installed | `Harness <version>` | None | The copy and the plugin Claude Code lists carry this build's version |
| Disabled | `Harness <version> · disabled` | None | The same, and the plugin is disabled in Claude Code |
| Outdated | `Harness <from>` | Update Harness, with the accent and a dot | Another version is installed. The tooltip says `<from> → <to>` |
| Same version | `Harness <from>` | Replace Harness | The same semver from another commit, see below. When GitHub says it is behind, the row is Outdated |
| Error | `Harness error: <step>` | Retry | A step failed, Claude Code reports the plugin broken, or a dependency is missing. The tooltip holds the reason |
| Installing | `Installing Harness…` | None | During an install started from this item |
| No answer | `Harness unavailable` | None | The call to the main process failed. The tooltip holds the reason |

A run that may not install shows the state without a button, and the two outdated lines then name both versions:
`Harness <from> → <to>` and `Harness <from>, this build <to>`. Only a packaged app or a run with `WORFY_CLAUDE_HOME` may
install, because a development build on the real Claude home would replace the Harness that the terminal and the Stable
copy work on.

**What an install does.** It reads first, then asks, then writes. With nothing to do there is no dialog. Otherwise a
native dialog names every command before anything runs, in the order they run:

1. For each missing plugin dependency: `claude plugin marketplace add anthropics/claude-plugins-official` when Claude
   Code does not know that marketplace, then `claude plugin install <name>@claude-plugins-official --scope user`. The
   plugin needs `mattpocock-skills@claude-plugins-official`, and Claude Code downloads it from GitHub. worfy installs
   dependencies from that marketplace alone: a missing one from another marketplace is an error that asks the user to
   install it.
2. The copy of this build goes into the plugin folder and replaces what is there. This step is skipped when the folder
   already holds this build's version.
3. On a first install: `claude plugin marketplace add <plugin folder>`, then `claude plugin install worfy@worfy-harness
   --scope user`. With another version: `claude plugin update worfy@worfy-harness --scope user`.

The button says Install, Update or Replace, and Cancel writes nothing. A dialog that copies also warns that Claude Code
sessions already running in a terminal see the files change under them and need a restart. While an old Harness is in
`~/.claude`, the dialog warns that terminal sessions run its hooks and the plugin's both. A command gets 120 s, and a
command that installs a dependency 600 s.

**How a failed install ends.** As Claude Code lists it, the plugin ends installed or not installed, never half way:

| What failed | What stays | Error step |
|---|---|---|
| A command for a dependency | The Harness copy untouched, and no command for `worfy` ran | `dependency marketplace add`, `dependency install` |
| The copy | The previous plugin folder as it was | `copy` |
| `marketplace add` of the copy | Claude Code does not list `worfy` | `marketplace add` |
| A first `plugin install` | worfy reads the list again and removes a record the command left | `install` |
| Removing that record | The reason names both failures | `uninstall` |
| `plugin update` | Nothing is uninstalled, and the folder already holds the new copy | `update` |
| Reading the list, or no Claude Code binary | Nothing was written | `plugin list` |

An answer that the official marketplace is already added is not a failure, whatever its exit code. Retry reads the state
again and runs what is left, a missing dependency included. The plugin installed without its dependency is also an
error, because Claude Code then loads nothing of the plugin.

**An older build does not replace a newer Harness.** The version is `<semver>+<short SHA>`, with `.dirty` at the end for
a build with uncommitted changes. Only the semver part has an order. The copy in the folder and the version Claude Code
lists are both compared, because they differ after a failed `plugin update`.

| Installed version compared with this build | Result |
|---|---|
| The same string | Nothing to do for the plugin |
| Lower semver | Update, through the dialog |
| Same semver from another commit, or one of the two `.dirty` | Replace, through a dialog that says worfy cannot tell which one is newer |
| Higher semver, or not a build version | Refused: an error of the step `copy`, with no dialog, copy or command. The reason names the way out: open the build that installed it, or remove the folder by hand and press Install |

With the folder removed by hand, the dialog says that it installs an older Harness. A copy that an interrupted install
set aside counts as installed for this comparison.

**After an Update or a roll back of the Stable copy there is no second dialog.** The press of "Restart now" or "Roll
back" was the consent to that copy's Harness. At the first start of the new copy, worfy installs its Harness when the
installed one is outdated or missing, through the same installer and commands as above. It does so once: the record of
the restart is marked as used first, so a failed install is not tried again until the user presses the button. A
failure is the usual error state with Retry, and the Update state marks it for a notice. An install started from the
toolbar at that moment is shared, and Cancel in its dialog leaves the Harness as it was. When the copy that starts is not the one
the restart named, because the swap did not happen, nothing is installed. Claude Code takes the new Harness from the
next Session on. The Update itself is described in [Updates](updates.md).

**Harness out of date.** While Update is on, worfy also checks whether the installed Harness is behind this copy's. A
lower semver is behind at once. For the same semver from another commit, worfy asks GitHub without sign-in whether this
copy's commit comes after the installed one's. No answer from GitHub means no signal. The check runs after the install
of the start, then once an hour, and again after every install of the Harness. The signals of a Harness behind are the
accent and the dot of "Update Harness", the toast "Harness out of date: <from> → <to>" and a failed Health row, see
[Updates](updates.md).

**Moving an old Harness.** Before the plugin, the Harness lived directly in `~/.claude`. While anything of it is left
there, the First run row offers "Move…", and in a run that may install the toolbar also shows the icon "Move old
Harness…". The form "Move the old Harness out of ~/.claude" has a row for each thing:

| Group | Choices |
|---|---|
| Harness files | Remove, Keep |
| CLAUDE.md sections, shown as a diff | Remove, Keep |
| Hooks in settings.json | Remove, Keep |
| Status line | Replace, Keep |
| qmd: the scripts, the hook and the MCP record together | Remove, Keep |
| Machine state | Move, Keep |
| Profiles, each with its fields and a diff | Move, Keep |

A row that cannot be removed offers Keep alone and says why. What the form does not list stays in `~/.claude`. Move is
inactive, and the form says why, until the plugin is installed, enabled and of this build's version.

After a consent dialog, everything the move takes or changes is copied to a folder `backup-<date>` in the Harness home,
and only then do the steps run. A step that fails undoes the move and is named in the form. After a move the form shows
the backup and the one command that undoes it, `node <backup>/restore.mjs`. That command needs neither worfy nor the
plugin, and it disables the plugin first. It keeps what changed after the move in the folder `after` of the backup, and
a second run changes nothing. Sessions already running keep the old hooks until they restart.

#### On Windows

A rename or removal of the plugin folders that a held-open file refuses is tried again for up to 60 s: on `EPERM`,
`EBUSY` or `EACCES`, and also `ENOTEMPTY` for a removal, with pauses from 0 to 100 ms. Putting the previous copy back
and removing the staging folder after a failure get 10 s each, so the worst failure takes about 80 s. If the new copy is
in place and the previous one cannot be removed, the install goes on and the next install removes that folder. Off
Windows the same errors are not tried again.

#### On a Linked machine

A Linked machine cannot start an install or a move here: the channels of both are local. The item and the form describe
the Machine whose window shows them. "Add project" for a folder on a Linked machine says that the Harness is set up on
that Machine itself.

### How it works

- **The copy is the marketplace and the plugin at once.** Its marketplace names the plugin at `./`
  ([ADR-0040](../adr/0040-harness-delivery-local-marketplace.md),
  [ADR-0048](../adr/0048-harness-plugin-spike-results.md)).
- **Two writers.** In an install, worfy itself writes only the plugin folder, through a staging folder next to it that
  is renamed into place. Claude Code's own commands write `settings.json` and its plugins folder. They run with the Claude Code binary of the
  SDK and not the user's `claude` ([ADR-0008](../adr/0008-claude-code-native-binary-path.md)).
- **A second `install` does not change a version**, so another version goes through `update`.
- **The dependency goes first**, because `plugin install` succeeds without it and the plugin then does not load
  ([ADR-0059](../adr/0059-installer-installs-plugin-dependencies.md)).
- **Which Harness is on the Machine is looked up on every call**, so a switch needs no restart. The old Harness wins
  while its `bin/epic-status` is in the Claude home, because its hooks are still in `settings.json`
  ([ADR-0049](../adr/0049-worfy-sessions-without-inline-plugin-on-legacy-harness.md)). That is why the move removes this
  file last.
- **Reading writes nothing.** Without the plugin folder the state runs no command, and a dependency shows as unchecked.

### Implementation

| Module | Role |
|---|---|
| `electron.vite.config.ts` | Copies `harness/` to `out/harness` on each build of main, without `bin/tests`, `hooks/tests`, `evals` and `evals-outcome`, and writes the version from `scripts/build-version.ts` into the copy's manifest |
| `electron-builder.yml` | Puts the copy into the app's resources, outside `app.asar`, because a script inside it cannot be run |
| `src/main/harness/bundled.ts` | Finds the copy and its version |
| `src/main/harness/install.ts` | The installer: state, plan, version order, dialog text, swap of the folder |
| `src/main/harness/locate.ts` | Which Harness is on the Machine (`plugin`, `legacy`, `none`), and the folders of its scripts and Gate state |
| `src/main/ipc/harness.ts` | The app's one installer and the consent dialog. Announces `harness.changed` |
| `src/shared/ipc/harness.ts` | The channels and states |
| `src/renderer/shell/toolbar/HarnessStatus.tsx` | The toolbar item, which `src/renderer/settings/PipelineSection.tsx` shows too |
| `src/main/first-run/actions.ts` | Runs the same installer from First run |
| `src/main/harness/migrate/plan.ts` | The rows of the move form, read from disk. Writes nothing |
| `src/main/harness/migrate/apply.ts` | The move, step by step: backup, settings, `.claude.json`, CLAUDE.md, state, files, `bin/epic-status`, commit |
| `src/main/harness/migrate/restore.ts` | The manifest and `restore.mjs` |
| `src/main/harness/migrate/profiles.ts` | Profiles of schema 1 become schema 2 |
| `src/main/ipc/harness-migration.ts`, `src/shared/ipc/harness-migration.ts`, `src/renderer/harness/MigrationForm.tsx` | The offer and the dialog of the move, its channels and the form |

Every path a move writes or removes is checked to be inside the Claude home or the Harness home, and `.claude.json` is
the one file outside them.

Main tests: `test/contract/harness-install.test.ts`, with a stand-in Claude Code and failures injected in the copy and
the renames. `test/e2e/harness-install.spec.ts` and `test/e2e/harness-migrate.spec.ts` go through the toolbar. Also
`test/contract/harness-changed.test.ts`, `test/contract/harness-migrate.test.ts`, `test/unit/harness-locate.test.ts`,
`test/unit/harness-status.test.tsx` and `test/unit/harness-migration-form.test.tsx`.

## Plugin

### Behaviour

The plugin `worfy` comes from the marketplace `worfy-harness`, and its skills and agents carry the prefix `worfy:`, as
in `/worfy:epic-wave` and `worfy:implementer`.

| Part | What it holds |
|---|---|
| Agents | The three roles, see [Agents](skills-agents-and-hooks.md#agents) |
| Skills | The ten procedures, see [Skills](skills-agents-and-hooks.md#skills) |
| Hooks | The commands Claude Code runs on its events and the rule texts, see [Hooks](skills-agents-and-hooks.md#hooks) |
| Scripts | The 20 programs below |
| Profile contract | The description of a Profile and the schema of its draft |
| MCP server | `qmd`, the search over documents |

**Which copy a Session runs.**

| Session | Old Harness in `~/.claude` | What it runs |
|---|---|---|
| Started by worfy | No | The copy of this build, passed inline. It replaces an installed plugin of that name and does not need one |
| Started by worfy | Yes | No plugin, so the old hooks do not run twice |
| Started in a terminal | No | The installed plugin |
| Started in a terminal | Yes | The old hooks, and the plugin's too when it is installed |

So without an old Harness a worfy Session matches its build, and a terminal session changes only with an install. A
Session in a Project whose Profile has `skills.allowed` loses the user's other plugins and skills and keeps `worfy`
([Sessions](sessions.md)).

**The Profile.** An agent's first action is to run `profile`, and it follows what that prints: the commands, the Ticket
paths, the parallel mode, the finish, the numbering, the documents and the free text of the Project's rules. A Profile
is never in a repository. The script finds the Project from a folder, a worktree anywhere on disk included. Its exit
code decides what the agent does:

| Code | Meaning | Agent |
|---|---|---|
| 0 | Profile found | Works by it |
| 1 | The registry, the resolver or the Profile file is broken | Does not guess commands. The implementer stops and reports it. The scout and the reviewer write the code first and go on without a Profile |
| 2 | Invocation error, such as a path that does not exist | The same |
| 3 | The Project is not registered or has no Profile | The same |
| 4 | With `--field`, the field is missing | Skips the step that depends on it |

**User personalization.** Two optional files in the Harness home, written by hand and only read by the Harness: one sets
the language of reports, which wins over the value in a Profile, and the other holds the user's own rules for every
Session and Subagent (see [Hooks](skills-agents-and-hooks.md#hooks)).

**The scripts.**

| Script | What it does |
|---|---|
| `profile` | Prints the Profile of a folder, whole or one field |
| `profile-set` | Writes the Pipeline, or `workflow.agents` and `agents`. Nothing else |
| `project-connect` | Writes or removes the Profile and registry entries of a Project |
| `ticket` | The one writer of a Ticket's status lines. Also writes the marks |
| `epic-status` | The Stage line of an Epic, or every Ticket as JSON |
| `epic-board` | A snapshot of all Epics and Tickets on one page |
| `preflight` | The check before a Ticket or a Wave. Its last line is `GO` or `BLOCKED: <reasons>`, and it prints the next free ADR and migration numbers |
| `wave-gate` | One Gate full for the set of a Wave's ready PRs, then their merge |
| `land` | Merges ready PRs one by one and closes their Tickets in one documents PR |
| `wave-brief` | The short summary of an Epic's Waves that a new Orchestrator reads first. Read-only |
| `decision-log` | Adds one decision to the log of a Wave that runs without a person |
| `silent-check` | Looks for traces of the workflow in a text or a diff, see [Full mode and Silent mode](projects.md) |
| `shortcut-ledger` | Lists the `shortcut:` comments of a work tree, one row each |
| `code-map` | The code map of a repository, kept next to the Profile, with a commit for each folder |
| `worktree-lock` | The advisory lock on a working tree, see [Hooks](skills-agents-and-hooks.md#hooks) |
| `start-context` | Estimates each agent's starting context in tokens, see [Agents](skills-agents-and-hooks.md#agents) |
| `qmd-mcp` | Starts the MCP server |
| `qmd-refresh` | Updates the index when a main branch has moved or a memory or lessons file is newer than the last update |
| `qmd-sync-main` | Pulls the copy of a Project's main branch that the index reads |
| `qmd-collections` | Adds the three collections of a Project to the index and names them in its Profile |

**qmd.** The MCP server starts only after the user agreed to the models. Otherwise it stops with a message, and agents
search with grep over the Profile's `qmd.fallback_grep`. One index serves all Projects, and it may lag behind: agents
check what it finds against the working tree. Installing qmd and its models is an action of [First run](onboarding.md).
For its own Sessions worfy registers the server itself, under the name the tools have in a terminal session
(`mcp__plugin_worfy_qmd__…`), and the Profile's `mcp.allowed` filters it like any other server.

**Text.** The plugin is written in English, apart from the words of other languages that it must read in people's
Tickets, older Profiles and the verdict lines of an older Gate, and the old Russian forms of the Wave command. A test keeps its files free of one person's names, accounts and home paths, of work projects, and of
worfy's own decision, Ticket and Wave numbers.

#### On Windows

worfy starts a Node script of the Harness as `node <script>`. On Windows a script of an older Harness that is not a Node
script is refused, with a request to update the Harness. Most hook commands name `node` too, and a rule text shows the
plugin root as `C:/…`. The start of a Gate on Windows is on the [Gate page](gate-and-github.md).

#### On a Linked machine

There is one Harness on a Machine, and its Profiles stay there. A Project on a Linked machine uses the Harness of that
Machine.

### How it works

- **One Harness, many Projects.** The Harness is a Claude Code plugin
  ([ADR-0019](../adr/0019-harness-claude-code-plugin.md)). A skill, hook or agent that needs a project fact reads it
  from the Profile and does not keep it. worfy changes the state of the workflow only through these same scripts
  ([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md)).
- **The plugin is neutral.** Language and other choices of one person are User personalization or the Profile, not the
  plugin ([ADR-0074](../adr/0074-harness-neutral-by-language-and-project.md)).
- **qmd is part of the Harness**, and its version is pinned because the scripts rely on it
  ([ADR-0043](../adr/0043-qmd-is-part-of-harness.md)).
- **A script gets the login shell environment**, not worfy's own, because an app started from Finder has no node on its
  PATH ([ADR-0007](../adr/0007-claude-code-launch-environment.md)). For the plugin, worfy adds `HARNESS_HOME`.

### Implementation

- `harness/.claude-plugin/plugin.json` and `harness/.claude-plugin/marketplace.json` are the manifests. The source has
  no `version`: the build writes it. `harness/.mcp.json` names the server.
- `harness/bin/` holds the scripts, with the glossary of Tickets in `harness/bin/TICKETS.md`. `harness/lib/` holds what
  they share: the rules of a Pipeline in `harness/lib/pipeline.cjs` and the words of other languages in
  `harness/lib/input-words.json`.
- `harness/profiles/README.md` is the contract of a Profile, and `harness/profiles/draft.schema.json` the schema of a
  draft.
- In the Harness home: `projects/<name>/` holds a Profile (`profile.json`, `rules.md`), `gate/config.json` the registry,
  `user.json` the language and `user/rules.md` the user's rules.
- `harness/README.md` describes the folder, its tests and its evals.
- In the app: `src/main/agent/options.ts` passes the copy inline and registers its servers, with the folder from
  `src/main/agent/app-registry.ts`. `src/main/workflow/profile.ts` starts the scripts, with the environment of
  `src/main/harness/script-env.ts`. `src/main/harness/attribution.ts` holds worfy's copy of the default of `attribution`, for a value
  named before any Profile exists, and `src/main/harness/qmd.ts` installs qmd and its models.

Main tests: `harness/bin/tests/` and `harness/hooks/tests/` are shell tests, which `pnpm test` runs through
`test/contract/harness-scripts-1.test.ts` to `test/contract/harness-scripts-4.test.ts`.
`harness/bin/tests/plugin-neutral.test.sh` is the test of the text above. `test/contract/harness-plugin.test.ts` pins
the manifest and keeps out of `harness/` what is not the Harness. Also `test/contract/harness-qmd.test.ts`,
`test/contract/harness-script-env.test.ts`, `test/contract/harness-script-command.test.ts` and
`test/unit/agent-options.test.ts`.

The evals make paid model calls, and CI and the Gate do not run them. `harness/evals/` holds ten `claude plugin eval`
cases that check by behaviour that Claude follows the rules (`pnpm eval:harness`), and `harness/evals-outcome/` holds
the tasks of `pnpm eval:outcome`. `test/contract/harness-evals.test.ts` checks for free that every case is complete.
