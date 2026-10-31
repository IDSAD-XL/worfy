#!/usr/bin/env node
// The Stop hook that keeps the qmd index fresh: it runs bin/qmd-refresh --quiet. That script is zsh,
// and Windows has no zsh: run directly, it ended every turn there with exit 127, which Claude Code
// shows as "Stop hook error occurred". So the hook is a node script that starts
// the refresh only where zsh is found, and otherwise exits 0 without a word.
//
// shortcut: on Windows the index is not refreshed at all, even when a zsh is on PATH; redo when
// qmd gets a way to run on Windows (a node refresh, or a zsh the Harness can rely on).
//
// Exit code: the refresh's own (0 under --quiet, see bin/qmd-refresh), 0 without zsh. The hook JSON on
// stdin is not read: the refresh needs nothing from it. Test: test/contract/harness-hooks-qmd-refresh.test.ts.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** The first executable `zsh` on PATH, or null. */
function findZsh() {
    for (const dir of (process.env.PATH || "").split(path.delimiter)) {
        if (!dir) continue
        const candidate = path.join(dir, "zsh")
        try {
            fs.accessSync(candidate, fs.constants.X_OK)
            if (fs.statSync(candidate).isFile()) return candidate
        } catch {
            // not here
        }
    }
    return null
}

if (process.platform === "win32") process.exit(0)
const zsh = findZsh()
if (!zsh) process.exit(0)

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "qmd-refresh")
// stdin closed: the refresh reads nothing, and the hook JSON must not reach a child that might wait on it.
const run = spawnSync(zsh, [script, "--quiet"], { stdio: ["ignore", "inherit", "inherit"] })
if (run.error) {
    process.stderr.write(`qmd-refresh hook: could not start ${zsh}: ${run.error.message}\n`)
    process.exit(1)
}
process.exit(run.status ?? 1)
