# Claude Projects parity and native memory — product discovery proposal

Date: 2026-11-26. Status: proposal for Product Session, not an accepted specification or implementation authorization.

## Product intent

Make worfy no harder than stock Claude for simple work, and materially more capable for complex work. Users should not surrender familiar conveniences when migrating. Copy useful interaction patterns, not necessarily Anthropic's orchestration architecture. Preserve vendor independence, Harness, Autopilot, Evidence Matrix, Acceptance, Continuity, Flight Recorder and Product Sessions.

Tester observation: Canvas navigation, automatic Layout, Subagent trees, open Sessions and Epic frames are rarely useful to testers; interactive HTML Cards are useful. Treat this as qualitative evidence, not measured usage. Do not remove Canvas or change the canonical Project model without owner acceptance.

## Competitive baseline and parity inventory

Reference: [Claude Projects](https://code.claude.com/docs/en/claude-projects). Previous discussion identified the following comparison hypotheses; verify against current docs, installed SDK and actual worfy behavior before opening implementation Tickets.

| Capability | Existing worfy foundation / suspected gap |
|---|---|
| Persistent project coordinator, parallel isolated threads, direct worker access | Orchestrator, Sessions, worktrees; simplify entry and routing |
| Follow-up routing, replies, proactive progress reports, grouped work states | Orchestrator, Continuity, Assistant; unify UX |
| Multiple repositories, instructions, shared context | Project, Harness, Profile, HANDOFF; add discoverable project memory |
| Project library, attachments, generated artifacts | Cards and project files; unified Library |
| Local/cloud execution, mobile access | Local Sessions and Linked Machines; headless/cloud/mobile gaps to verify |
| Environment/secrets, MCP, Skills, Plugins, per-agent model | Existing Integrations and vendor configuration; audit parity and defaults |
| Limits recovery, parallelism, usage | Autopilot, Waves, Limits; improve per-project/session usage breakdown |
| PR Follow, CI repair, review, archive | Existing mechanisms; audit UX parity |
| Scheduled work, project pause, suggested tasks, project import | Assistant scheduling foundations; verify gaps |
| /btw, /fork, snooze, resolve/reopen, sharing | Verify actual support; add missing conveniences |

Do not claim that Claude lacks autonomous execution or that worfy is superior without evidence. Compare identical requirements, model, starting repository and budget (e.g. CRM benchmark): accepted requirements, regressions, interventions, tokens/cost, elapsed time and recovery.

## P0 — Project Conversation and smart routing

Reuse Orchestrator where feasible rather than creating a competing coordinator. A persistent Project Conversation accepts plain-language requests, answers directly, routes follow-ups to existing Sessions, delegates new work, or starts Product Session / structured workflow as appropriate. Provide explicit @Session and reply-to-result targeting, routing visibility and correction. Ad hoc fixes must not require Epic creation; complex work retains Epic, Ticket, Waves, Autopilot and Acceptance. Report meaningful milestones, blockers and decisions in the conversation without flooding it with internal events. Show compact linked work items with status, direct Session access, PR, Changes and Acceptance.

Assistant remains cross-Project attention management (Slack/Jira/CI, decisions, scheduled work); Project Conversation owns project-local coordination. Avoid duplicate authority, duplicate launches and context leakage.

## P0 — Canvas and Library

Test Canvasless Mode as an opt-in alternative before irreversible redesign. Project Overview / Work shows active work, attention requests, results and recent Sessions. Hide Subagents and technical execution details by default; expose them in Session details / Flight Recorder. Keep Epic/Ticket lists, search, filters, archive and direct links. Preserve Canvas for spatial comparison, research, diagrams and interactive Cards; avoid automatically moving user-positioned Nodes. Use adaptive grid/list for Library and free placement for Canvas. Open Canvas on demand when a visual task benefits.

Library and Canvas should be views over the same Card identities, not duplicate stores. Include files, reports, screenshots, evidence, prototypes, live Cards, thumbnails, search, filters, versions, originating Session/Ticket/PR, comments, pinning and context attachments. Support side-by-side alternatives, annotation, version comparison, approval and conversion of accepted designs into structured work. Preserve old versions. Consider Generative Workspace: agents produce task-specific interactive surfaces rather than exposing their internal graph.

Measure time to find work, navigation steps, Card usage, Canvas openings, task completion and user preference. Compare existing UX against the alternative; do not assume chat-first is the final answer.

## P0 — Native Memory Integration (Claude first)

Continuity restores unfinished work; context management manages current context; automatic memory preserves durable lessons for future independent Sessions. Native memory can reduce repeated investigation, repeated errors and user corrections; benefits must be measured, not assumed. Memory is not model training.

References:
- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/agent-sdk/claude-code-features
- https://code.claude.com/docs/en/agent-sdk/overview
- https://code.claude.com/docs/en/claude-projects

Documented Claude Code pattern: local Markdown memory directory, MEMORY.md index and topic files, bounded startup index and on-demand reading; user, feedback, project and reference categories. Verify exact limits and categories against installed runtime. Store durable preferences, rationale, lessons and external references, not readily discoverable source tree facts or stale implementation details. Claude Projects cloud memory is distinct; no public SDK interface to reuse it was established in our discussion.

### Discovery spike (blocking)

Inspect actual Claude Provider query() configuration, SDK/runtime version, cwd, environment, systemPrompt, settingSources, permissions, Hooks and Harness. Determine whether native memory is already active, including settingSources: [] and custom system prompts. Verify autoMemoryEnabled, autoMemoryDirectory, CLAUDE_CODE_DISABLE_AUTO_MEMORY and CLAUDE_CODE_PROJECT_DIR_NAME support and semantics; do not blindly change settings or import user/project/local settings, which could alter permissions or Harness. Prefer documented configuration and minimal changes. Verify Read/Write/Edit behavior and actual path resolution. Do not assume SDK exposes dedicated memory events.

Run isolated reproducible tests:
1. Teach a harmless unique durable preference; inspect actual file changes; start a fresh Session and test recall without prompting the answer.
2. Compare enabled/disabled, preset/custom prompt and settings configurations; verify explicit opt-out.
3. Test same repo, worktrees, distinct repos in one Project, unrelated Projects, ordinary Subagents, forked Subagents and Linked Machines. Confirm isolation and actual inheritance, not assumptions.
4. Run concurrent writers, conflicting updates, crashes and restarts; verify no lost updates, corrupt index or cross-project leakage.
5. Test memory read/write permissions and malicious instructions in external data; verify memory cannot override Harness, Profile, permissions or approved specs.
6. Measure recall quality, false memories, repeated corrections, tokens, latency and storage growth on representative tasks.

### Native-first implementation

Use native Claude extraction, indexing and retrieval wherever proven. No embeddings, vector database, separate extraction agent or Codex implementation in initial scope. Provide a vendor-neutral boundary only as needed for future portability. Keep existing Claude behavior compatible; do not silently change memory location or overwrite existing user memories.

P0 UI: inspect actual memories, search/filter, edit/delete, enable/disable, show location and scope, provenance where observable, and record verified changes in Flight Recorder. Show saved/recalled indicators only when supported by actual events or evidence; distinguish inferred reads from confirmed reads. Provide explicit remember/forget semantics and verify deletion propagation. Avoid logging secrets or private memory content unnecessarily.

P1 scope: User preferences, logical Project knowledge across repositories, repository-specific engineering knowledge, agent-role lessons. Native scope may be repo-local; design controlled aggregation or context injection only after spike. Distinguish preferences, product context, engineering conventions, lessons, decisions and transient active context. Link durable records to Session/Ticket/PR/ADR when available. Memory never overrides authoritative workflow documents or security rules.

P1 concurrency and Linked Machines: define ownership, atomic updates, conflict resolution, deduplication, stale record handling, provenance, retention, access control, opt-in sync, deletion propagation and recovery. Avoid sharing credentials or unrelated Project data. Evaluate native concurrent writes before designing synchronization.

P2 curation: compare Native (direct writes), Curated (proposals verified by curator), Hybrid (interactive agents may write; autonomous Workers/Subagents propose shared knowledge). Start native in a controlled experiment, not unrestricted shared writes. Consider periodic consolidation only if observed data warrants it. Guard against false conclusions, duplication, poisoning, prompt injection and outdated facts. Future Codex adapter is explicitly deferred.

P2 Harness Eval integration: extract recurring corrections and failure patterns into proposed Harness/Skill/Hook/test changes; evaluate on reproducible tasks and require owner approval. No autonomous policy changes from memory. Compare native memory on/off and curated variants; measure accepted outcomes and cost.

## P0 — Scheduled Tasks

Extend existing Assistant Check Scheduler, Duties, Wake Planner and Autopilot rather than duplicating scheduling. User-defined schedules and event-triggered work, creation from conversation, Project/host/model selection, tool allowlist, budget, confirmation policy, timezone, history, pause/cancel, missed runs, deduplication and retries. Examples: weekly performance audit, daily merged PR review, Friday progress report, periodic stalled Ticket check. Respect explicit approvals and prevent untrusted connector content from becoming executable instructions.

## P1 — Session convenience parity

Audit before implementing: /btw side questions without polluting main context; /fork from selected point; snooze/resume, resolve/reopen, recent threads, searchable archive, artifact previews, safe transcript export/read-only sharing, per-Project notification settings, Project goal, pause Project (stop new launches, define safe handling of active work), continue existing Session in Project, dynamic repository attachment, persistent context files/folders, restart coordinator without stopping Workers, per-role model defaults, per-Session/Project/Ticket usage and cost, environment/secrets UX. Google Drive or other external context via existing Integrations where appropriate. Preserve direct access for power users.

## P1 — Smart onboarding

Analyze repository read-only; detect stack, package manager, build/test commands, CI, existing CLAUDE.md/AGENTS.md and conventions. Propose Harness/Profile setup and integrations, project memory and suggested first tasks with Start / Start all. User approves changes and external access. Progressive disclosure: no mandatory workflow terminology for first simple task.

## P1 — Headless execution and mobile companion

Investigate Execution Host abstraction over Local, Linked Machine, headless runtime/VPS and future managed Cloud. Start with headless feasibility, not a commitment to hosted infrastructure. Preserve Harness and permissions across hosts; validate provider auth/terms, secrets, sandboxing, reconnect, checkpoints, host failure, data locality and remote access. Mobile/web companion focuses on Assistant attention, Project Conversation, Session status, PR/Changes, approvals, Acceptance and notifications; no requirement to port Canvas. Verify Linked Machines limitations and reuse existing infrastructure.

## Roadmap and decision gates

Candidate discovery Epics (names and priorities provisional):
- P0 worfy-project-conversation (routing and simple/structured modes)
- P0 worfy-native-memory (Claude SDK spike, native UI and controls)
- P0 worfy-library (Card/file catalog and Canvas experiment)
- P0 worfy-scheduled-tasks (reuse Assistant)
- P1 worfy-session-parity (audit stock conveniences)
- P1 worfy-smart-onboarding
- P1 worfy-headless, then worfy-mobile
- P1 memory scopes, concurrency and sync; P2 curation/Harness Eval and future Codex adapter.

Keep feature parity as an ongoing competitive audit of official changelogs and documentation (Claude and eventually Codex), compare against Feature pages and actual runtime, propose Product Session work; no automatic implementation. Prioritize measurable user friction and reliability over feature count. Preserve deterministic dependency graph, enforced limits, permissions, evidence-based completion, multi-vendor support and recovery rather than copying prompt-only controls.

Before acceptance: inspect current implementation and existing Epics to avoid duplication; verify all competitor claims against current documentation; run manual parity scenarios; decide Project Conversation vs alternative Work-first UX based on tester evidence; approve memory spike findings and security model; split into Tickets with dependencies and acceptance criteria only after owner review.

This document consolidates prior product discussion. No runtime code changed, no benchmark or SDK experiment performed, and no proposed priority is an accepted roadmap.
