# Frontier AI findings (1–14 October 2026): research candidates for worfy

Status: research input **only**, not a spec, ADR, authorization to change the Harness, or a queue of approved Ticket-s.
Prepared: 2026-10-15. This snapshot is meant for Claude to critically verify and triage, not to implement verbatim.
Scope: relevant frontier AI research, Claude Code/Agent SDK, orchestration, model economics, and long-running agent reliability.
Project conventions and priority of truth: [CONTEXT.md](../../CONTEXT.md), [HANDOFF.md](../../HANDOFF.md), [roadmap](../roadmap.md), existing Epic specs, ADRs and live code. If they disagree with this document, **they win**.

## How to use this research

1. Recheck the linked sources and actual SDK/runtime version before proposing any implementation. Vendor self-reports, benchmarks, release-note claims, and direct reproduction are different grades of evidence.
2. Map each idea to existing features and Epic-s first. Do not create duplicate Ticket-s or change an accepted ADR on the strength of a news digest.
3. Propose small, isolated experiments with baseline, budget, repeat count, correctness criteria, and explicit rollback. A result that merely sounds faster but raises false-green Gate outcomes is a regression.
4. Keep this document under `docs/research/`. Do **not** append a summary of it to HANDOFF; that file is a current-state snapshot with a 15 KB / 150-line enforced contract.
5. No external API calls on private Project code and no surprise paid eval runs without owner's approval. The existing Claude Max subscription and Claude Platform API are separate accounting surfaces.

## Existing work already covers important parts

- HANDOFF cleanup is **done**: `scripts/check-handoff.mjs` enforces 150 lines / 15,360 bytes / five sections. Don't propose a redundant size checker.
- `worfy-harness` is a managed plugin with hooks, skills, Profile, Gate and eval plans; some paid eval work is blocked behind its existing Tickets 27–29. Don't assume harness deployment/eval is green without checking current Epic state.
- `worfy-review` already includes targeted review lenses, four finding groups, simplification, diagnostics, and an extended-review plan. See [spec](../../.scratch/worfy-review/spec.md).
- `worfy-terminal-ai` already uses Haiku for Next command suggestions; see [spec](../../.scratch/worfy-terminal-ai/spec.md), PR #310.
- Autopilot already understands background tasks (`system/background_tasks_changed`, ADR-0029), Limits, Stable copy and bounded rework; do not re-invent basic background-task tracking, timeouts, or reviewer loops.
- `worfy-link`, `worfy-windows` and E3 acceptance are live priorities; research should not silently reorder them.

## A. P0 candidate: Claude runtime compatibility and fail-closed regression tests

**Observation.** Claude Code release notes around v2.1.296–v2.1.299 discuss background/subagent restoration, permission/MCP checks, sandbox boundaries, duplicate tool execution, context management and shutdown behavior. The exact applicability of CLI-only options to Agent SDK must be measured; release notes alone are not proof of behavior inside Electron.

**Potential Worfy application:** an *isolated runtime-compatibility matrix* for the pinned Claude Code/SDK combination. Test:
- Primary `result` arrives while background implementers/reviewers are still active: Autopilot must not terminate Wave early (existing ADR-0029 regression).
- Session restart/resume during pending tool approval, active MCP call, background subagents, exhausted Limits, and graceful Stop: no dropped or duplicated operation, especially commits, merges or destructive commands.
- Fail-closed permissions/hooks and sandbox: blocked tools stay blocked after restart, plugin paths and MCP servers do not become accidental execution paths.
- Subagent compaction settings, terminal idle compaction and model overrides must **not** silently shrink Orchestrator context; independently establish which settings are recognized in SDK.
- Re-run on macOS and Windows as both execution paths mature.

**Test fixture strategy:** fake SDK streams for deterministic transition coverage; small opt-in real-SDK probes under isolated `HOME`/`CLAUDE_CONFIG_DIR` for vendor behavior. Respect real Claude Code's tendency to write into `~/.claude` ([lesson](../lessons/agents.md)). Compare version N with N+1, verify exact-once externally visible effects, include recovery after process kill. Prefer contract tests before adding new UI or an auto-updater.

**Do not implement automatically:** changing `idleCompaction` globally or force-updating the SDK. Check the actual running version and mode first.

Sources: [Claude Code releases](https://github.com/anthropics/claude-code/releases), [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), [Agent SDK docs](https://platform.claude.com/docs/en/agent-sdk/overview).
Evidence: vendor release documentation; Worfy-specific behavior requires reproduction.

## B. P1 experiment: Memento-style independent agent reset on proven stall

**Observation.** Anthropic's [self-replication research](https://www.anthropic.com/research/self-replicating-ai), appendix “The Memento harness”, describes multiple agent instances: a timed-out instance leaves short notes about tried strategies, failures and performance; a fresh instance inherits workspace/environment plus the notes. The paper reports gains in some settings, not universal superiority. The experiment was about deployment on unfamiliar hardware, **not** an independently validated coding benchmark.

**Worfy hypothesis:** when an implementer is objectively stuck, an independent fresh agent receiving a constrained factual handoff may outperform continually extending the same faulty hypothesis.

**Prototype, if approved:**
- Collect historical stalled Ticket cases from traces already owned by Worfy (no production mutation). Classify repeated equivalent failing commands, oscillation between approaches, no changing test evidence, or repeated rejected patches.
- Set a conservative trigger requiring *observed repeated lack of progress*, not a naive 30-minute timer.
- Write a small factual attempt record: current git SHA/worktree, reproducible failure/test log, actions already tried, falsified hypotheses, relevant ADR decisions, remaining constraints.
- Try a fresh agent in a **new isolated worktree** or safely preserved existing worktree as the Profile allows. Never overwrite a live agent's files or run a second writer into the same branch.
- Compare baseline bounded rework against reset on matching cases; measure success, interventions, tokens, wall-clock, regression rate, and ability to respect ADR.

**Stop conditions:** an unverified high-severity finding, security/permission denial, exhaustion of allowed retries, or owner decision still blocks. Do not turn this into an unbounded retry loop; existing ADR-0046 remains authoritative.

Evidence: authored Anthropic research; applicability to Worfy is an **untested hypothesis**.

## C. P1 experiment: cost/quality model routing, not “cheapest token wins”

**Observation.** Claude Haiku 5.5 adds a potentially useful low-cost specialized model tier. Pricing, context, cache and token-output behavior change over time and can be tiered by prompt length; do not hardcode numbers from a news summary.

**Possible narrow use cases:** ADR retrieval triage, finding categorization, concise evidence extraction, context preparation, cheap command suggestions already present in Terminal AI. Keep architectural grilling, high-stakes security review, and final merge decisions on the stronger verified baseline until an eval demonstrates parity.

**Experiment design:**
- Use 20–30 representative *replayable* tasks, including failures and ambiguous ADR conflicts.
- Config A: current defaults; Config B: Haiku for narrow classify/extract steps; Config C: Sonnet where applicable.
- Evaluate actual **cost per verified outcome** (tokens, prompt-cache hit/miss, extra retries and re-review), time to VERIFIED, hallucinated citations, ADR violations and interventions.
- Treat `Claude Code` subscription execution, separate API billing, and managed runtime costs separately.
- Respect user's Limits; no paid API eval without approval.

Sources: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [model overview](https://platform.claude.com/docs/en/about-claude/models/overview), [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview). Independent evaluations may supplement but not replace replay tests.

Evidence: public product/docs; performance on Worfy tasks unknown.

## D. P1 research: dynamic workflows as a separate execution paradigm

**Observation.** Anthropic introduced [Dynamic Workflows](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration) for Managed Agents (beta 2026-10-09). The agent writes a program coordinating other agents; server runs the phases and aggregates results. The API distinguishes dynamically generated workflow runs from ordinary subagent delegations. Runs consume API budget and agents share a sandbox and filesystem. Read the [workflow runs contract](https://platform.claude.com/docs/en/managed-agents/workflow-runs) before experimentation.

**Hypothesis:** agent-authored workflows may reduce controller inference overhead in large sets of independent audits/research, but can be worse than Worfy's explicit DAG, Profile, Git worktrees and Gate when work needs reproducible merges, permissions and hard isolation.

**Research only, not a migration:**
- Construct synthetic DAGs with dependencies, partial failures, timeouts, cancellation, resource contention, and file conflicts.
- Compare against existing `Wave` scheduler and audit cost/completion/evidence. Identify whether workflow code and execution traces can be inspected and replayed sufficiently.
- Keep real Project writes out of any shared-sandbox trial and enforce a strict paid API budget.
- Consider an optional batch research/review backend **only if** it offers measurable value and preserves Worfy's canonical workflow state in the Project.

Source: [multiagent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration), [release notes Oct 9](https://platform.claude.com/docs/en/release-notes/overview).
Evidence: confirmed beta feature/documented behavior; efficiency advantage **not independently established**.

## E. P1/P2: learn from real failures without poisoning long-term memory

**Observation.** Persistent lessons are only useful if they address the causal failure and have regression coverage. Worfy has `docs/lessons/`, ADR, review findings, Gate, Harness and planned eval. The research question is how to close the loop without flooding HANDOFF or teaching incorrect rules.

**Proposal for Claude to evaluate:**
1. After a failed Wave/blocked Ticket, extract candidate incident with repro and exact artifact references; deduplicate by root cause.
2. Separate transient outage (e.g. macOS fseventsd), vendor SDK regression, fixture weakness, ADR violation, code defect and prompt/Harness policy error.
3. Identify whether a *code* test, *Harness eval*, documentation clarification, or no durable lesson is appropriate; do not make every incident a new prompt rule.
4. Require before/after failing/passing evidence in an isolated fixture; human approval before changing cross-Project policy and privileges.
5. Record whether recurrence drops; prune/replace rules that don't improve measured results.

**Possible acceptance bar:** “previous failure becomes a deterministic regression test and documented invariant”; never reward suppressing flaky tests, relabeling `blocked` to `done`, or bypassing Gate.

Cross-reference [worfy-review spec](../../.scratch/worfy-review/spec.md) and current `worfy-harness` eval Tickets. This is an engineering hypothesis, not a newly released Anthropic feature.

## F. P2: measure the critical path instead of accelerating individual agents

**Observation.** Anthropic's [Scion engineering write-up](https://www.anthropic.com/engineering/redesigning-source-control) describes scale pressures in an agent-heavy monorepo and its internal source control replacement. Large throughput/speed figures are Anthropic self-reports; they don't justify replacing Git in a personal app.

**Application:** measure `claimed → implementation → review → Gate → PR → merge`, queue waits, lock contention, time paused by Limits, aborted/restarted Session, review loops, and the gap between ticket throughput and actual usable merged changes. Slice by Wave, model and failure reason (taking care not to leak private transcripts or secrets).

**First output:** a small offline diagnostic report or dashboard from already-recorded events, identifying **which stage is critical path**. Do not build a new event store if existing workflow files/transcripts suffice (ADR-0002).

Evidence: source-control engineering case study; Worfy bottleneck is an unmeasured hypothesis.

## G. P2 optional: independent-model review (Gemini/Meta/GPT)

**Observation.** Newer frontier models may create useful disagreement with Claude on architecture and review. Announced benchmark leadership is not directly transferable to Worfy's repo. Validate actual model IDs, access, prices, context limits, and data-use policies before every experiment.

**Useful experiment:** on a fixed corpus of *sanitized/synthetic* Ticket diffs and ADR conflict cases, compare a Claude-only review against an independent-family reviewer. Score valid, actionable new findings, false positives, cost and latency. Only then consider an opt-in external CLI integration.

**Security:** no raw private Worfy/Auction repositories, credentials, sensitive logs, or owned transcripts uploaded to another provider without explicit approval and checked service terms. Some model/provider plans have differing data-use defaults. Existing [worfy-review spec](../../.scratch/worfy-review/spec.md) explicitly defers cross-family review until there is an external CLI.

Provider sources to recheck: [OpenAI models](https://platform.openai.com/docs/models), [Gemini models](https://ai.google.dev/gemini-api/docs/models), [Meta AI](https://ai.meta.com/).

Evidence: model availability varies; no demonstrated better Worfy-specific performance.

## H. Monitor only (not implementation drivers)

- OpenAI's AI-generated mathematical manuscripts: important *autonomous-research* signal, but inaccessible internal model and independent evaluation of each mathematical claim is incomplete. No concrete Worfy feature follows.
- Autonomous cyber/vulnerability scanning and self-replication studies: lessons for permissions, boundaries and verification, not encouragement to relax Worfy's sandbox policy. Treat vendor findings as vendor findings.
- Public rankings claiming huge leads for Gemini Argon, Meta Muse Wonder, Mythos, or GPT: avoid copying stale/mixed-method benchmark tables into a spec. Require apples-to-apples independently reproducible evaluations.

## Suggested triage sequence for Claude (no automatic implementation)

1. **Audit existing coverage:** locate actual implementation/tests/ADRs for SDK resume, background events, Gate, compaction, Session state, journal/review and eval. Produce `already done / partially done / missing` with paths.
2. **Pick ONE high-signal gap:** likely runtime compatibility tests, if not already covered. Write a tiny proposed experiment/fixture and expected evidence; no live changes until approved.
3. **Evaluate reset hypothesis** on past stalled Ticket traces offline. Explain whether existing bounded retry already solves the same case.
4. **Evaluate model-routing economics** in a consented, cost-capped replay corpus.
5. Park Managed Agents and cross-provider review until there is evidence that either beats the current system on a Worfy-relevant metric.

**Requested outcome:** a skeptical technical assessment and maybe a *proposal* for additional Epic/Ticket-s, with sources, tradeoffs, experiment costs and no duplicated functionality. This research PR itself is **not** a command to merge, start paid trials, modify Profiles, or alter accepted architecture.
