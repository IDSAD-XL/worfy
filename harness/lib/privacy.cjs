// The privacy rules of the Harness: what in a text is personal data that must not reach a public
// repository or a public log. bin/evidence-check runs them over what a branch adds; the records of
// red tests are masked with them too. One module, so the two never disagree on a rule.
//
// API (CommonJS; no git and no walking of folders: the caller reads the files it checks, and the one
// file this module reads itself is the personal list of personal()):
//
//   findings(text, options?) -> [{ rule, index, length }]
//       Every personal value in `text`, in order of `index`; a value inside a longer one is not
//       repeated. The value itself is not in the result:
//       the caller takes it as text.slice(index, index + length) and prints it only through mask().
//       `rule` is one of:
//         home-path     the user name in a home folder path: the folder Users at the root (macOS),
//                       /home/<name>/ (Linux), C:\Users\<name>\ (any number of \, or / in their
//                       place) and the same path as Git Bash (/c/…) and WSL (/mnt/c/…) write it.
//                       The finding is the name, not the whole path.
//         host          a machine name: *.local, *.ts.net (Tailscale MagicDNS), DESKTOP- and seven
//                       letters or digits, *-MacBook*, *s-Mac*, *-PC, and options.hostname (its
//                       first label, matched case-insensitively as a whole word).
//         tailscale-ip  an IPv4 address in 100.64.0.0/10, the Tailscale network (a network written as
//                       CIDR, 100.64.0.0/10, is not an address).
//         uuid          a UUID of any version.
//         email         an email address.
//         token         gh[pousr]_…, github_pat_…, sk-… (sk-ant-… too), AKIA…, xox?-…, a JWT, the
//                       first line of a PEM private key, the value after `Bearer `.
//         deny          a word of options.deny, matched case-insensitively anywhere in the text.
//       options: { hostname?: string, deny?: string[] } — the short host name of the machine running
//       the check (os.hostname()) and the words of the personal list (personal() below).
//
//   mask(value) -> string
//       The first two characters, "…" and the length: "Ab…(6)". A value of two or three characters
//       keeps one character, a one-character value none, so the mask never shows a value whole.
//
//   maskText(text, options?) -> string
//       `text` with every finding replaced by mask() of it (overlapping findings are masked as one).
//
//   personal(harnessHome) -> { deny: string[] }
//       The personal list <harnessHome>/user/privacy.json, {"deny": ["…"]}: names the patterns above
//       cannot know (the other machine of the owner, a nickname). It lives outside every repository.
//       No file, a broken file or a wrong shape gives { deny: [] }.
//
// Stand-ins, never a finding: the home folder names test, someone, user, you, runner, runneradmin,
// RUNNER~1 (the short path of the CI runner), Shared, any <…>, an ellipsis (C:\Users\…) and any
// variable ($USER, ${USER}, %USERNAME%); a UUID of one repeated digit (00000000-0000-0000-0000-000000000000, and
// 44444444-4444-4444-8444-444444444444, where the version and variant digits differ); the addresses
// noreply@… / no-reply@…, …@users.noreply.github.com, git@github.com, any address at example.* or
// a subdomain of it, and a file name with @ (icon@2x.png); a host with an `example` label
// (pc.example.ts.net); localhost; a home folder name that starts with a dot (<sandbox>/home/.gitconfig). There is no allow list in the repository: a false finding is fixed by
// writing the value in a stand-in form (~, %USERPROFILE%, <host>, <uuid>), so that the allow list
// does not publish the value itself.
//
// A change of a rule is a change of this file and of harness/bin/tests/evidence-check.test.sh.
"use strict"

const STAND_IN_NAMES = new Set(["test", "someone", "user", "you", "runner", "runneradmin", "runner~1", "shared"])

// The characters of a user name in a path: anything but a separator, white space, quotes and the
// characters a path cannot hold. `<` is left out, so a <…> stand-in never matches.
const NAME = String.raw`[^\s\\/"'\x60<>|:*?,;()\[\]{}=&]+`
const RULES = [
    // Users or home at the root, after /c or /mnt/c; not inside a URL or a longer path, nor after a
    // stand-in (<tmp>/home/…, …/home/…).
    { rule: "home-path", re: new RegExp(String.raw`(?<![\w.~>…*-])(?:/mnt)?(?:/[A-Za-z])?/(?:Users|home)/(${NAME})`, "g"), group: 1 },
    // C:\Users\<name>, C:\\Users\\<name> (JSON), and with / in place of \.
    { rule: "home-path", re: new RegExp(String.raw`(?<![A-Za-z])[A-Za-z]:(?:\\+|/)Users(?:\\+|/)(${NAME})`, "gi"), group: 1 },
    // *.local — not .env.local, ~/.local, settings.local.json or localhost.
    { rule: "host", re: /(?<![\w.-])[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.local(?![\w-]|\.[A-Za-z0-9])/g },
    { rule: "host", re: /(?<![\w.-])[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.ts\.net(?![\w-])/gi },
    { rule: "host", re: /\bDESKTOP-[A-Za-z0-9]{7}(?![\w-])/g },
    { rule: "host", re: /(?<![\w.-])[A-Za-z0-9][A-Za-z0-9-]*-MacBook[A-Za-z0-9-]*/g },
    { rule: "host", re: /(?<![\w.-])[A-Za-z0-9][A-Za-z0-9-]*s-Mac(?:-[A-Za-z0-9-]+)?(?![\w])/g },
    { rule: "host", re: /(?<![\w.-])[A-Za-z0-9][A-Za-z0-9-]*-PC(?![\w-])/g },
    {
        rule: "tailscale-ip",
        re: /(?<![\d.])100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)(?!\d|\.\d|\/\d)/g,
    },
    { rule: "uuid", re: /(?<![0-9A-Fa-f-])[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}(?![0-9A-Fa-f-])/g },
    { rule: "email", re: /(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g },
    { rule: "token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
    { rule: "token", re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
    { rule: "token", re: /\bsk-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/g }, // a digit: not a branch like sk-learn-upgrade-…
    { rule: "token", re: /\bAKIA[0-9A-Z]{16}(?![0-9A-Za-z])/g },
    { rule: "token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
    { rule: "token", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
    { rule: "token", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g },
    { rule: "token", re: /\bBearer\s+([A-Za-z0-9._~+/-]{16,}=*)/g, group: 1 },
]

// A stand-in user name of a home path.
function standInName(name) {
    return STAND_IN_NAMES.has(name.toLowerCase()) || /^(?:\$\{?\w+\}?|%\w+%|…+|\..*)$/.test(name)
}

// A stand-in UUID: one repeated hex digit, apart from the version (13th) and the variant (17th) digit.
function standInUuid(value) {
    const hex = value.replace(/-/g, "").toLowerCase()
    const rest = hex.slice(0, 12) + hex.slice(13, 16) + hex.slice(17)
    return new Set(rest).size === 1
}

// The extension of a file name after @ (icon_16x16@2x.png) is not the top-level domain of an address.
const FILE_TLD = /\.(?:png|jpe?g|gif|webp|svg|ico|pdf|json|jsonl|md|txt|log|js|cjs|mjs|ts|tsx|css|html|ya?ml|sh|zip)$/

function standInEmail(value) {
    const at = value.lastIndexOf("@")
    const local = value.slice(0, at).toLowerCase()
    const domain = value.slice(at + 1).toLowerCase()
    if (local === "noreply" || local === "no-reply" || FILE_TLD.test(domain)) return true
    if (domain === "users.noreply.github.com" || value.toLowerCase() === "git@github.com") return true
    return /(?:^|\.)example\.[a-z]+$/.test(domain)
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function findings(text, options = {}) {
    const s = String(text)
    const found = []
    const add = (rule, index, length) => {
        if (length > 0) found.push({ rule, index, length })
    }
    for (const { rule, re, group } of RULES) {
        re.lastIndex = 0
        for (const m of s.matchAll(re)) {
            let index = m.index
            let value = m[0]
            if (group) {
                value = m[group]
                index = m.index + m[0].lastIndexOf(value)
            }
            if (rule === "home-path") {
                value = value.replace(/\.+$/, "") // the full stop of a sentence is not part of the name
                if (standInName(value)) continue
            }
            if (rule === "uuid" && standInUuid(value)) continue
            if (rule === "email" && standInEmail(value)) continue
            if (rule === "host" && /(?:^|\.)example\./i.test(value)) continue
            add(rule, index, value.length)
        }
    }
    const host = typeof options.hostname === "string" ? options.hostname.split(".")[0].trim() : ""
    if (host.length >= 3 && host.toLowerCase() !== "localhost") {
        const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(host)}(?![A-Za-z0-9])`, "gi")
        for (const m of s.matchAll(re)) add("host", m.index, m[0].length)
    }
    for (const word of Array.isArray(options.deny) ? options.deny : []) {
        if (typeof word !== "string" || word.trim() === "") continue
        const re = new RegExp(escapeRe(word.trim()), "gi")
        for (const m of s.matchAll(re)) add("deny", m.index, m[0].length)
    }
    // One finding per place: a finding inside another one (<name>-MacBook-Pro inside <name>-MacBook-Pro.local,
    // or the same span found by two rules) is dropped; the longer one, or the earlier rule, stays.
    found.sort((a, b) => a.index - b.index || b.length - a.length)
    const kept = []
    for (const f of found) {
        const outer = kept.find((k) => k.index <= f.index && f.index + f.length <= k.index + k.length)
        if (!outer) kept.push(f)
    }
    return kept
}

function mask(value) {
    const chars = [...String(value)]
    const keep = chars.length > 3 ? 2 : chars.length > 1 ? 1 : 0
    return `${chars.slice(0, keep).join("")}…(${chars.length})`
}

function maskText(text, options = {}) {
    const s = String(text)
    // Merge overlapping findings into spans, then replace each span from the end.
    const spans = []
    for (const f of findings(s, options)) {
        const last = spans[spans.length - 1]
        if (last && f.index < last.end) last.end = Math.max(last.end, f.index + f.length)
        else spans.push({ start: f.index, end: f.index + f.length })
    }
    let out = s
    for (let i = spans.length - 1; i >= 0; i--) {
        const { start, end } = spans[i]
        out = out.slice(0, start) + mask(s.slice(start, end)) + out.slice(end)
    }
    return out
}

function personal(harnessHome) {
    try {
        const fs = require("node:fs")
        const path = require("node:path")
        const data = JSON.parse(fs.readFileSync(path.join(String(harnessHome), "user", "privacy.json"), "utf8"))
        const deny = Array.isArray(data?.deny) ? data.deny.filter((w) => typeof w === "string" && w.trim() !== "") : []
        return { deny }
    } catch {
        return { deny: [] }
    }
}

module.exports = { findings, mask, maskText, personal }
