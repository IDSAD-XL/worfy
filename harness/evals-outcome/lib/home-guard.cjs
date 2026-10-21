// node home-guard.cjs <home> — whether a scaffold script of this folder may write into <home>.
// Exit 0 when it may; otherwise exit 1 with the reason on stderr, before anything is written.
// A scaffold runs as the user, outside any sandbox. Started by hand in a real shell, it would write
// into the user's own home folder, so this refuses a <home> that is the real home folder of the
// user, read from the user database (os.userInfo().homedir), not from HOME, which is what is being
// checked. The two folders are compared by device and inode (links followed), since one folder has
// many spellings on macOS (/var and /private/var, a case-insensitive volume); a folder missing from
// the disk is compared by its resolved spelling.
"use strict"

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

// The spelling on disk of a folder that may not exist yet: the nearest folder that does exist goes
// through the native realpath, the missing rest is appended as written.
const resolved = (dir) => {
    const missing = []
    for (let head = path.resolve(dir); ; head = path.dirname(head)) {
        try {
            return path.join(fs.realpathSync.native(head), ...missing)
        } catch {
            if (path.dirname(head) === head) return path.resolve(dir)
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
        return resolved(a) === resolved(b)
    }
}

const home = process.argv[2]
if (!home) {
    process.stderr.write("home-guard: HOME is not set\n")
    process.exit(1)
}
if (sameFolder(home, os.userInfo().homedir)) {
    process.stderr.write(`home-guard: HOME (${home}) is the real home folder of this user; run the scaffold with a temporary HOME\n`)
    process.exit(1)
}
