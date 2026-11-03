// What a hook input says about Codex. Codex installs the Harness from
// the same plugin folder as Claude Code and runs the same hooks/hooks.json, so a hook tells the two
// apart by its input. The pinned Codex (0.166.0, codex-rs/hooks/src/schema.rs at rust-v0.166.0):
//   - PreToolUse, Stop, SubagentStop, SubagentStart, UserPromptSubmit carry `turn_id`, a field the
//     schema marks "Codex extension"; Claude Code's input has no such field;
//   - SessionStart and SessionEnd carry no turn_id, but their transcript is a Codex rollout file,
//     <CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<time>-<thread>.jsonl; Claude Code's is <session>.jsonl;
//   - `agent_type` names the agent inside a Subagent only (PreToolUse, SubagentStop); the agents of
//     the Harness are worfy-implementer, worfy-reviewer and worfy-scout (the Codex agents worfy writes).
// Inputs a live Codex gave are recorded in test/fixtures/codex-messages/hooks/ of the worfy repository.

import path from "node:path"

/** True when `payload` (the parsed hook input) comes from Codex. */
export function isCodexInput(payload) {
    if (!payload || typeof payload !== "object") return false
    if (typeof payload.turn_id === "string") return true
    const transcript = payload.transcript_path
    // The base name by both separators: a Windows path keeps its backslashes on any system.
    return typeof transcript === "string" && /^rollout-.*\.jsonl$/.test(path.win32.basename(transcript))
}

/** The agent of a Codex Subagent (`agent_type`), or "" outside a Subagent. */
export function codexAgent(payload) {
    const value = payload && typeof payload === "object" ? payload.agent_type : undefined
    return typeof value === "string" ? value : ""
}

/** The agents of the Harness that edit no file: their file-editing tool is denied on Codex. */
export const READ_ONLY_AGENTS = new Set(["worfy-reviewer", "worfy-scout"])

/** True for an agent of the Harness (worfy-implementer, worfy-reviewer, worfy-scout). */
export const isHarnessAgent = (agent) => agent.startsWith("worfy-")
