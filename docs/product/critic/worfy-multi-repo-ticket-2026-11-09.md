# Critic: worfy-multi-repo-ticket — 2026-11-09

Plan: `.scratch/worfy-multi-repo-ticket/spec.md`
Verdict: Split — the only Project over several repositories lets no agent merge, keeps no worktrees and opens PRs only after agent review, so Ticket 06 (`land` across repositories) has no user and Ticket 07 describes a flow that Project does not run; cut 06 out of the Epic and rewrite 07 for the flow that exists.

## Objections

### 1. Ticket 06 teaches `land` to merge across repositories, but no Project over several repositories lets `land` merge

Fact: `spec.md:171` says "в Full mode проектов из нескольких репозиториев нет (ADR-0045, пункт 3)"; of the four Profiles under `~/.claude/worfy-harness/projects/` only the owner's work project has `layout.repos` (three repositories), and its `profile.json` has `"workflow": {"merge": null, …}`, while its `rules.md:128` says "People of the team merge, never an agent and never worfy" (owner decision 2026-11-09, `rules.md:191–195`); `harness/skills/epic-wave/SKILL.md:1168` runs "Merge with land" only for the orchestrator's merge; the spec's ticket table (`spec.md:198`) gives 06 review depth `high` and marks it platform, so its PR waits for the Windows verdict (ADR-0056).

Judgement: Every merge Ticket 06 would order is done by people of the team in that Project, so the per-PR `repo` field, the ordered merge and the Q7 stop rules of `land` serve no Project today, while costing a `high` review and a Windows wait on the critical path of Wave 2 and of 07. The merge order then rests only on the "Merge after it" line in the PR description (`spec.md:91`), which the spec should say plainly. Cut 06 to a later Epic that starts when a Project over several repositories sets `workflow.merge` to an agent; keep in this Epic only what `ticket done` and `wave-brief` need.

Owner decision:

### 2. Ticket 07 writes "one worktree per repository, the implementer opens a PR in each" for a Project that has no worktrees and opens PRs only after review

Fact: `spec.md:36` says "Implementer заводит по worktree на каждый репозиторий … и открывает по PR в каждом" and `spec.md:75` "Одно worktree на репозиторий на Ticket: `worktree.implementer` Profile-а для каждой строки `Repo:`"; the work project's `profile.json` has `"parallel": "single"` and `"worktree": {"implementer": null, …}`, its `rules.md:142` says "One stack, one ticket at a time: no parallel worktrees running the stack", and `rules.md:129–132` give the Pipeline `queued → implementing → agent-review → ci → …` with the PR opened "only after `review success`"; `harness/skills/ship-ticket/SKILL.md:155` says for `parallel: single` "No worktree: work in the main checkout, one ticket at a time".

Judgement: The skill texts of 07 and the acceptance of 08 would describe and test a path (worktrees, implementer-opened PRs, review on PR heads, cross-links written at PR open) that the one real user of the feature does not take. There the review runs on the branch heads of several main checkouts before any PR exists, and the cross-links are written by whoever opens the PRs after it. Ticket 07 should describe `parallel: single` across several checkouts (one branch per repository's main checkout, review on the set of branch heads, PRs opened together after `review success`), and Ticket 04 should state that the stage of a Ticket before its PRs exist comes from the branch heads of every `Repo:`.

Owner decision:

### 3. In the work project the consumer sees the library only through a published version, so a release step sits between the two merges, and no ticket names it

Fact: in the work project's server repository two `package.json` files of its services depend on the shared schemas package as `"^0.5.15"`, the extension's `package.json:30–33` pins the shared packages as `^0.2.1`, `^0.1.44`, `^2.0.2`, `^0.5.5`; the shared repository's `.github/workflows/release-schemas.yml` publishes only `on: push: tags: 'schemas-v[0-9]+.[0-9]+.[0-9]+'`; `spec.md:25–26` names "две Wave подряд вместо одной" as benefit 2, and `spec.md:123–124` and `:130–132` treat a consumer that sees the library only after its merge as the exception.

Judgement: For the layout the spec cites as its own example (library first, consumer second, `spec.md:16`), the exception is the normal case: the consumer PR cannot turn green until the library PR is merged, tagged and published and the consumer's version range is raised, so benefit 2 does not hold and the "one verdict on the set of heads" is always followed by a second head and a second review. The spec should name the release and version bump as a step of option (a) — who tags, when, and that the consumer's Pipeline stage waits for it — and drop or narrow the claim about time; otherwise Ticket 08's acceptance on the real project will stall on a step no ticket planned.

Owner decision:

## Alternative

A smaller Epic: Tickets 01–05 (format, `epic-status`, worfy model, stages, Board and Ticket Node), Ticket 07 rewritten for `parallel: single` across several checkouts with review before the PRs and the release step named, and Ticket 08 on the fixture plus one real Ticket of the work project. `land` across repositories and the ordered merge move to a later Epic, opened when a Project over several repositories lets an agent merge. This plan keeps what the owner asked for (one Ticket, one review of the seam, one card) and drops the one `high` platform ticket whose code no Project would run. The spec's plan is better only if a second Project over several repositories with agent merges is expected soon; the spec names none.

## What the critic cannot know

- There is no product analytics: how often a change in the work project touches two repositories, and how often the shared library is released, is not known.
- The work project's Profile and `rules.md` live outside this repository, under the owner's Harness home; a reader of the docs PR cannot open them, and the review names the project only as "the owner's work project" for privacy.
- Whether the team of the work project would accept PR descriptions that point at each other ("Goes with …"), and whether its release is run by people or by CI on merge, is not written anywhere the critic could read.
- The other line numbers of the spec (`harness/bin/epic-status:224`, `src/shared/workflow/types.ts:47`, `harness/bin/land:198` and the rest) were not all re-read; the ones checked (`harness/bin/ticket:976`, `src/main/workflow/stages.ts:152–206`) match.
