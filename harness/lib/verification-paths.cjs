// The verification paths of a project: the files that judge work rather than do it — CI workflows, the
// scripts that pick what CI runs, the Quarantine of flaky tests, the settings of tests and lint, the review
// agents, the Harness hooks (profiles/README.md, verification.paths). One list for every reader: bin/profile
// prints it, and the guard hook and bin/land are to ask this module, never a copy of the list.
//
//   DEFAULT_VERIFICATION_PATHS            the globs every project has, whatever its profile says
//   verificationPaths(profile)            the defaults, then the globs of the profile's verification.paths,
//                                         each once; the profile only adds: an empty list, null, a value of
//                                         another shape or a negated glob ("!CLAUDE.md") removes no default
//   verificationProblems(profile)         what is wrong with verification and verification.paths, as
//                                         [{ path, message }] (lib/profile-rules.cjs: bin/profile refuses such
//                                         a profile, bin/profile-set does not write it); [] when nothing is
//   normalizePath(file, { platform, root })
//                                         the path from the root of the repository, "/"-separated, or null
//                                         when it is not inside the repository (../x, an absolute path outside
//                                         root, an absolute path without root)
//   isVerificationPath(file, paths, { platform, root })
//                                         whether the file matches one of the globs `paths`
//
// A glob is matched against the whole path from the root of the repository: `*` and `?` never cross a
// "/", `**` as a whole segment is any number of segments (none too), `{a,b}` is one of its parts. Any
// other character is itself; there is no negation, a glob only ever adds files.
// Paths are compared with "\" read as "/" on every platform — a path that reaches a hook from Windows
// may carry either — and without letter case on Windows and macOS, whose file systems ignore it by
// default: `.GitHub/Workflows/ci.yml` there is the same file as `.github/workflows/ci.yml`.
//
// CommonJS, like pipeline.cjs: the scripts of bin/ and hooks/ are CommonJS and `require` it.
"use strict"

const path = require("node:path")

const DEFAULT_VERIFICATION_PATHS = Object.freeze([
    ".github/workflows/**",
    ".github/actions/**",
    "CLAUDE.md",
    "AGENTS.md",
    ".claude/**",
    ".codex/**",
    ".mcp.json",
])

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const given = (v) => v !== undefined && v !== null
const usable = (glob) => typeof glob === "string" && glob.trim() !== "" && !glob.startsWith("!")

/** The problems of verification and verification.paths of `profile`; [] when it has none. */
function verificationProblems(profile) {
    if (!isObject(profile) || !given(profile.verification)) return []
    const v = profile.verification
    if (!isObject(v)) return [{ path: "verification", message: `verification is an object or null, got ${JSON.stringify(v)}` }]
    if (!given(v.paths)) return []
    if (!Array.isArray(v.paths))
        return [{ path: "verification.paths", message: `verification.paths is a list of globs or null, got ${JSON.stringify(v.paths)}` }]
    const problems = []
    v.paths.forEach((glob, i) => {
        const at = `verification.paths[${i}]`
        if (typeof glob !== "string" || glob.trim() === "") problems.push({ path: at, message: `${at} is a glob, got ${JSON.stringify(glob)}` })
        else if (glob.startsWith("!"))
            problems.push({
                path: at,
                message: `${at} ${JSON.stringify(glob)}: verification.paths only adds to the defaults, a negated glob removes nothing`,
            })
    })
    return problems
}

/** The defaults, then the usable globs of the profile's verification.paths, each once. */
function verificationPaths(profile) {
    const v = isObject(profile) ? profile.verification : undefined
    const added = isObject(v) && Array.isArray(v.paths) ? v.paths.filter(usable) : []
    return [...new Set([...DEFAULT_VERIFICATION_PATHS, ...added])]
}

const ignoresCase = (platform) => platform === "win32" || platform === "darwin"
const slashes = (p) => p.replace(/\\/g, "/")
const isAbsolute = (p) => p.startsWith("/") || /^[A-Za-z]:\//.test(p)

/** `file` from the root of the repository, "/"-separated; null when it is not inside it. */
function normalizePath(file, options = {}) {
    if (typeof file !== "string" || file === "") return null
    const fold = ignoresCase(options.platform || process.platform)
    let p = slashes(file)
    if (isAbsolute(p)) {
        if (typeof options.root !== "string" || options.root === "") return null
        const root = path.posix.normalize(slashes(options.root)).replace(/\/+$/, "")
        const abs = path.posix.normalize(p)
        const same = (a, b) => (fold ? a.toLowerCase() === b.toLowerCase() : a === b)
        if (!same(abs.slice(0, root.length + 1), root + "/")) return null
        p = abs.slice(root.length + 1)
    }
    p = path.posix.normalize(p).replace(/\/+$/, "")
    if (p === "." || p === "" || p === ".." || p.startsWith("../") || p.startsWith("/")) return null
    return p
}

const literal = (c) => c.replace(/[.+^${}()|[\]\\*?]/g, "\\$&")

/** The index of the "}" that closes the "{" at `open`, or -1. */
function closing(glob, open) {
    let depth = 0
    for (let i = open; i < glob.length; i++) {
        if (glob[i] === "{") depth++
        else if (glob[i] === "}" && --depth === 0) return i
    }
    return -1
}

/** The parts of a brace body split at its top-level commas. */
function parts(body) {
    const out = []
    let depth = 0
    let start = 0
    for (let i = 0; i < body.length; i++) {
        if (body[i] === "{") depth++
        else if (body[i] === "}") depth--
        else if (body[i] === "," && depth === 0) {
            out.push(body.slice(start, i))
            start = i + 1
        }
    }
    out.push(body.slice(start))
    return out
}

/** The regular expression source of a glob, unanchored. */
function source(glob) {
    let re = ""
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i]
        if (c === "*" && glob[i + 1] === "*") {
            const startsSegment = i === 0 || glob[i - 1] === "/"
            const endsSegment = i + 2 === glob.length || glob[i + 2] === "/"
            if (startsSegment && endsSegment) {
                if (i + 2 === glob.length) re += ".*"
                else {
                    // "**/": no segment, or any number of them.
                    re += "(?:.*/)?"
                    i++
                }
                i++
                continue
            }
            re += "[^/]*"
            i++
        } else if (c === "*") re += "[^/]*"
        else if (c === "?") re += "[^/]"
        else if (c === "{") {
            const end = closing(glob, i)
            if (end === -1) re += literal(c)
            else {
                re += `(?:${parts(glob.slice(i + 1, end)).map(source).join("|")})`
                i = end
            }
        } else re += literal(c)
    }
    return re
}

/** Whether `file` matches one of the globs `paths`. */
function isVerificationPath(file, paths, options = {}) {
    const p = normalizePath(file, options)
    if (p === null || !Array.isArray(paths)) return false
    const flags = ignoresCase(options.platform || process.platform) ? "i" : ""
    return paths.some((glob) => usable(glob) && new RegExp(`^${source(glob)}$`, flags).test(p))
}

module.exports = { DEFAULT_VERIFICATION_PATHS, verificationPaths, verificationProblems, normalizePath, isVerificationPath }
