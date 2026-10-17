#!/usr/bin/env node
// Hook SessionStart / SubagentStart: hands one part of the Harness rules to the session as
// additionalContext (ADR-0041). Usage in hooks.json: node "${CLAUDE_PLUGIN_ROOT}/hooks/inject-rules.mjs" <part>,
// where <part> names rules/<part>.md next to this script.
//
// Reads the hook event JSON on stdin and prints
//   {"hookSpecificOutput":{"hookEventName":"<event>","additionalContext":"<text of the part>"}}
// Claude Code does not expand ${CLAUDE_PLUGIN_ROOT} inside additionalContext, so this script does:
// with the value from the environment, or, without it, with the plugin folder (the one above hooks/;
// on Windows spelled C:/…, as Claude Code spells CLAUDE_PLUGIN_ROOT there).
//
// Always exits 0: a broken hook must not break the session. When it cannot do its job (no part
// file, empty or unreadable stdin, stdin that is not JSON, an internal error) it prints nothing on
// stdout and one line on stderr.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const TOKEN = "${CLAUDE_PLUGIN_ROOT}"

// A failure the hook reports with one line on stderr and exit code 0.
class Quiet extends Error {}
const fail = (message) => {
    throw new Quiet(message)
}

function main() {
    const part = process.argv[2] ?? ""
    if (!part) fail("no part name given (usage: inject-rules.mjs <part>)")
    if (part.includes("/") || part.includes("\\") || part.startsWith(".")) fail(`bad part name '${part}'`)

    const here = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)))
    const file = path.join(here, "rules", `${part}.md`)
    let text
    try {
        text = fs.readFileSync(file, "utf8")
    } catch {
        fail(`no rules part '${part}' (${file})`)
    }

    let root = process.env.CLAUDE_PLUGIN_ROOT || path.dirname(here)
    if (!process.env.CLAUDE_PLUGIN_ROOT && process.platform === "win32") root = root.replaceAll("\\", "/")

    let input = ""
    try {
        input = fs.readFileSync(0, "utf8")
    } catch {
        fail(`cannot read stdin; rules part '${part}' not injected`)
    }
    if (!input.replace(/\n+$/, "")) fail(`empty stdin; rules part '${part}' not injected`)
    let event
    try {
        event = JSON.parse(input)?.hook_event_name
    } catch {
        fail(`stdin is not JSON; rules part '${part}' not injected`)
    }
    if (typeof event !== "string" || !event) fail(`no hook_event_name on stdin; rules part '${part}' not injected`)

    // split/join replaces the placeholder literally: no regex, no replacement patterns ($&) in the path.
    const additionalContext = text.replace(/\n+$/, "").split(TOKEN).join(root)
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } }) + "\n")
}

try {
    main()
} catch (e) {
    const why = e instanceof Quiet ? e.message : `internal error: ${String(e?.message ?? e).split("\n")[0]}`
    process.stderr.write(`inject-rules: ${why}\n`)
}
process.exitCode = 0
