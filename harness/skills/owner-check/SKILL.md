---
name: owner-check
description: Record the owner's decision on one manual item of a ticket — an `owner-check` Evidence line written with `ticket evidence`; Pass ticks the item, Fail files a rework ticket in the same epic. Use on "/worfy:owner-check <epic> <NN> <item> <pass|fail> <platform> <copy> <sha|->" with an "Owner's words:" paragraph (worfy's action "Record owner check"), or when the owner says in this conversation that a manual item passed or failed.
argument-hint: "<epic> <NN> <item> <pass|fail> <platform> <copy> <sha|->"
---

# Record the owner's check of a manual item

A manual item of a ticket (an item of `tickets.done_section` with the mark `tickets.manual_mark` in
parentheses after its checkbox) is proved only by a person: the owner's word, a screenshot a person
checked, or a clip. This skill writes the owner's word as an Evidence line of kind `owner-check`
under that item, the one form for every decision:

```text
ticket evidence <epic> <NN> <item> owner-check <pass|fail> --ref "<YYYY-MM-DD>: <the owner's words>" --platform <p> --copy <c> [--sha <s>]
```

On Pass it ticks the item `[x]`. On Fail it files a rework ticket in the same epic. In a Codex session
the skill is called the same way: a message that starts with the skill's name calls it.

**The owner's word only.** The decision comes from the owner: the text of worfy's action "Record owner
check", sent when the owner pressed Pass or Fail, or the owner's own message in this conversation.
Never tick an item without the owner's word: not on your own look at the app, not on a test run, not
on another agent's report, not on a plan or an unattended run that carries no such text — say why and
stop. Never write `pass` on a Fail: the verdict is the one the owner gave, word for word, even when
you think the item works.

## 1. The arguments and the owner's words

Seven words, in this order:

| Word | What | Values |
|---|---|---|
| `<epic>` | The epic, a folder of the tickets root | |
| `<NN>` | The ticket number | digits |
| `<item>` | The number of the item in the "done" section, from 1, as `ticket evidence <epic> <NN>` numbers them | digits |
| `<pass\|fail>` | The owner's verdict | `pass`, `fail` |
| `<platform>` | The machine kind the owner looked on | `mac`, `windows`, `linux` |
| `<copy>` | The copy of the app the owner looked at | `stable`, `installed`, `dev` |
| `<sha\|->` | The commit of that copy; `-` when it is not known, and then `ticket evidence` takes `HEAD` | 7 to 40 hex digits, or `-` |

A word missing or out of its values: ask the owner; with no owner to answer, stop and say which word.

The paragraph after the command, `Owner's words:`, is the owner's comment as a quote (`> …`). It may
be empty. Write it, as it is, with the Write tool into a new file outside the repository — your
scratchpad, for example `<scratchpad>/owner-words-<epic>-<NN>-<item>.txt` — and give the block below
that path; no words — give `-`. Never paste the words into a shell command: a backtick or `$(` in
them would run.

## 2. The profile and where the line goes

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/profile" --json; echo "EXIT=$?"
```

Exit 3 — the project is not connected and its tickets have no place known to the Harness: say so,
suggest `/worfy:connect-project`, and stop. Take `_resolved.mode`, `worktree.root`, `worktree.base`,
`github.account` and `attribution`.

- **Full mode** (`full`): the lines of one day go into one documents PR, branch
  `owner-check/<YYYY-MM-DD>`. Look for its open PR:
  `gh pr list --head "owner-check/<YYYY-MM-DD>" --state open --json number; echo "EXIT=$?"`.
  An open PR — add a commit to it: `git fetch origin owner-check/<YYYY-MM-DD>`, then its worktree
  `<worktree.root>/owner-check-<YYYY-MM-DD>` (`git worktree add` with that branch, or `git pull
  --ff-only` in the one already there). None open — a new branch from a fresh base:
  `git fetch origin`, then `git worktree add -b owner-check/<YYYY-MM-DD> <worktree.root>/owner-check-<YYYY-MM-DD> <worktree.base>`;
  when that branch name is taken (a PR of that day already merged or closed), add `-2`, `-3` to the
  branch and the folder. Never write into the main checkout or into a worktree of another branch.
  Run the block of section 3 from that worktree.
- **Silent mode** (`silent`): `ticket` writes into the ticket file in the Workflow folder from any
  folder of the project, and the branch gets nothing. Run the block from the project root.

## 3. Record the decision

Fill in the seven words and the path of the words file, and run:

```bash
# owner-check: record the decision
E='<epic>' N='<NN>' I='<item>' V='<verdict>' P='<platform>' C='<copy>' S='<sha>' W='<words file>' D="$(date +%F)"
node -e '
const fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process")
const [root, epic, nn, itemArg, verdict, platform, copy, sha, wordsFile, date] = process.argv.slice(1)
const { parseDoneSection } = require(path.join(root, "lib", "evidence.cjs"))
const privacy = require(path.join(root, "lib", "privacy.cjs"))
const { harnessHome } = require(path.join(root, "hooks", "eval-env.cjs"))
const stop = (why) => { console.log(`refused: ${why}`); process.exit(1) }
const script = (name, args) => cp.execFileSync(process.execPath, [path.join(root, "bin", name), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
if (!["pass", "fail"].includes(verdict)) stop(`the verdict is pass or fail, got "${verdict}"`)
if (!["mac", "windows", "linux"].includes(platform)) stop(`the platform is mac, windows or linux, got "${platform}"`)
if (!["stable", "installed", "dev"].includes(copy)) stop(`the copy is stable, installed or dev, got "${copy}"`)
if (sha !== "-" && !/^[0-9a-f]{7,40}$/i.test(sha)) stop(`the sha is 7 to 40 hex digits or -, got "${sha}"`)
if (!/^[0-9]+$/.test(itemArg) || !/^[0-9]+$/.test(nn)) stop(`the ticket and the item are numbers, got "${nn}" and "${itemArg}"`)
let prof = null
try { prof = JSON.parse(script("profile", ["--json"])) } catch { prof = null }
const opts = { doneSection: prof?.tickets?.done_section, manualMark: prof?.tickets?.manual_mark }
const scratch = script("ticket", ["root"]).trim()
const issues = (e) => path.join(scratch, e, "issues")
const ticketFile = (e, n) => {
    const dir = issues(e)
    const found = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md") && new RegExp(`^0*${Number(n)}-`).test(f)) : []
    return found.length === 1 ? fs.realpathSync(path.join(dir, found[0])) : null
}
// The item: it must be a manual item of this ticket, read by the parser `ticket evidence` reads it with.
const itemOf = (e, n, k) => {
    const file = ticketFile(e, n)
    if (!file) return { why: `no single ticket ${n} in epic ${e}` }
    const items = parseDoneSection(fs.readFileSync(file, "utf8"), opts)
    const it = items.find((x) => x.index === k)
    if (!it) return { why: `${e} ${n} has no item ${k}: its "done" section has ${items.length} checkbox item(s)` }
    if (!it.manual) return { why: `item ${k} of ${e} ${n} is not a manual item: an owner check proves only a manual item` }
    return { file, it }
}
const first = itemOf(epic, nn, Number(itemArg))
if (first.why) stop(first.why)
// The words: one line, no " · " (it splits the fields), personal data replaced by a stand-in.
let words = wordsFile === "-" ? "" : fs.readFileSync(wordsFile, "utf8")
words = words.split(/\r?\n/).map((l) => l.replace(/^\s*>\s?/, "")).join(" ").replace(/·/g, "-").replace(/\s+/g, " ").trim()
const STAND_IN = { "home-path": "<home>", host: "<host>", "tailscale-ip": "<ip>", uuid: "<uuid>", email: "<email>", token: "<token>", deny: "<private>" }
const privacyOptions = { hostname: os.hostname(), deny: privacy.personal(harnessHome()).deny }
const replaced = []
for (const f of privacy.findings(words, privacyOptions).reverse()) {
    let start = f.index
    // A home folder path goes whole up to the user name: the root, the home folder and the name become <home>.
    if (f.rule === "home-path") while (start > 0 && !/[\s"`(<]/.test(words[start - 1])) start--
    words = words.slice(0, start) + (STAND_IN[f.rule] || "<private>") + words.slice(f.index + f.length)
    replaced.push(f.rule)
}
const left = privacy.findings(words, privacyOptions)
if (left.length) stop(`the owner words still hold personal data after the stand-ins (${left.map((f) => f.rule).join(", ")}): rewrite them`)
if (replaced.length) console.log(`owner words: replaced by a stand-in: ${[...new Set(replaced)].join(", ")}`)
const ref = `${date}: ${words || `${verdict}, no words`}`
const done = new Set()
// One owner-check line per decision: the same verdict, ref, platform and copy already there adds nothing.
const record = (e, n, k, lineRef) => {
    const key = `${e}/${Number(n)}/${k}`
    if (done.has(key)) return
    done.add(key)
    const { file, it, why } = itemOf(e, n, k)
    if (why) return console.log(`note: not recorded: ${why}`)
    if (it.evidence.some((x) => x.kind === "owner-check" && x.verdict === verdict && x.ref === lineRef && x.platform === platform && x.copy === copy))
        console.log(`already recorded: ${e} ${n} item ${k}, owner-check ${verdict}, nothing added`)
    else {
        const args = ["evidence", e, n, String(k), "owner-check", verdict, "--ref", lineRef, "--platform", platform, "--copy", copy]
        if (sha !== "-") args.push("--sha", sha)
        try { process.stdout.write(script("ticket", args)) } catch (err) {
            process.stdout.write(String(err.stdout || "")); process.stderr.write(String(err.stderr || "")); process.exit(err.status || 1)
        }
    }
    if (verdict !== "pass") return
    const text = fs.readFileSync(file, "utf8")
    const now = parseDoneSection(text, opts).find((x) => x.index === k)
    if (!now.checked) {
        const lines = text.split("\n")
        lines[now.line - 1] = lines[now.line - 1].replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[ \]/, (m, lead) => `${lead}[x]`)
        fs.writeFileSync(file, lines.join("\n"))
        console.log(`[x] ${e} ${n} item ${k}`)
    }
    // A Pass on the item of a rework ticket is a Pass on the item it reworks: its Source line names it.
    const lines = text.split(/\r?\n/)
    const end = lines.findIndex((l) => /^## /.test(l))
    const src = lines.slice(0, end < 0 ? lines.length : end).map((l) => /^Source: owner-check fail \S+ of (\S+) (\d+), item (\d+)/.exec(l)).find(Boolean)
    if (!src) return
    const from = itemOf(src[1], src[2], Number(src[3]))
    if (from.why) return console.log(`note: the reworked item is not recorded: ${from.why}`)
    if (from.it.text !== it.text) return console.log(`note: the reworked item ${src[3]} of ${src[1]} ${src[2]} is not recorded: its text differs from item ${k} of ${e} ${n}`)
    record(src[1], src[2], Number(src[3]), `${ref} (rework ${e} ${n})`)
}
record(epic, nn, Number(itemArg), ref)
if (verdict === "fail") {
    // The rework ticket: same epic, next free number, no blockers, the same manual item with its needs line.
    const dir = issues(epic)
    const nnPad = String(Number(nn)).padStart(2, "0")
    const source = `Source: owner-check fail ${date} of ${epic} ${nnPad}, item ${itemArg}`
    const names = fs.readdirSync(dir).filter((f) => f.endsWith(".md"))
    const there = names.find((f) => fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/).some((l) => l === source || l.startsWith(`${source} `)))
    if (there) { console.log(`rework ticket already there: ${there}`); process.exit(0) }
    const next = String(Math.max(0, ...names.map((f) => Number((/^(\d+)-/.exec(f) || [])[1] || 0))) + 1).padStart(2, "0")
    const heading = (prof?.tickets?.done_section || "## Done when").replace(/^(?!#)/, "## ")
    const it = first.it
    const body = [
        `# ${next}: Rework of ${epic} ${nnPad}, item ${itemArg}`, "",
        "Type: task", "Status: open", "Blocked by: None — can start immediately",
        `${source} — ${path.basename(first.file)}`, "",
        `**What to build:** the owner checked item ${itemArg} of ${epic} ${nnPad} on ${platform} ${copy} and it failed. In the words of the owner:`, "",
        `> ${words || "(no words)"}`, "",
        heading, "",
        `- [ ] ${it.text}`,
        ...(it.needs ? [`${it.indent}- needs: ${it.needs.platform}${it.needs.copy ? ` ${it.needs.copy}` : ""}`] : []), "",
    ]
    const name = `${next}-rework-${nnPad}-item-${itemArg}.md`
    fs.writeFileSync(path.join(dir, name), body.join("\n"))
    console.log(`rework ticket: ${path.join(epic, "issues", name)}`)
}
' "${CLAUDE_PLUGIN_ROOT}" "$E" "$N" "$I" "$V" "$P" "$C" "$S" "$W" "$D"; echo "EXIT=$?"
```

What its output means:

- `refused: <why>` and `EXIT=1` — nothing was written: the item is not a manual item of this ticket,
  there is no such ticket or item, a word is out of its values, or the words keep personal data the
  stand-ins could not cover. Tell the owner the reason; do not write the line some other way.
- `already recorded: …` — the same decision is in the ticket already (a repeated "Send again"): no
  second line. A Pass still ticks the item when it was not ticked.
- `+ - evidence: owner-check …` under the path of the ticket file — the line, written by `ticket evidence`.
  Its own refusal (exit 1 or 2, with its reason) is passed on as it is.
- `[x] <epic> <NN> item <k>` — Pass ticked the item.
- `owner words: replaced by a stand-in: <rules>` — the words named a home folder with a user name, a
  machine, an email, an address, a token or a word of the personal list (the privacy check,
  `evidence-check`): the line has `<home>`, `<host>`, `<email>`, `<ip>`, `<uuid>`, `<token>` or
  `<private>` there. Tell the owner which kinds were replaced, never the values.
- `rework ticket: <epic>/issues/<NN>-rework-…md` — Fail filed the rework ticket: its `Source:` line
  names the epic, the ticket, the item and the date, its "done" section is the same manual item with
  its `needs:` line, and it has no blockers. Add the project's own sections to it (where in the code,
  what happens) by the project's ticket conventions, in `language.docs`; keep its header lines and its
  item as they are: a later Pass on that item reads them to record `owner-check pass` on the item it
  reworks, and ticks that one too. `rework ticket already there: …` — this Fail filed it before.
- `note: … not recorded: …` — a Pass on a rework item could not reach the item it reworks (that ticket
  is gone, or the item's text changed): tell the owner which item still waits for their word.

## 4. Publish

**Full mode.** In the worktree of the day's branch, before the push:
`node "${CLAUDE_PLUGIN_ROOT}/bin/evidence-check" --changed; echo "EXIT=$?"`. `EXIT=0` — commit the
ticket files (`docs: owner check <epic> <NN> item <k> <verdict>`, in `language.team`, with the
attribution lines only when `attribution` is not `off`) and push. `EXIT=1` — fix each finding (a
stand-in in place of the value) and do not push until it is 0. `EXIT=2` — the check did not run: no
push, and the report says so. With no open PR of the day, open it: title `docs: owner checks
<YYYY-MM-DD>`, one line per decision in the description. This skill does not merge it: the documents
PR merges the way the project merges its documents PRs.

**Silent mode.** The ticket files are in the Workflow folder; when that folder is a git repository,
commit them there locally, without push. Nothing goes into the project's repository.

## 5. Report

One line per decision: the ticket, the item, the verdict and the line written (or `already
recorded`), the rework ticket on Fail, the stand-ins on replaced words, and the documents PR in Full
mode. A refusal is reported with its reason, not retried with other words.
