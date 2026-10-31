# Skills, agents and hooks

Three Features of the [Harness](harness.md) plugin. **Skills** are the procedures that agents follow, **Agents** are the
three roles they start, and **Hooks** are what runs by itself around a Session. Terms are explained in
[Concepts](concepts.md).

## Skills

### Behaviour

A skill is a procedure in Markdown that an agent follows. worfy's actions, Autopilot and the user start them as
`/worfy:<name>`, and the model may pick all but `overnight-fix-loop` by their descriptions.

| Skill | When | What it does |
|---|---|---|
| `epic-wave` | `/worfy:epic-wave tickets 05, 06 of epic X`, the Autopilot command, or a request to run or resume a Wave | Dispatch, verification and merge of a Wave's Tickets |
| `ship-ticket` | One Ticket, or a review of a PR another Session wrote | One Ticket from claim to the finish of its Profile |
| `connect-project` | `/worfy:connect-project <folder> <full\|silent>`, or the draft of "Add project" | Reads the code, drafts a Profile, its rules and registry entries, and writes them after confirmation |
| `gate-queue` | `/worfy:gate-queue`, on the Machine whose Profile serves the queue | See [the cross-machine gate queue](gate-and-github.md) |
| `max-review` | On request, or for a Ticket marked as risky | Two lenses over a whole branch, optionally on two models, a synthesis and sceptic agents. Edits and merges nothing |
| `retro` | The end of a Ticket, an Epic or a debugging session | Records what generalizes where the Profile keeps lessons |
| `qmd` | Before planning, or for "why was it decided so" | The rules of searching decisions and lessons |
| `continuous-audit` | "audit", or a scheduled run | An audit Epic of findings. A finding stays a claim until a second agent has reproduced it |
| `overnight-fix-loop` | `/worfy:overnight-fix-loop <modules>`, by hand | A worktree and an implementer for each module, merged into a night branch. Nothing goes into the main branch at night |
| `tickets-to-tasks` | After Tickets are written, or when the task list is empty | Imports Tickets into Claude Code Tasks and keeps their blockers |

**`ship-ticket`.** The finish comes from `workflow.finish`. Steps 7 and 8 go in the order of the Pipeline: with
`agent-review` after `ci`, the default, step 8 comes first and step 7 runs on the PR's head. The other steps run as
numbered:

| Step | What happens |
|---|---|
| 0 Profile | Reads the Project's facts and Pipeline |
| 1 Claim | `ticket claim`, the Ticket and its spec, and one `qmd` call before the plan |
| 2 Fresh base | A fresh base and the Ticket's own worktree, or the main checkout when the Profile says `single` |
| 3 Numbers | ADR and migration numbers are taken before the content |
| 4 Failing test | The test is seen red before the fix |
| 5 Implementation | The change itself |
| 6 Checks | `commands.verify` and the Gate, with the exit code visible |
| 7 Review | Review agents on the diff, when the Pipeline has `agent-review` |
| 8 PR and CI | A PR and green CI |
| 9 Merge | A separate step, on green |
| 10 Production | With `pr-green-ci` and a `deploy` in the Profile: a check of what was deployed. Otherwise skipped |
| 11 Close | The end of the Ticket |

With `local-green` a green step 6 is the finish of the code: steps 7 and 11 follow, with a local merge, and steps 8–10
are skipped. A disputed decision in the spec, a conflict that cannot be resolved mechanically, or a red check not fixed
in two attempts stops the skill with a question.

**`epic-wave`.** The Orchestrator runs it, section by section:

1. **Preflight**: `preflight` and the state before the Wave.
2. **Dispatch**: an implementer named `impl-<NN>` for a Ticket, in the background. The merge stays with the
   Orchestrator. A question for the owner does not stop the Wave: the recommended option is taken and recorded as
   decided without the owner. In a Session without a person a question to the user is declined automatically.
3. **Verification gate**, with `agent-review` in the Pipeline: an agent named `verify-<NN>` checks each report.
4. **Merge by policy**: CI, the marks and the merges.
5. **Report**: then a saved brief, and the Session stops.

A new Session resumes by running `wave-brief` first.

**What a Profile changes.**

- `workflow.agents`: `full` or `eco`. In `eco` a small Ticket (documents alone, or one change in one file) is done by
  the Orchestrator itself, unless it touches a script or a hook, is a platform PR, or deletes files, stops processes or
  replaces a copy. In `ship-ticket` a review of an `eco` Ticket's own diff is at depth `low`. The Verification gate of
  `epic-wave` keeps its depth.
  The Eco mode switch writes this field together with `agents`, the model and effort of each role
  ([Sessions](sessions.md)).
- `docs.feature_pages`: a folder of pages that describe behaviour. In step 5 of `ship-ticket` a change that alters
  behaviour a page there describes updates that page in the same PR, and a Ticket's file list in `epic-wave` is not
  complete without such a page. With no field the step is skipped, and the agent says so.
- `review.lenses` and `review.depth`: the lenses, and at the depths `low`, `medium`, `high` and `max` how many reviewers
  a round has. An argument of the skill or the owner's word in a message overrides the depth.
- `workflow.pipeline`: the Stages, and so which steps run ([Workflow](workflow.md)).

**In Silent mode** the procedure is the same with the files in the Workflow folder, and a separate file of the skill
says what branches, commits and PR texts may not carry.

### How it works

- **Only the start is loaded.** `ship-ticket` keeps steps 7–11 and the parts only some Tickets need in files next to it,
  each read at its step, so an agent that never gets there never pays for it. Claude Code spells out the plugin root
  only in `SKILL.md`, so those files name a placeholder that the agent reads as the plugin folder.
- **Questions do not stop an unattended run**, because under [Autopilot](autopilot.md) a Wave runs without a person.
- **Merging belongs to the Orchestrator**, and an implementer stops at its finish.

### Implementation

- `harness/skills/` has a folder with a `SKILL.md` for each skill, such as `harness/skills/epic-wave/SKILL.md`.
  `harness/skills/overnight-fix-loop/SKILL.md` sets `disable-model-invocation`.
- `harness/skills/ship-ticket/` also holds `step-*.md`, `silent-mode.md`, `review-of-another-pr.md` and
  `pipeline-stages.md`, and the `implementer-*.md` files that the agent definition names.
- `src/shared/projects/action-templates.ts` holds the commands worfy's actions send: `/worfy:ship-ticket`,
  `/worfy:epic-wave` and `/worfy:gate-queue`.

Main tests: `harness/bin/tests/epic-wave-ship-ticket.test.sh`, `harness/bin/tests/skill-blocks.test.sh`,
`harness/bin/tests/review-depth.test.sh`, `harness/bin/tests/max-review.test.sh`,
`harness/bin/tests/gate-queue.test.sh`, `harness/bin/tests/silent-mode.test.sh`,
`harness/bin/tests/skills-allowed.test.sh` and `test/contract/harness-retro-skill.test.ts`. Evals check `epic-wave` and
`ship-ticket` by behaviour.

## Agents

### Behaviour

Three agents are the same for every Project. Each starts by running `profile`, on the path its brief names.

| Agent | Model, effort | Tools | Writes | Ends with |
|---|---|---|---|---|
| `worfy:implementer` | Inherited, high | All | One Ticket's code and tests, in its own worktree or the main checkout | A JSON report |
| `worfy:reviewer` | Inherited, high | Read, Grep, Glob, Bash, `qmd` | It fixes nothing: it reports, and the implementer fixes | Findings, at most 30 lines |
| `worfy:scout` | sonnet, medium | Read, Grep, Glob, Bash, `qmd` | Only the code map, outside the repository | The answer: where X is, how Y works, a file map |

**Which model and effort.** The first of these with a valid value wins: the owner's word in a message, an argument of
the skill, `agents.<role>` of the Profile, the agent's own definition. The roles are `implementer`, `reviewer`
(reviewers and sceptics), `scout` and `verifier`. The model is `sonnet` or `opus`, and the effort is `low`, `medium` or
`high`. Another value, `haiku` included, is not passed. The report of the skill names each agent's model and effort and
where they came from.

**The implementer.** It edits the files in the Ticket's trail section and those its brief names, and reports the rest as
outside the scope. A premise of the brief that the code contradicts is not carried out silently: it reaches the outcome
another way and says so first. It runs the check and the Gate with exit codes, opens a PR when the finish needs one and
does not wait for CI. It does not merge, does not start review agents, and does not touch ADRs or the state file. Its
report holds:

- `ticket`, `branch`, `pr`, `worktree`, `files_changed`
- `commands`, each with its exit code
- `claims`, each with evidence, which another agent checks
- `removed`, what the change removed from existing behaviour
- `not_verified`, `out_of_scope` and `sign_in_needed`

**The reviewer.** It gets a diff and one lens, and it tries to refute "everything is fine". A finding is about a line of
the diff, an unmet item of the Ticket, or evidence that does not hold, and each carries a severity, a scenario and a
fix. A defect next to the change goes on the line "outside the diff", and one outside its lens on the line "outside the
lens". A removal that the Ticket, the spec or the brief states as intended is not a finding, unless its consequences
seem underestimated or the change looks harmful. It asks `qmd` first whether the question was already decided. Three
lenses have written rules:

- **Implementer's report**: the first characters of the answer are `VERIFIED`, or `REJECTED: <the unconfirmed claims>`.
- **Simplification**: what can be deleted, reused or made simpler. A suggestion with nothing to point at is not
  reported.
- **documentation**: whether the diff changes behaviour that a page from `docs.feature_pages` describes, without editing
  that page. A sentence the change makes false is `med`. Refactoring, behaviour no page describes and a sentence already
  wrong before the diff are not findings.

Other lenses, from `review.lenses`, are read by their names. A UI Ticket needs screenshots in both themes.

**The scout.** For a question about code it reads the code map first. It answers where X is or how Y works, or builds a
list of files for a Ticket. It edits no file of a repository and runs no stack.

**The starting context.** An agent starts with its definition, the common rules of [Hooks](#hooks) and the skill it
reads at the start. `start-context` estimates this at 2.7 bytes per token, and exits 1 when the parts the Harness writes
pass 15 000 tokens for an agent.

### How it works

- **Roles check each other.** An implementer's claims go to another agent, and the Orchestrator starts the reviewers. An
  implementer that started one would wait forever, because the answer goes to the Orchestrator.
- **Parallel reviewers hold one lens each**, because overlap defeats the point of running them in parallel.
- **A map before the code.** The scout reuses the code map, and `code-map stale` lists the folders whose files changed
  since their commit.

### Implementation

- `harness/agents/implementer.md`, `harness/agents/reviewer.md` and `harness/agents/scout.md` are the definitions.
- `harness/skills/ship-ticket/implementer-report.md` and the other `implementer-*.md` files hold what only some Tickets
  need.
- `harness/bin/code-map` and `harness/bin/start-context` are the scripts, listed on the [Harness](harness.md) page.

Main tests: `harness/bin/tests/agents-text.test.sh`, `harness/bin/tests/code-map.test.sh`,
`harness/bin/tests/start-context.test.sh`, and the evals `harness/evals/implementer-report/`,
`harness/evals/reviewer-verdict/`, `harness/evals/reviewer-intended-breakage/` and
`harness/evals/reviewer-simplification/`.

## Hooks

### Behaviour

Claude Code runs these commands on its events. The limit is in seconds.

| Event | Command | Limit | What it does |
|---|---|---|---|
| `SessionStart` | `inject-rules.mjs orchestrator` | 10 | The rules of a main Session |
| `SessionStart` | `inject-rules.mjs common` | 10 | The common rules and the user's rules |
| `SessionStart` | `session-start.mjs` | 15 | The context of the Project |
| `SessionStart` | `gh-token-env.mjs` | 10 | `GH_TOKEN` of the Project's account |
| `SessionStart` | `worktree-lock claim` | 10 | Registers in the tree, and says who is already there |
| `SubagentStart` | `inject-rules.mjs common` | 10 | The common rules and the user's rules |
| `PreToolUse` on Bash | `guard.mjs` | 30 | The Bash guard |
| `TaskCompleted`, `TeammateIdle` | `gate.sh fast` | 900 | The [Gate](gate-and-github.md) |
| `Stop` | `stop.mjs` | 10 | Holds the turn while the Gate is red, see the [Gate](gate-and-github.md) |
| `Stop` | `worktree-lock beat` | 5 | Marks the Session alive |
| `Stop` | `qmd-refresh --quiet` | 15 | Updates the index in the background if a main branch moved or a memory or lessons file is newer than the last update. When qmd cannot run (no qmd, node older than 22.14), it exits 0 and does nothing |
| `SessionEnd` | `session-end.mjs` | 10 | Notes a Session without a retrospective |
| `SessionEnd` | `worktree-lock release` | 5 | Unregisters |

**A broken hook does not break a Session.** A failure inside `inject-rules.mjs`, `session-start.mjs`, `session-end.mjs`,
`gh-token-env.mjs` or `stop.mjs` is one line on stderr and code 0, and the worktree lock fails silently. The Gate gives
its verdict by exit code, and `stop.mjs` holds a turn with code 2. The guard exits 0 and refuses through its answer.

**Rules.** `orchestrator` reaches a main Session, and `common` reaches a main Session and every Subagent. `orchestrator`
holds the default loop, delegation and the report. `common` holds plain language, evidence before "green", context
hygiene and the shell commands that need a person's confirmation. Claude Code cuts one such text above 10,000 characters
to a preview, so `common` with the user's rules stays within that limit: a longer rules file is cut after a whole line,
and a closing line names the file. A file that cannot be read costs one line on stderr, and the part arrives without it.

**The context of the Project.** It stays empty for a folder outside a registered Project and for a Project that asks for
nothing:

| Added | When |
|---|---|
| Where the workflow files live, and that branches, commits and PRs carry no trace of the workflow | Silent mode |
| That commits and PRs carry no Claude attribution lines | `attribution: off` |
| The Project's rules without their section of sources, the lessons index when lessons live in the Profile, the map of the active Epic | `session.inject_rules: true` |
| A reminder about `/retro` | `session.retro_reminder_after`, once that many Sessions ended since the last `/retro` |

Each section is at most 20,000 bytes by default. A longer one is cut at a line end, with a last line that names the full
text.

**`GH_TOKEN`.** When the Profile's `github.account` is a GitHub login and `gh auth token -u <account>` succeeds, the
hook adds a line to the environment file of Claude Code, which runs before every Bash command of the Session and its
Subagents. The token is computed for each command and is not written to disk. It wins over a `GH_TOKEN` the user
exported, and the global `gh` account is not touched. Without such a login under `gh`, the Session is told so in one
line and goes on.

**The worktree lock.** It says who else is writing into this folder, which git does not track. It blocks nothing. A
Session counts as alive if it marked itself in the last 60 minutes (`WORKTREE_LOCK_TTL_MIN`), and `beat` stays silent
while the set of Sessions has not changed.

**The Bash guard.** It refuses a command and gives the reason, in three cases:

| Refused | Which commands |
|---|---|
| Destroying uncommitted work | `git checkout` or `git restore` over `.`, `./` or `*`; `git reset --hard`; `git clean` with force; `git stash pop`, `git stash drop`, and `git stash` alone or followed by `-u`, `-k`, `-a` or `save` |
| A pipe that hides the exit code | A pipe after `pnpm`, `yarn` or `npm` with `lint`, `test`, `typecheck`, `check` or `build`, or after `vitest`, `eslint`, `tsc`, `jest`, `pytest` or `gh pr checks`, unless `pipefail` comes before the pipe |
| Traces of the workflow | In Silent mode or with `attribution: off`: the text and the staged changes of `git commit`, a new branch name, and the text of `gh pr create`, `edit`, `comment`, `review` or `merge`, when `silent-check` rejects them |

The reason gives the right way, such as a temporary commit or `set -o pipefail`. For the first two cases, quoted text in
a command such as `grep` or `echo` is data, and a heredoc body is not read as a command. A trace check that gives no
answer refuses too: each try gets 10 s, and a command gets two tries in all, so the hook ends within its limit. If the
check cannot read the Profile, the command goes on.

#### On Windows

The hooks start `profile` as `node <script>`, not by its first line. A rule text shows the plugin root as `C:/…`, and
the home folder shown as `~` is `USERPROFILE`. The Gate's launcher is on the [Gate page](gate-and-github.md).

### How it works

- **The rules are not a `CLAUDE.md`.** Claude Code does not load one from a plugin root, and one in a subfolder of a
  repository would be added to each Session that edits that folder. So they arrive as `additionalContext`.
- **Text for the model, not control.** Only the Gate and the guard hold anything back. The rest is text for the model.
- **The token reaches no output.** The hook only checks the exit code of `gh`, and the line it writes computes the token
  later.
- **The attribution default follows the mode**: off in Silent mode and on in Full mode, unless the Profile sets it
  ([ADR-0061](../adr/0061-attribution-default-follows-mode.md)).

### Implementation

- `harness/hooks/hooks.json` wires every hook, through the plugin root.
- `harness/hooks/inject-rules.mjs` with `harness/hooks/rules/orchestrator.md` and `harness/hooks/rules/common.md`.
- `harness/hooks/session-start.mjs` and `harness/hooks/session-end.mjs`, which ask `bin/profile` for the Project. The
  retrospective log is `state/pending-retro.log` of the Profile.
- `harness/hooks/gh-token-env.mjs`, `harness/hooks/guard.mjs` (with `harness/bin/silent-check`) and
  `harness/bin/worktree-lock`, whose registry is `worktree-sessions/` in the Harness home.
- `harness/hooks/stop.mjs`, `harness/hooks/gate.mjs`, `harness/hooks/gate.sh` and the modules next to them: see the
  [Gate](gate-and-github.md).
- `harness/hooks/eval-env.cjs` gives the scripts their git and state folder, with the variables of an eval run.
- `harness/hooks/worktree-create.sh` is a draft, and `harness/hooks/hooks.json` does not run it.

Main tests, all shell tests: `harness/hooks/tests/rules-hooks.test.sh`, `harness/hooks/tests/session-hooks.test.sh`,
`harness/hooks/tests/gh-token-env.test.sh`, `harness/hooks/tests/guard-silent.test.sh` and
`harness/bin/tests/harness-home.test.sh`. The eval `harness/evals/status-block/` checks by behaviour that a main Session
follows the rules.
