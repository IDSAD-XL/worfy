# Proposal: twelve product-engineering capabilities for worfy

> **Status:** ideation / review only. **Not implemented, not approved for implementation.** Created 2026-11-07.
>
> **Origin:** follow-up to the previous conversation and [eight autonomy proposals (PR #1314)](https://github.com/IDSAD-XL/worfy/pull/1314). This document is deliberately separate from those eight concepts. The goal is critical technical review and prioritization, not immediate Ticket creation or a roadmap commitment.
>
> **Important distinction:** this document describes *proposed* behavior. Links to existing features document real capabilities. No test results, UI screenshots, or implementation progress are claimed for these proposals.

## Why now

worfy already orchestrates Epic, Ticket, Wave, Session, Subagent and multi-Epic Autopilot runs. The current stack includes Codex support, Auto-continue, permission policies, Run history / Flight Recorder, Work track, Evidence and failure records. These make unattended **execution** increasingly capable.

The next product problem is different: how to establish that agents built the **right product**, maintained its nonfunctional properties, preserved real user data, and chose worthwhile work. This batch focuses on autonomous **engineering and product judgment**, rather than adding another provider or duplicating the existing observability mechanisms.

Useful baselines: [concepts](../features/concepts.md), [workflow](../features/workflow.md), [autopilot](../features/autopilot.md), [evidence](../features/evidence.md), [gate](../features/gate-and-github.md), [Flight Recorder](../features/flight-recorder.md), [Work track](../features/work-track.md), [Browser](../features/browser.md), [run planning](../features/run-planning.md), and [feature docs](../features/README.md).

## Guardrails shared by all twelve

1. **No silent feature implementation.** Proposals are advisory until the owner explicitly accepts an Epic/spec. A generated plan or test finding is not permission to change application code.
2. **Keep existing ownership boundaries.** worfy is a view/controller over the Project workflow; the Harness / agents perform repository modifications. Respect [ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md) and [ADR-0005](../adr/0005-worfy-own-state-inventory.md). Proposed UI must not secretly mutate Project workflow files.
3. **Explain evidence, uncertainty, and failures.** Claims link to a reproducible command, artifact, commit, baseline, or source. Distinguish *failed*, *not run*, *inconclusive*, and *passed*. Never silently equate CI green with user-intent correctness.
4. **Secure test execution.** Exploration and bisect run in isolated worktrees/sandboxes with scoped permissions. Generated data is synthetic; no production DB, credentials, or destructive production action.
5. **Cross-vendor and cross-platform by design.** Do not assume a Claude-only transcript or tool protocol. Where behavior depends on the vendor, platform, environment, or missing data, show that limitation.
6. **No invented precision.** Forecasts or scores need sample size, confidence, and calibration; heuristics are labelled heuristics. Treat flaky outcomes as uncertain.

## At a glance

| # | Proposal | Complexity | Initial priority | Main goal |
|---|---|---|---|---|
| 01 | Intent-to-Behavior Contracts | High | P0 discovery | Validate desired product behavior, not just implementation tests |
| 02 | Ambiguity Gate | Medium | P1 | Catch requirements decisions before multiplying into downstream work |
| 03 | Scenario Forge | Medium | P1 | Generate coherent realistic test states |
| 04 | State-Space Explorer | Very high | P2 research | Explore product transitions and invariants |
| 05 | Causal Regression Bisector | Medium | P0 pilot | Find the change that introduced a reproducible regression |
| 06 | Architecture Fitness Functions | Medium | P0 pilot | Make enforceable architecture rules executable |
| 07 | Performance Envelope | Medium | P1 | Prevent gradual user-facing performance regressions |
| 08 | Platform Differential Testing | High | P1 | Validate behavioral parity of macOS and Windows |
| 09 | Migration Guardian | Medium | P1 | Preserve user data between product versions |
| 10 | Dependency Migration Pilot | High | P2 | Plan and verify dependency/SDK upgrades in isolation |
| 11 | Security Boundary Auditor | High | P1 research | Audit the built product's trust boundaries |
| 12 | Autonomous Roadmap Critic | Very high | P2 research | Challenge low-value work without changing owner strategy |

Priority is a proposal for discussion, not an approved schedule. Complexity describes relative engineering effort, not an estimate.

---

## 01. Intent-to-Behavior Contracts

**Problem.** A Ticket, CI job, Gate and reviewer can all be green while the user-visible behavior is wrong. Existing [Evidence](../features/evidence.md) records *what was checked*. It does not, by itself, define an independent, enduring contract for *what the user meant*.

**Concept.** A Feature owns versioned, executable behavior contracts that translate owner-approved requirements into externally observable outcomes and invariants. Agents implement Ticket-ы; a separate verification path checks the original behavior contract.

**Example.** For a Pipedrive-like CRM: create a deal in stage A; move it to stage B; restart; verify stage B persists; verify another user without permission cannot view it. A CRUD endpoint responding 200 is insufficient.

**Possible MVP.**
- Store a small declarative list of scenarios adjacent to existing Feature documentation or in an explicitly approved Project-owned contract file; do not create another hidden source of truth.
- Link each scenario to the originating requirement, a deterministic fixture, an executable test command, and Evidence refs. Harness executes tests; worfy visualizes results.
- First pilot: 3–5 high-value user journeys in one Project, including at least one negative authorization or persistence case.
- Show Passed / Failed / Unverified / Stale, where Stale means a relevant requirement or interface changed since the contract was approved.

**Acceptance signal.** A deliberately incorrect but CI-green implementation fails the independent behavior contract. A correct implementation passes. Each outcome is linked to the scenario, exact run, environment and revision. An unexecuted contract cannot appear green.

**Risks.** The same agent might encode its misunderstanding into both feature and tests. Owner review of the contract, independent fixtures and adversarial negative tests mitigate this; they cannot eliminate specification mistakes.

**Relationship to existing ideas.** Extends, but does not replace, PR #1314's Proof-Carrying Tickets. Evidence explains what ran; the contract establishes what should hold.

## 02. Ambiguity Gate

**Problem.** A long Epic can be internally consistent yet based on an early arbitrary interpretation of an underspecified requirement. The cost grows across subsequent Wave-ы.

**Concept.** Before an Epic's plan is accepted, detect decisions with multiple plausible and materially different interpretations. Record alternatives, affected Feature-ы and scope, safe assumptions, and the minimal decision needed from the owner.

**Example.** "Duplicate contact" might mean identical email, case-insensitive email, or a composite of email + organization. Those imply different storage constraints and UX.

**Possible MVP.**
- Harness scans a proposed Epic/spec before acceptance and produces an "ambiguity register": quoted requirement, interpretation A/B, consequences, suggested default, severity and affected Ticket-ы.
- Severity distinguishes wording-only ambiguities from those that could cause irreversible data/model choices.
- Allow planning and implementation of independent Ticket-ы; block only affected branches until a critical decision is recorded by the owner.
- Decisions link to the spec or ADR rather than a separate invisible LLM memory.

**Acceptance signal.** Seed three ambiguous requirements with different risk levels; system identifies the conflicting interpretations with source quotes, leaves unaffected Ticket-ы runnable and never writes owner approval on its own.

**Risks.** Endless clarification questions and hallucinated ambiguity. Use a threshold for material consequences, combine duplicate questions and treat model confidence as advisory.

**Relationship.** Complements existing owner-acceptance workflow; not a replacement for it.

## 03. Scenario Forge

**Problem.** Generated test data is often unrealistic: invalid relations, impossible business states, identical fixtures, poor boundary coverage. Large product workflows appear to work until real-world combinations occur.

**Concept.** Generate *coherent test worlds* from schemas, constraints and domain rules: users, roles, relations, historic events and edge conditions.

**Example.** A CRM contains 100,000 deals belonging to multiple organizations, archived users, delegated permissions, duplicates, import errors and long activity chains. A geometry app contains large nested scenes and pathological boundary shapes.

**Possible MVP.**
- Parse a schema and accepted invariants, then generate a deterministic seeded fixture with configurable size.
- Validate every generated world against DB constraints and explicit domain rules before running product tests.
- Define a few scenario classes: typical, empty, boundary, adversarial and load. Output metadata: seed, generator version, schema revision.
- Integrate with Behavior Contracts rather than making a competing test runner.

**Acceptance signal.** Same seed reproduces the same valid world; invalid generator output is rejected and reported. One controlled product defect is detectable only in a boundary world, not in a trivial happy path.

**Risks.** A schema does not fully specify business semantics. Generated load must be bounded and use ephemeral synthetic data. No production personal data.

## 04. State-Space Explorer

**Problem.** e2e follows known routes; many real bugs occur across unexpected transitions, interruptions and role changes.

**Concept.** Model the running product as observable states, actions, guards and invariants. Explore high-value unvisited transitions and minimize any failing sequence into a reproducible scenario.

**Example.** Save twice, disconnect network, switch role, reopen window, restore connection. Does the previous user's unsaved edit leak into the next session?

**Possible MVP.**
- One bounded workflow on a dedicated test build, with seeded fixture, limited actions and a reset operation.
- Capture an abstract state hash, not raw pixels; record transitions and violations of invariants.
- Use breadth-first or coverage-guided traversal with budgets for time, states and actions. Record unknown/non-deterministic branches.
- Save the shortest reproducible failing action sequence as an executable test candidate.

**Acceptance signal.** Discover an injected transition bug outside existing scripted e2e; replay the minimized sequence on a fresh test state. Exhaustion / low coverage is reported honestly, never as proof of absence of defects.

**Risks.** State explosion, destructive actions and nondeterministic UI. Requires strong resets, scopes and safety policies.

**Relationship.** Different from PR #1314's Autopilot Chaos Lab, which tests the resilience of worfy's *agent execution system*. This explores the *product under development*.

## 05. Causal Regression Bisector

**Problem.** [Failure records](../features/gate-and-github.md) identify and help rerun failures; they do not automatically find the revision that introduced a confirmed regression.

**Concept.** Given a reproducibly failing test and a known-good revision, run a guarded git bisect across candidate commits and report the earliest change that flips the outcome.

**Example.** A previously green e2e on Windows now fails in File picker. The bisector isolates one path-normalization change instead of repeatedly asking an agent to inspect the entire log.

**Possible MVP.**
- Input: test command, good/bad refs, isolation requirements, reproducibility attempts and timeout.
- Run candidate revisions in disposable worktrees; restore dependencies and fixtures as needed; record skip/inconclusive separately from good/bad.
- Only start after demonstrating that the known-good and known-bad ends are meaningfully different under comparable environments.
- Link the result to the commit, relevant diff, exact commands, logs and a proposed repair Ticket for owner review.

**Acceptance signal.** On a seeded regression across a small commit range, returns the injected culprit; refuses to claim causation when a flaky test or incomparable environment makes the range inconclusive.

**Risks.** Expensive builds, nondeterministic external services, database migrations and source history that cannot rebuild. Never modify the active working tree or automatically revert the culprit.

**Relationship.** Extends current Failure records and the earlier Failure Intelligence idea: diagnostic **bisect** is narrower and causally testable.

## 06. Architecture Fitness Functions

**Problem.** ADRs and reviewer lenses encode architectural intent, but can be violated gradually without the review noticing.

**Concept.** Express selected architectural boundaries as machine-enforceable rules, versioned in the Project, with explicit justifications and exceptions.

**Example.** Renderer must not import Node filesystem functions; domain modules must not depend on persistence adapters; vendor-specific APIs must remain behind adapters; cross-process IPC must be schema validated.

**Possible MVP.**
- Start with static dependency/import rules and banned boundary crossings, then add a small number of custom checks for verified patterns.
- Include rule ID, ownership, cited ADR/Feature, allowed exceptions and failure samples.
- Harness runs the checks as part of the existing Gate, maintaining green/red/unverified semantics; no second merge authority.
- Show newly introduced breaches separately from known baseline debt.

**Acceptance signal.** A deliberate disallowed import causes a precise rule failure linked to the governing ADR; an approved exception is auditable and scoped.

**Risks.** Rules can ossify a bad architecture. Avoid fuzzy LLM judgments as hard Gate blockers; ambiguous findings go to review.

## 07. Performance Envelope

**Problem.** Functional correctness does not prevent slow cumulative degradation in large Project-ы, transcripts, Canvas layouts or startup.

**Concept.** Add scenario-specific performance budgets and compare changes against a verified baseline under the *same* machine class and conditions.

**Example.** Open a Project with thousands of Node-ов, search a large transcript, scroll a populated Canvas, and restart with several Browser-ов. Track median and tail latency, memory and dropped frames.

**Possible MVP.**
- Define 3–5 deterministic user journeys, fixtures and target budgets.
- Collect repeat samples, warm/cold distinctions, resource counters and environment metadata; compare paired baselines and changes.
- Show percent change plus uncertainty, not a single flaky value.
- Make a meaningful regression advisory first; only enforce budgets after sufficient baseline data and owner approval.

**Acceptance signal.** A controlled slowdown is flagged with reproduction command and measured delta; noisy differences within expected variance are not treated as failures.

**Risks.** Different machines, thermal throttling, background load and nonrepresentative fixture size; false confidence from microbenchmarks.

## 08. Platform Differential Testing

**Problem.** macOS and Windows can pass their own tests while still producing semantically different results for the same workflow.

**Concept.** Run an equivalent scenario on two configured Machines, normalize platform-specific details and compare *behavior*, not pixel identity.

**Example.** Create the same Project, add a local file, open a Terminal, run a shell-integrated operation and reopen it. Compare persisted state, error category, permissions and user-observable outcome on Mac and Windows.

**Possible MVP.**
- Reuse Machine Link and existing per-platform CI/e2e, but do not assume Linked machines are automatically safe test sandboxes.
- Use the same seeded fixture/spec and a shared structured result schema for state, side effects and errors.
- Normalize only documented expected differences (path separators, native dialogs, timings); show all other mismatches.
- Run one end-to-end cross-platform workflow in isolated test directories.

**Acceptance signal.** Inject a Windows-only behavior mismatch and detect it with linked paired traces. A platform unavailable for execution yields Unverified, not Passed.

**Risks.** Environment drift, OS permissions, test runner version differences, high execution cost. Avoid leaking one Machine's secrets to the other.

## 09. Migration Guardian

**Problem.** A new version can start successfully while silently corrupting, dropping or rewriting older user data.

**Concept.** Preserve a corpus of real-format but sanitized/synthetic historical fixtures and verify read/upgrade/write/reopen behavior across versions.

**Example.** A desktop app opens a document created by version N-3, edits one field, saves, and still preserves unknown metadata and references. Database migration also supports a safe rollback strategy or explicitly states when rollback is impossible.

**Possible MVP.**
- Store fixture formats with a declared originating version and expected invariants (field preservation, referential integrity, file compatibility).
- Exercise the migration in disposable copies; compare semantic state rather than bytes only.
- Report whether a format is forward-readable, upgraded in place, or requires a separate export/import.
- Make destructive irreversible migrations a manual approval checkpoint.

**Acceptance signal.** Detect an intentionally introduced data-loss bug and identify which historical fixture and invariant failed; source fixtures remain untouched.

**Risks.** Sensitive datasets, hidden version-dependent defaults, incomplete fixtures and incompatible downgrade assumptions. No tests on production data.

## 10. Dependency Migration Pilot

**Problem.** SDK, Electron and toolchain upgrades require coordinated code edits, tests and interpretation of breaking changes. Compiling is not sufficient to prove safe migration.

**Concept.** A controlled assistant proposes an update Epic: impacted APIs, dependency graph, breaking changes, validation plan and rollback route; only after explicit acceptance does an agent implement in a dedicated branch.

**Example.** A change in Codex app-server or Claude SDK alters Session events. The Pilot detects affected adapter contracts, updates fixtures and runs a cross-vendor parity suite before suggesting merge.

**Possible MVP.**
- One allowlisted dependency with a manually chosen target version.
- Read the changelog and local API usages, identify breaking points and emit a reviewable plan.
- Run the upgrade in an isolated worktree with existing tests, targeted contract checks and behavioral scenarios.
- Compare baseline and upgraded functionality; produce a diff summary and open PR only with owner-approved execution.

**Acceptance signal.** A deliberate breaking change is caught by a targeted contract test and cannot be reported as a clean upgrade merely because typecheck passed.

**Risks.** Supply-chain security, changing transitive dependencies, misleading changelogs and mass auto-updates. Never fetch/run arbitrary postinstall hooks without policy.

## 11. Security Boundary Auditor

**Problem.** [Auto-approval](../features/autopilot.md) protects what worfy's agents may execute. It does not audit whether the *product being developed* respects its own trust boundaries.

**Concept.** Identify product-level trust boundaries and validate selected ones with static rules and safe local negative tests: authorization, untrusted input, IPC isolation, secret exposure and external navigation.

**Example.** A role without access must not retrieve another user's deal by guessing its ID. An Electron renderer must not gain unrestricted filesystem access from an untrusted page.

**Possible MVP.**
- Owner approves the target scope, boundaries and allowed test methods.
- Map source/sink and privilege boundaries, then run bounded local checks in a test environment against synthetic data.
- Require a minimal reproducible case with the affected route/function, impact and exact conditions.
- Do not ship speculative LLM "vulnerabilities" as confirmed findings.

**Acceptance signal.** Detect and reproduce a deliberately introduced authorization bypass or unsafe IPC route in a local test fixture; no attack against third-party systems or live production.

**Risks.** False positives/negatives, dangerous scans, sensitive findings and accidental publication of exploit details. Findings require appropriate disclosure and explicit human triage.

## 12. Autonomous Roadmap Critic

**Problem.** The system may become excellent at implementing a plan whose next items have little user value, or whose assumptions have become obsolete.

**Concept.** An advisory technical-product reviewer evaluates the *next planned Epic* against approved Project goals, unresolved failures, user-facing pain, evidence quality, dependency risk and opportunity cost. It recommends Keep / Reorder / Split / Defer / Replace with reasons.

**Example.** A queue contains ten polish Ticket-ы while critical persistence bugs remain. The Critic recommends moving a verified data-loss issue earlier, explains the tradeoff and lists which assumptions would change the decision.

**Possible MVP.**
- Explicit owner-authored Project objectives and constraints; no implicit "maximize growth" metric.
- Read only already approved Epic plans, known issues, Evidence and Work track.
- Produce two or three *alternative* next-step plans with traceable evidence and explicit assumptions.
- Owner selects or rejects a plan. No automatic rewrite of priorities, specs, Tickets or active Run queue.

**Acceptance signal.** In a controlled case, the Critic identifies a higher-value blocked dependency, cites original evidence and preserves the owner's original plan until approved.

**Risks.** Poorly specified success metrics, optimizing proxies instead of outcomes, overconfident value estimates and stealing decision authority from the owner. If evidence is insufficient, say so rather than invent ROI.

---

## Proposed sequencing and integration

### Near-term experiments (low-cost evidence)

1. **Causal Regression Bisector** — prototype using existing failure records and a seeded regression; small, measurable causal result.
2. **Architecture Fitness Functions** — start with 2–3 deterministic import/boundary rules and an intentional violation.
3. **Intent-to-Behavior Contracts** — discovery followed by one narrow end-to-end product journey. Do not begin with a broad generic contract DSL.

### Next wave, after primitives prove useful

4. **Ambiguity Gate** and **Scenario Forge** feed the reviewed behavior contracts with better decisions and fixtures.
5. **Performance Envelope** and **Migration Guardian** protect nonfunctional and historical behavior.
6. **Platform Differential Testing** builds on repeatable seeded scenarios and platform-specific execution.
7. **Security Boundary Auditor** starts with a narrow, owner-authorized trust boundary and deterministic checks.

### Research first

8. **State-Space Explorer** — prove state abstraction, reset and bounded exploration before investing in generality.
9. **Dependency Migration Pilot** — design permission, supply-chain and rollback policies before autonomous changes.
10. **Autonomous Roadmap Critic** — require explicit owner goal definitions and good data quality before recommendations.

This is **not** a claim that all 12 should be built. The objective is to choose a subset after review and measure real benefit.

## Clarifying what is *not* already covered

| Existing capability / previous idea | This proposal's additional scope |
|---|---|
| Evidence / Proof-Carrying Tickets (PR #1314) | **Intent-to-Behavior Contracts:** independent expected user behavior rather than only proof attached to finished Ticket-ы |
| Failure records / Failure Intelligence (PR #1314) | **Causal Regression Bisector:** reproducible controlled commit-level regression attribution |
| Existing ADR / review lenses / Feature pages | **Architecture Fitness Functions:** enforceable deterministic boundary checks |
| Existing Gate, e2e, Browser | **Scenario Forge** and **State-Space Explorer:** valid synthetic worlds and novel transition exploration |
| Autopilot Chaos Lab (PR #1314) | **State-Space Explorer:** test the *created application*, not worfy's unattended execution |
| Cross-machine gate / Windows tests | **Platform Differential Testing:** same scenario, structured comparison of product outcome |
| Current Run Planning / Limits | **Autonomous Roadmap Critic:** value and priority recommendations, not execution resource forecasts |
| Agent permission Auto-approval | **Security Boundary Auditor:** vulnerabilities in the *target product*, not agents' tool authorizations |

## Questions for Claude / maintainer review

For **each** proposal:

1. Is its claimed gap real in current main, or already implemented/planned? Cite concrete files, Feature pages, ADRs and relevant Ticket-ы.
2. Can the MVP be built within the existing Project/Canvas/Harness/Agent/Gate ownership model? Flag any accidental writes into workflow from worfy main.
3. Which parts can be deterministic and testable without LLM judgment? Which require human approval?
4. What would *disprove* the claimed value in a one-week pilot? Include explicit evaluation metrics and failure criteria.
5. Estimate risk/complexity, coupling, vendor/platform differences and likely maintenance burden. Recommend **pilot / research / defer / reject**.
6. Identify overlap with the eight ideas in [PR #1314](https://github.com/IDSAD-XL/worfy/pull/1314) and current work, and propose merges or simplifications if needed.

**Do not** create implementation Ticket-ы, modify ADRs, run unapproved high-risk experiments, or auto-merge this document without an explicit owner decision.

## Verification for this proposal PR

Documentation-only addition. No runtime code, configuration, tests, claims of screenshots, or new application behavior. Check links and Markdown structure during review; tests are not evidence of feature implementation.
