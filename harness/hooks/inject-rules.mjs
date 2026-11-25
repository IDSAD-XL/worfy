#!/usr/bin/env node
// Hook SessionStart / SubagentStart / PreCompact: hands one part of the Harness rules to the session.
// Usage in hooks.json: node "${CLAUDE_PLUGIN_ROOT}/hooks/inject-rules.mjs" <part>, where <part> names
// rules/<part>.md next to this script.
//
// Reads the hook event JSON on stdin and prints
//   {"hookSpecificOutput":{"hookEventName":"<event>","additionalContext":"<text of the part>"}}
// On PreCompact it prints the text of the part itself, not JSON: Claude Code adds the plain stdout of a
// PreCompact hook to the instructions of the model that writes the compaction summary, on /compact and
// on auto-compaction, in a main Session and in a Subagent, and cuts it after 10,000 characters (a spike
// against Claude Code 2.1.322 showed it). That is how the part "compaction" arrives. Codex runs the same
// hooks.json but does not read that stdout (its summary instructions go through compact_prompt), so on a
// Codex input PreCompact prints nothing.
// Claude Code does not expand ${CLAUDE_PLUGIN_ROOT} inside additionalContext, so this script does:
// with the value from the environment, or, without it, with the plugin folder (the one above hooks/;
// on Windows spelled C:/…, as Claude Code spells CLAUDE_PLUGIN_ROOT there).
// The part "common" also carries the user's own rules file, $HARNESS_HOME/user/rules.md, when it exists.
// Before that file it names the language of reports for the session's folder as a value, not only as the
// setting `language.reports`: a session that saw only the setting's name answered in the language of the
// question. The value is what bin/profile of this plugin resolves for the folder (the user's
// $HARNESS_HOME/user.json first, then the profile); in a folder no profile covers, the user's own setting
// alone. With neither, or when bin/profile cannot answer, the part goes as it is.
//
// The kind of Session decides three parts. worfy starts a Product Session with WORFY_SESSION_KIND=product
// and the Session of the Assistant with WORFY_SESSION_KIND=assistant in its environment, which Claude Code
// hands on to its hooks: there "product" or "assistant" prints rules/<kind>.md and "orchestrator" prints
// nothing. In any other Session (no variable, or another value) "orchestrator" prints its part and
// "product" and "assistant" print nothing. A part that is not for this Session prints nothing on stdout or
// stderr: that is not a failure.
//
// Always exits 0: a broken hook must not break the session. When it cannot do its job (no part
// file, empty or unreadable stdin, stdin that is not JSON, an internal error) it prints nothing on
// stdout and one line on stderr.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { isCodexInput } from "./codex-input.mjs"
import { harnessHome } from "./eval-env.cjs"

const TOKEN = "${CLAUDE_PLUGIN_ROOT}"
// Claude Code cuts one additionalContext string to a preview above this many characters, and the stdout
// of a PreCompact hook after as many.
const LIMIT = 10000
// The event whose hook output is plain text that joins the instructions of the compaction summary.
const PRE_COMPACT = "PreCompact"
// The variable and its values that make a Session a Product Session or the Session of the Assistant (the kinds
// of Session worfy starts).
const KIND_VARIABLE = "WORFY_SESSION_KIND"
const KINDS = ["product", "assistant"]

/**
 * Whether `part` is for a Session of this kind: product and assistant only in a Session of their kind,
 * orchestrator only in a Session of neither.
 */
function forThisSession(part) {
    const kind = process.env[KIND_VARIABLE]
    if (KINDS.includes(part)) return kind === part
    if (part === "orchestrator") return !KINDS.includes(kind)
    return true
}

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
    // After stdin is read, so Claude Code's write to it never meets a closed pipe; before it is checked,
    // so a part not for this Session stays silent whatever came.
    if (!forThisSession(part)) return
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
    if (event.name === PRE_COMPACT) {
        if (!isCodexInput(hook)) process.stdout.write(additionalContext + "\n")
        return
    }
    if (part === "common") additionalContext = withUserRules(withLanguage(additionalContext, event.cwd, here), event.cwd)
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event.name, additionalContext } }) + "\n")
}

// How long bin/profile may take before the part goes without the language: well inside the 10 s timeout
// hooks.json gives this hook. A normal run takes well under a second.
const PROFILE_WAIT_MS = 5000

// The part "common" with the section that names the language of reports for the session's folder `cwd`
// (see the head of this file). `here` is this script's folder; bin/profile lies next to it, in the plugin.
function withLanguage(base, cwd, here) {
    const dir = typeof cwd === "string" && cwd && isDir(cwd) ? cwd : process.cwd()
    const profileBin = process.env.CLAUDE_PROFILE_BIN || path.join(path.dirname(here), "bin", "profile")
    const run = spawnSync(process.execPath, [profileBin, "-C", dir, "--json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: PROFILE_WAIT_MS,
        windowsHide: true,
    })
    if (run.error) process.stderr.write(`inject-rules: bin/profile did not answer (${run.error.code || run.error.message}); the language of reports comes from user.json alone\n`)
    let profile
    if (run.status === 0) {
        try {
            profile = JSON.parse(run.stdout)
        } catch {}
    }
    const reports = profile?.language?.reports
    const tail = "Write them in this language even when the user writes in another one."
    if (typeof reports === "string" && reports) {
        const name = typeof profile?._resolved?.name === "string" && profile._resolved.name ? ` for project ${profile._resolved.name}` : ""
        const team = profile.language.team
        const teamLine = typeof team === "string" && team ? ` Team-facing text — commits, PRs, review comments, code comments — follows \`language.team\`: ${languageName(team)}.` : ""
        return `${base}\n\n## Language of this session\n\nReports and messages to the user: ${languageName(reports)}, the \`language.reports\` that \`bin/profile\` resolves${name} (the user's own setting first, then the profile). ${tail}${teamLine}`
    }
    const own = userReports(cwd)
    if (!own) return base
    // Exit 3 is "no profile covers this folder"; any other failure is a profile that could not be read.
    const why = run.status === 3 ? "no project profile covers this folder" : "the project profile could not be read"
    return `${base}\n\n## Language of this session\n\nReports and messages to the user: ${languageName(own)}, the user's own setting (\`language.reports\` in \`user.json\` of the Harness state folder); ${why}. ${tail}`
}

// language.reports of $HARNESS_HOME/user.json, or undefined. The same reading as bin/profile's (a byte order
// mark allowed, the value trimmed); a file that is absent or broken in any way is undefined here without a
// word, since bin/profile is the one that reports a broken file.
function userReports(cwd) {
    try {
        const file = path.join(harnessHome(typeof cwd === "string" && cwd ? cwd : undefined), "user.json")
        const reports = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""))?.language?.reports
        return typeof reports === "string" && reports.trim() ? reports.trim() : undefined
    } catch {
        return undefined
    }
}

// "Russian (`ru`)" for a language code; the code alone when the runtime does not know it.
function languageName(code) {
    let name
    try {
        name = new Intl.DisplayNames(["en"], { type: "language" }).of(code)
    } catch {}
    return name && name !== code ? `${name} (\`${code}\`)` : `\`${code}\``
}

function isDir(p) {
    try {
        return fs.statSync(p).isDirectory()
    } catch {
        return false
    }
}

// The part "common" reaches every session and every subagent, so the user's own rules
// ($HARNESS_HOME/user/rules.md, profiles/README.md "User personalization") ride on it. The file goes in as
// written: the Harness does not read its meaning. Together with the part it stays within LIMIT; a
// longer file is cut after a whole line and a closing line names the file. A file that cannot be read,
// or that cannot keep even its first line within LIMIT, costs one line on stderr, never the part itself.
function withUserRules(base, cwd) {
    const file = path.join(harnessHome(typeof cwd === "string" && cwd ? cwd : undefined), "user", "rules.md")
    let rules
    try {
        rules = fs.readFileSync(file, "utf8")
    } catch (e) {
        if (e.code !== "ENOENT") process.stderr.write(`inject-rules: user rules ${file} not injected (${e.code || e.message})\n`)
        return base
    }
    rules = rules.trimEnd() // not /\s+$/: that regex backtracks quadratically on a long run of spaces
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
    const body = kept.join("\n").trimEnd()
    if (!body) {
        process.stderr.write(`inject-rules: the first line of user rules ${file} does not fit within ${LIMIT} characters; not injected\n`)
        return base
    }
    return head + body + note
}

try {
    main()
} catch (e) {
    const why = e instanceof Quiet ? e.message : `internal error: ${String(e?.message ?? e).split("\n")[0]}`
    process.stderr.write(`inject-rules: ${why}\n`)
}
process.exitCode = 0
