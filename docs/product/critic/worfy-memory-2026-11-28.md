# Critic: worfy-memory — 2026-11-28

Plan: `docs/product/claude-projects-parity/drafts/worfy-memory.md`
Verdict: Keep — the cut into seven tickets and their order stand (rules and the Autopilot guard ship first, the Claude memory section follows its reader); the objections change what tickets 1 and 2 build and test, not their place.

## Objections

### 1. "A Session without a person" is not fixed at launch: the Autopilot Orchestrator Session goes back to the owner in the same process, and a guard built at launch keeps refusing

Fact: `src/main/agent/orchestrator.ts:416-427` — "The unattended Session goes back to a person as it runs (worfy-autopilot-queue ticket 08): attended, in the Node's own settings, with no new process" (`session.becomeAttended`); `src/main/agent/session.ts:1030` — "Read by the driver at each permission request: becomeAttended turns it false in the running process"; while `src/main/vendors/claude/options.ts:819-820` builds the PreToolUse hooks once, when `query()` starts, and the plan's guard is "the same mechanism as the Product Session" (`productGuard`, chosen at launch from `input.kind`).

Judgement: Built like `productGuard`, with the "is there a person" value fixed at launch, the memory guard keeps refusing the owner's "remember this" after a stopped run hands the Orchestrator Session back. That breaks story 18 in exactly the Session where the owner's decisions are written down. Ticket 2 should read the live `unattended` value at each call, as `liveCanUseTool` does (`src/main/vendors/claude/session.ts:255-262`). Seam 1 needs one more case: unattended at launch, attended in place, then the write is allowed.

Owner decision: accepted — принимаю

### 2. The reader contract of ticket 1 departs from the runtime facts in the plan's own research note: bytes instead of UTF-16 characters, and a path rule without the 200-character hash and the config base

Fact: `docs/product/claude-projects-parity/research-память-claude-в-worfy-сейчас.md:216-217` — the runtime counts the 25 000 "bytes" as "длиной строки JS после trim, то есть в знаках UTF-16, а не в байтах UTF-8" (the index is 15 828 bytes but 15 369 characters, `:295`); `:188-192` — the base is `CLAUDE_CODE_REMOTE_MEMORY_DIR` or `CLAUDE_CONFIG_DIR` or `~/.claude`, and a name longer than 200 characters is cut and hashed; `:197` — "worfy кодирует ключи transcript-ов так же (`src/main/claude-home/registry.ts:50-56`)", where `projectDirName` already has that cut and hash. The draft says "строки, байты, предел 200 строк и 25 000 байт" (line 143) and "KB" (lines 101, 113), and its step 4 of the path rule (line 84) has neither the hash nor the base.

Judgement: Counted in UTF-8 bytes, an index with Cyrillic lines shows "over the limit" long before the runtime cuts anything, so warning story 9 fires on a false number. The section would then teach the owner to ignore it. A path rule written again from step 4 duplicates `projectDirName` and misses the long-path case. Ticket 1 should reuse `projectDirName`, take the base from the config variables, and count characters after trim. Its fixture needs a Cyrillic index and a path longer than 200 characters.

Owner decision: accepted — принимаю

### 3. The plan does not name worfy-harness-guarantees/06, the guard accepted today that judges writes to the same folder and records Claude memory as open on purpose

Fact: `.scratch/worfy-harness-guarantees/issues/06-guard-защищённые-области-в-любом-режиме.md` (open, Wave 4) builds a section of `harness/hooks/guard.mjs` that refuses writes to `~/.claude` in every mode, with the exception "память Claude Code (`~/.claude/projects/*/memory/`)", tests "память Claude Code … — allow", and adds the "Session без человека" marker to `sessionEnv` (`options.ts:780`); its spec, accepted 2026-11-28, says in story 9 "чтобы агенты по-прежнему … писали свою память" and under "Риски": "Память Claude Code открыта … Описано, не закрыто" (`.scratch/worfy-harness-guarantees/spec.md:310`, `:601-603`).

Judgement: After both epics ship, Autopilot has two PreToolUse guards with two Bash path parsers, and each answers differently for the same memory path. The accepted spec and its done-criteria will still say memory is open, and the two ADRs will describe one folder in opposite words. Objection 1 says this plan's SDK hook is the right place, because an environment marker set at launch has the same problem `becomeAttended` creates. So nothing needs to move. The plan should name ticket 06 in "Не в этом Epic-е", or in its ADR line, and ask for one dated line in that spec: the memory exception holds only for a Session with a person, and worfy-memory/02 closes it for unattended Sessions.

Owner decision: accepted — принимаю

## Alternative

Fold the memory refusal into `harness/hooks/guard.mjs` as one more rule of worfy-harness-guarantees/06: ticket 2 becomes `Blocked by: worfy-harness-guarantees/06`, and the plan reuses 06's Bash path expansion, its Codex coverage and the refusal log of worfy-harness-guarantees/10 (Journal and Run history). This plan is still better. 06 sits in Wave 4 of another epic, so the guard would wait for that epic. And 06's marker is an environment variable fixed at process start, which cannot follow `becomeAttended` (objection 1). An SDK hook that reads the live value can, and it ships in Wave 1.

## What the critic cannot know

There is no product analytics. How often the owner gets an Autopilot Orchestrator Session back in place and then asks it to remember something is not known. How many memory writes Autopilot makes today is not known either, beyond the counts in the research note. The runtime facts (UTF-16 count, path rule, the "allowed for writing" decision) come from the research note's reading of Claude Code 2.1.322, not from a run by the critic. Whether a PreToolUse refusal from an SDK callback reaches subagents inside Workflow agents was not checked here. The worfy-harness-guarantees spike 01 shows `PreToolUse` reaching a subagent's Write.
