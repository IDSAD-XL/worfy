// Which git the Harness scripts start and where the Harness state lives, with the two variables of
// a `claude plugin eval` run (scripts/eval-harness.mjs, worfy-harness ticket 28). The sandbox of such
// a run may refuse the git on PATH and may not let the run write $HOME/.claude:
//   EVAL_GIT          — the git to start instead of `git` from PATH (eval-harness.mjs puts a copy of
//                       git in a folder the sandbox reads);
//   EVAL_HARNESS_HOME — the Harness state folder when HARNESS_HOME is not set: an absolute path as it
//                       is, a relative one from the git common directory of the folder asked about
//                       (`worfy-harness` gives <repository>/.git/worfy-harness: the run may write
//                       there, git status does not show it, and every worktree of the repository
//                       gets the same folder). Outside a git repository — the default.
// Without both variables nothing changes: `git` from PATH, HARNESS_HOME or ~/.claude/worfy-harness.
//
// CommonJS, so that the CommonJS scripts of bin/ `require` it and the ES modules `import` it.
// `node eval-env.cjs harness-home` prints the state folder for the current folder (for bash).
"use strict"

const { spawnSync } = require("node:child_process")
const os = require("node:os")
const path = require("node:path")

// The git every Harness script starts.
const git = process.env.EVAL_GIT || "git"

// The current folder, or null when it was deleted (process.cwd() throws then).
function currentFolder() {
    try {
        return process.cwd()
    } catch {
        return null
    }
}

// The Harness state on this machine (ADR-0040 item 5) for the folder `cwd`. The home folder comes
// from os.homedir(): on Windows that is USERPROFILE, and HOME may be unset there.
function harnessHome(cwd = currentFolder(), env = process.env) {
    if (env.HARNESS_HOME) return env.HARNESS_HOME
    const fallback = path.join(os.homedir(), ".claude", "worfy-harness")
    const evalHome = env.EVAL_HARNESS_HOME
    if (!evalHome) return fallback
    if (path.isAbsolute(evalHome)) return evalHome
    if (!cwd) return fallback
    const run = spawnSync(env.EVAL_GIT || "git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
    })
    const common = run.status === 0 ? run.stdout.replace(/\r?\n+$/, "") : ""
    return common ? path.resolve(common, evalHome) : fallback
}

exports.git = git
exports.harnessHome = harnessHome

if (require.main === module) {
    if (process.argv[2] !== "harness-home") {
        process.stderr.write("usage: node eval-env.cjs harness-home\n")
        process.exit(2)
    }
    process.stdout.write(`${harnessHome()}\n`)
}
