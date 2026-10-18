// node state-guard.cjs <home> <fixture> — whether demo-project.sh may write the Harness state of the
// fixture. Exit 0 when it may; otherwise exit 1 with the reason on stderr, before anything is written.
// The fixture writes a gate registry and the profile `demo` into <home>/.claude/worfy-harness, and a
// scaffold started by hand in a real shell would put them into the user's own ~/.claude. So it refuses:
//   - a <home> that is the real home folder of the user, read from the user database
//     (os.userInfo().homedir), not from HOME, which is what is being checked;
//   - a HARNESS_HOME outside <fixture>: the Harness state of that shell lives elsewhere, and a home
//     folder next to it is likely the real one too.
// Paths are compared after resolving links (/var and /private/var on macOS).
"use strict"

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const resolved = (dir) => {
    try {
        return fs.realpathSync(dir)
    } catch {
        return path.resolve(dir)
    }
}

function refusal(home, fixture, env = process.env) {
    if (!home) return "HOME is not set"
    if (resolved(home) === resolved(os.userInfo().homedir)) return `HOME (${home}) is the real home folder of this user; run the fixture with a temporary HOME`
    if (env.HARNESS_HOME) {
        const inside = path.relative(resolved(fixture), resolved(env.HARNESS_HOME))
        if (inside.startsWith("..") || path.isAbsolute(inside)) return `HARNESS_HOME (${env.HARNESS_HOME}) is outside the fixture ${fixture}; unset it`
    }
    return null
}

exports.refusal = refusal

if (require.main === module) {
    const [home, fixture] = process.argv.slice(2)
    if (!fixture) {
        process.stderr.write("usage: node state-guard.cjs <home> <fixture>\n")
        process.exit(2)
    }
    const reason = refusal(home, fixture)
    if (reason) {
        process.stderr.write(`demo-project.sh: ${reason}\n`)
        process.exit(1)
    }
}
