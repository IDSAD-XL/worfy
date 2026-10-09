# Sourced by the Harness shell tests that must not write into the real home (worfy-harness ticket 22).
#
#   real_home_snapshot <home> [<marker>]
#
# prints one line per file of the Harness parts of <home>/.claude — the Harness state folder
# worfy-harness/ and the pre-plugin places gate/, profiles/, bin/, hooks/, skills/, agents/,
# CLAUDE.md, settings.json — with its size and mtime. A test takes it before and after its run and
# compares the two: a file created, deleted or rewritten there is a write into the real home.
#
# Live sessions keep writing into three folders while a test runs: worktree-sessions/ (the
# worktree lock), gate/state/ (gate markers and verdicts) and profiles/*/state/ (the retro log). Their
# files are not listed by mtime; instead, with <marker> (the test's temporary directory) the
# snapshot lists every file there whose contents name the marker — a lock or a verdict of the test's
# own temporary repository. Claude Code's own folders (projects/, todos/, shell-snapshots/ and the
# rest) are not looked at: other sessions change them all the time.
real_home_snapshot() {
    node - "$1" "${2:-}" <<'NODE'
const fs = require("fs"), path = require("path")
const [home, marker] = process.argv.slice(2)
const claude = path.join(home, ".claude")
const VOLATILE = [/\/worktree-sessions(\/|$)/, /\/gate\/state(\/|$)/, /\/profiles\/[^/]+\/state(\/|$)/]
const out = []
const walk = (p) => {
    let st
    try { st = fs.lstatSync(p) } catch { return }
    const volatile = VOLATILE.some((re) => re.test(p))
    if (st.isDirectory()) {
        let names = []
        try { names = fs.readdirSync(p).sort() } catch { return }
        for (const n of names) walk(path.join(p, n))
        return
    }
    if (!volatile) return out.push(`${p}\t${st.size}\t${st.mtimeMs}`)
    if (!marker || !st.isFile() || st.size > 1 << 20) return
    try { if (fs.readFileSync(p, "utf8").includes(marker)) out.push(`${p}\tnames ${marker}`) } catch {}
}
for (const part of ["worfy-harness", "gate", "profiles", "bin", "hooks", "skills", "agents", "CLAUDE.md", "settings.json"])
    walk(path.join(claude, part))
process.stdout.write(out.join("\n") + "\n")
NODE
}
