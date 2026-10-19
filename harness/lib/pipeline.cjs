// The rules of a project's Pipeline, shared by bin/profile, which reads the field, and bin/profile-set,
// which writes it: one copy of the rules, so a Pipeline the writer accepts is one the reader accepts.
//
// The Pipeline is the list of Stages a ticket goes through, built from a fixed catalogue of kinds.
// Each kind has its predicate in code, not in the profile; the profile only
// picks kinds, orders them, renames them (label) and sets when a ticket counts as stuck
// (stuck_after). check is an agent's mark with a name (check/<name>), deploy may name the GitHub
// Deployment environment. Rules: queued first, done last, each kind once (check — once per name),
// gate-merge and awaiting-merge not together. No field (or null) — the default Pipeline.
//
// pipelineProblem returns the reason instead of ending the process: the caller decides what a
// broken Pipeline means (bin/profile: a broken profile, exit 1; bin/profile-set: nothing written,
// exit 1). The reason is the text after "workflow.pipeline" — `[1].kind "review" is not a Stage
// kind (…)`, ` is a list of Stages, got …` — so each caller puts its own file name in front.
//
// CommonJS, like eval-env.cjs: the scripts of bin/ are CommonJS and `require` it.
"use strict"

const { createHash } = require("node:crypto")

const STAGE_KINDS = ["queued", "implementing", "ci", "agent-review", "human-review", "check", "gate-merge", "awaiting-merge", "deploy", "closing", "done"]
const DEFAULT_PIPELINE = ["queued", "implementing", "ci", "agent-review", "gate-merge", "closing", "done"].map((kind) => ({ kind }))
const STAGE_FIELDS = ["kind", "name", "label", "stuck_after", "environment"]

// Why `pl` (the value of workflow.pipeline, not null or absent) is not a Pipeline; null when it is one.
function pipelineProblem(pl) {
    if (!Array.isArray(pl)) return ` is a list of Stages, got ${JSON.stringify(pl)}`
    if (pl.length === 0) return " is a list of Stage kinds, got an empty list"
    const seen = new Set()
    for (const [i, st] of pl.entries()) {
        const at = `[${i}]`
        if (st === null || typeof st !== "object" || Array.isArray(st)) return `${at} is an object {kind, name?, label?, stuck_after?, environment?}, got ${JSON.stringify(st)}`
        const extra = Object.keys(st).find((k) => !STAGE_FIELDS.includes(k))
        if (extra !== undefined) return `${at} has an unknown field ${JSON.stringify(extra)} (fields: ${STAGE_FIELDS.join(", ")})`
        if (!STAGE_KINDS.includes(st.kind)) return `${at}.kind ${JSON.stringify(st.kind)} is not a Stage kind (${STAGE_KINDS.join(", ")})`
        if (st.kind === "check") {
            if (st.name === undefined) return `${at}: check needs a name — the mark check/<name> it waits for`
            if (typeof st.name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(st.name)) return `${at}.name is lower case letters, digits and dashes, got ${JSON.stringify(st.name)}`
        } else if (st.name !== undefined) return `${at}: name is only for check, not for ${st.kind}`
        if (st.environment !== undefined) {
            if (st.kind !== "deploy") return `${at}: environment is only for deploy, not for ${st.kind}`
            if (typeof st.environment !== "string" || !st.environment.trim()) return `${at}.environment is a GitHub environment name, got ${JSON.stringify(st.environment)}`
        }
        if (st.label !== undefined && (typeof st.label !== "string" || !st.label.trim())) return `${at}.label is a non-empty string, got ${JSON.stringify(st.label)}`
        if (st.stuck_after !== undefined && (typeof st.stuck_after !== "string" || !/^[1-9]\d*[hm]$/.test(st.stuck_after)))
            return `${at}.stuck_after is "<number>h" or "<number>m", got ${JSON.stringify(st.stuck_after)}`
        const key = st.kind === "check" ? `check "${st.name}"` : `"${st.kind}"`
        if (seen.has(key)) return `: ${key} more than once`
        seen.add(key)
    }
    if (pl[0].kind !== "queued") return `: the first Stage is queued, got ${JSON.stringify(pl[0].kind)}`
    if (pl[pl.length - 1].kind !== "done") return `: the last Stage is done, got ${JSON.stringify(pl[pl.length - 1].kind)}`
    if (seen.has('"gate-merge"') && seen.has('"awaiting-merge"')) return ": gate-merge and awaiting-merge do not go together (an agent merges, or a human does)"
    return null
}

// The value of workflow.pipeline of the `workflow` object of a profile; undefined when there is none.
const pipelineField = (wf) => (wf !== null && typeof wf === "object" && !Array.isArray(wf) ? wf.pipeline : undefined)

// The Pipeline a profile's `workflow` gives: { pipeline } (the default one without the field or with
// null), or { problem } with the reason pipelineProblem gives.
function resolvePipeline(wf) {
    const pl = pipelineField(wf)
    if (pl === undefined || pl === null) return { pipeline: DEFAULT_PIPELINE }
    const problem = pipelineProblem(pl)
    return problem === null ? { pipeline: pl } : { problem }
}

// JSON with the keys of every object sorted: two spellings of one value give one text.
function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
    if (value !== null && typeof value === "object")
        return `{${Object.keys(value)
            .sort()
            .filter((k) => value[k] !== undefined)
            .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
            .join(",")}}`
    return JSON.stringify(value)
}

// The fingerprint of the value of workflow.pipeline (compare-and-write of bin/profile-set): null when
// the field is absent or null, else "sha256:<hex>" of its canonical JSON. A caller passes the
// fingerprint it read, and the write goes ahead only while the file still has that value.
function pipelineFingerprint(pl) {
    if (pl === undefined || pl === null) return null
    return `sha256:${createHash("sha256").update(canonical(pl)).digest("hex")}`
}

module.exports = { STAGE_KINDS, DEFAULT_PIPELINE, STAGE_FIELDS, pipelineProblem, pipelineField, resolvePipeline, pipelineFingerprint }
