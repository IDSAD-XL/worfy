// node state-guard.cjs <home> <fixture> — whether demo-project.sh may write the Harness state of the
// fixture. Exit 0 when it may; otherwise exit 1 with the reason on stderr, before anything is written.
// The fixture writes a gate registry and the profile `demo` into <home>/.claude/worfy-harness, and a
// scaffold started by hand in a real shell would put them into the user's own ~/.claude. So it refuses:
//   - a <home> that is the real home folder of the user, read from the user database
//     (os.userInfo().homedir), not from HOME, which is what is being checked;
//   - a HARNESS_HOME outside <fixture>: the Harness state of that shell lives elsewhere, and a home
//     folder next to it is likely the real one too.
// Folders are compared as files, by device and inode (links followed): on macOS one folder has many
// spellings — /var and /private/var, /home/x and /HOME/X on a case-insensitive volume,
// the same path under /System/Volumes/Data. A folder that does not exist is not the real home.
"use strict"

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

// The spelling on disk of a folder that may not exist yet: the nearest folder that does exist goes
// through the native realpath (the long name of an 8.3 short one on Windows, /private/var for /var
// on macOS), the missing rest is appended as written.
const resolved = (dir) => {
    const absolute = path.resolve(dir)
    const missing = []
    for (let head = absolute; ; head = path.dirname(head)) {
        try {
            return path.join(fs.realpathSync.native(head), ...missing)
        } catch {
            if (path.dirname(head) === head) return absolute
            missing.unshift(path.basename(head))
        }
    }
}

const sameFolder = (a, b) => {
    try {
        const one = fs.statSync(a)
        const two = fs.statSync(b)
        return one.dev === two.dev && one.ino === two.ino
    } catch {
        return false
    }
}

function refusal(home, fixture, env = process.env) {
    if (!home) return "HOME is not set"
    if (sameFolder(home, os.userInfo().homedir)) return `HOME (${home}) is the real home folder of this user; run the fixture with a temporary HOME`
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
