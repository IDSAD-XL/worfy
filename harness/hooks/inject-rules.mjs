#!/usr/bin/env node
// Hook SessionStart / SubagentStart: hands one part of the Harness rules to the session as
// additionalContext. Usage in hooks.json: node "${CLAUDE_PLUGIN_ROOT}/hooks/inject-rules.mjs" <part>,
// where <part> names rules/<part>.md next to this script.
//
// Reads the hook event JSON on stdin and prints
//   {"hookSpecificOutput":{"hookEventName":"<event>","additionalContext":"<text of the part>"}}
// Claude Code does not expand ${CLAUDE_PLUGIN_ROOT} inside additionalContext, so this script does:
// with the value from the environment, or, without it, with the plugin folder (the one above hooks/;
// on Windows spelled C:/…, as Claude Code spells CLAUDE_PLUGIN_ROOT there).
// The part "common" also carries the user's own rules file, $HARNESS_HOME/user/rules.md, when it exists.
//
// Always exits 0: a broken hook must not break the session. When it cannot do its job (no part
// file, empty or unreadable stdin, stdin that is not JSON, an internal error) it prints nothing on
// stdout and one line on stderr.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { harnessHome } from "./eval-env.cjs"

const TOKEN = "${CLAUDE_PLUGIN_ROOT}"
// Claude Code cuts one additionalContext string to a preview above this many characters.
const LIMIT = 10000

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
    let hook
    try {
        hook = JSON.parse(input)
    } catch {
        fail(`stdin is not JSON; rules part '${part}' not injected`)
    }
    const event = { name: hook?.hook_event_name, cwd: hook?.cwd }
    if (typeof event.name !== "string" || !event.name) fail(`no hook_event_name on stdin; rules part '${part}' not injected`)

    // split/join replaces the placeholder literally: no regex, no replacement patterns ($&) in the path.
    let additionalContext = text.replace(/\n+$/, "").split(TOKEN).join(root)
    if (part === "common") additionalContext = withUserRules(additionalContext, event.cwd)
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event.name, additionalContext } }) + "\n")
}

// The part "common" reaches every session and every subagent, so the user's own rules
// ($HARNESS_HOME/user/rules.md, profiles/README.md "User personalization") ride on it. The file goes in as
// written: the Harness does not read its meaning. Together with the part it stays within LIMIT; a
// longer file is cut after a whole line and a closing line names the file. A file that cannot be read
// costs one line on stderr, never the part itself.
function withUserRules(base, cwd) {
    const file = path.join(harnessHome(typeof cwd === "string" && cwd ? cwd : undefined), "user", "rules.md")
    let rules
    try {
        rules = fs.readFileSync(file, "utf8")
    } catch (e) {
        if (e.code !== "ENOENT") process.stderr.write(`inject-rules: user rules ${file} not injected (${e.code || e.message})\n`)
        return base
    }
    rules = rules.replace(/\s+$/, "")
    if (!rules) return base
    const head = `${base}\n\n## User rules\n\n`
    const length = (s) => [...s].length // code points, as Claude Code counts the string
    if (length(head) + length(rules) <= LIMIT) return head + rules
    const note = `\n\n(The user rules are cut here to fit the session hook limit; the whole file: ${file})`
    let budget = LIMIT - length(head) - length(note)
    if (budget <= 0) {
        process.stderr.write(`inject-rules: no room for user rules ${file} within ${LIMIT} characters; not injected\n`)
        return base
    }
    const kept = []
    for (const line of rules.split("\n")) {
        const cost = length(line) + 1
        if (cost > budget) break
        kept.push(line)
        budget -= cost
    }
    return head + kept.join("\n").replace(/\s+$/, "") + note
}

try {
    main()
} catch (e) {
    const why = e instanceof Quiet ? e.message : `internal error: ${String(e?.message ?? e).split("\n")[0]}`
    process.stderr.write(`inject-rules: ${why}\n`)
}
process.exitCode = 0
