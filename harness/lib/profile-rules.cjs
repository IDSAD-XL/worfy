// The rules bin/profile reads a profile by, beyond its JSON schema, shared with bin/profile-set, which
// writes single fields: one copy, so a field the writer accepts never leaves a profile the reader refuses
// as broken.
//
// The rules (profiles/README.md, "workflow" and "cross_machine_gate"):
// - workflow.merge_gate is "each", "wave" or null;
// - workflow.e2e_lock is an absolute path (`~/` counts) or null;
// - workflow.ci is "pr", "batch" or null; workflow.ci_batch_run is a command string or null, and "batch"
//   needs it;
// - cross_machine_gate is null or {label, role, exempt?, check?, checks_section}, role "serve" needs check.
//
// profileProblems returns the problems instead of ending the process, as pipeline.cjs does: the caller
// decides what a broken field means (bin/profile: a broken profile, exit 1; bin/profile-set: nothing
// written, exit 1). Each problem is {path, message}; the message starts with the field, so a caller puts
// only its file name in front. The value is only read, never changed: bin/profile resolves the defaults
// (ci "pr", the expanded e2e_lock) itself.
//
// CommonJS, like pipeline.cjs: the scripts of bin/ are CommonJS and `require` it.
"use strict"

const os = require("node:os")
const path = require("node:path")

const MERGE_GATES = ["each", "wave"]
const CI_MODES = ["pr", "batch"]
const CMG_ROLES = ["request", "serve"]

// `~` and `~/…` are the home folder, as bin/profile reads them.
const expandHome = (p) => (p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p)
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const given = (v) => v !== undefined && v !== null
const text = (v) => typeof v === "string" && v.trim() !== ""

/** The problems of the workflow object's gate and CI fields, in the order bin/profile checks them. */
function workflowProblems(wf) {
    const problems = []
    if (!isObject(wf)) return problems
    if (given(wf.merge_gate) && !MERGE_GATES.includes(wf.merge_gate))
        problems.push({ path: "workflow.merge_gate", message: `workflow.merge_gate is "each", "wave" or null, got ${JSON.stringify(wf.merge_gate)}` })
    if (given(wf.e2e_lock)) {
        const lock = typeof wf.e2e_lock === "string" ? expandHome(wf.e2e_lock.trim()) : ""
        if (!lock || !path.isAbsolute(lock))
            problems.push({ path: "workflow.e2e_lock", message: `workflow.e2e_lock is an absolute path or null, got ${JSON.stringify(wf.e2e_lock)}` })
    }
    if (given(wf.ci) && !CI_MODES.includes(wf.ci)) problems.push({ path: "workflow.ci", message: `workflow.ci is "pr", "batch" or null, got ${JSON.stringify(wf.ci)}` })
    if (given(wf.ci_batch_run) && typeof wf.ci_batch_run !== "string")
        problems.push({ path: "workflow.ci_batch_run", message: `workflow.ci_batch_run is a command string or null, got ${JSON.stringify(wf.ci_batch_run)}` })
    if (wf.ci === "batch" && !text(wf.ci_batch_run))
        problems.push({
            path: "workflow.ci",
            message: `workflow.ci "batch" needs workflow.ci_batch_run, the command that starts the CI run on the main branch`,
        })
    return problems
}

/** The first problem of cross_machine_gate (each later rule assumes the earlier ones hold), or none. */
function crossMachineGateProblems(g) {
    if (!given(g)) return []
    const broken = (msg) => [{ path: "cross_machine_gate", message: `cross_machine_gate${msg}` }]
    if (!isObject(g)) return broken(` is an object {label, role, exempt?, check?, checks_section} or null, got ${JSON.stringify(g)}`)
    if (!CMG_ROLES.includes(g.role)) return broken(`.role is "request" or "serve", got ${g.role === undefined ? "no role" : JSON.stringify(g.role)}`)
    if (!text(g.label)) return broken(`.label is the name of the GitHub label, got ${g.label === undefined ? "no label" : JSON.stringify(g.label)}`)
    if (!text(g.checks_section))
        return broken(
            `.checks_section is the heading of the PR description section with the commands for the serve machine, got ${g.checks_section === undefined ? "no checks_section" : JSON.stringify(g.checks_section)}`
        )
    if (given(g.exempt) && !(Array.isArray(g.exempt) && g.exempt.every((p) => text(p) && !/["\\]/.test(p))))
        return broken(`.exempt is a list of paths ("/" separated, no quote or backslash), got ${JSON.stringify(g.exempt)}`)
    if (given(g.check) && !text(g.check)) return broken(`.check is a command string or null, got ${JSON.stringify(g.check)}`)
    if (g.role === "serve" && !text(g.check)) return broken(`: role "serve" needs check, the command that checks a labelled PR's branch on this machine`)
    return []
}

/** Every problem bin/profile would refuse `profile` for among the rules above; [] when it reads it. */
function profileProblems(profile) {
    if (!isObject(profile)) return []
    return [...workflowProblems(profile.workflow), ...crossMachineGateProblems(profile.cross_machine_gate)]
}

module.exports = { profileProblems, expandHome }
