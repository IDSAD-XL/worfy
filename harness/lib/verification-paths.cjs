// The verification paths of a project: the files that judge work rather than do it — CI workflows, the
// scripts that pick what CI runs, the Quarantine of flaky tests, the settings of tests and lint, the review
// agents, the Harness hooks (profiles/README.md, verification.paths). One list for every reader: bin/profile
// prints it, and the guard hook and bin/land are to ask this module, never a copy of the list.
//
//   DEFAULT_VERIFICATION_PATHS            the globs every project has, whatever its profile says
//   verificationPaths(profile)            the defaults, then the globs of the profile's verification.paths,
//                                         as normalizeGlob writes them, each once; the profile only adds: an
//                                         empty list, null, a value of another shape or a negated glob
//                                         ("!CLAUDE.md") removes no default
//   verificationProblems(profile)         what is wrong with verification and verification.paths, as
//                                         [{ path, message }] (lib/profile-rules.cjs: bin/profile refuses such
//                                         a profile, bin/profile-set does not write it); [] when nothing is
//   normalizeGlob(glob)                   a glob as it matches: "./", "." segments, a leading "/" and doubled "/" dropped,
//                                         "tools/" read as "tools/**"; null for a blank, negated or ".." glob
//   normalizePath(file, { platform, root })
//                                         the path from the root of the repository, "/"-separated, or null
//                                         when it is not inside the repository; with root a relative path is
//                                         taken from root first, so "../repo/x" back inside it counts, and a relative root ("." or "./") from
//                                         the working directory; without
//                                         root "../x" and an absolute path are outside
//   isVerificationPath(file, paths, { platform, root })
//                                         whether the file matches one of the globs `paths`
//
// A glob is matched against the whole path from the root of the repository: `*` and `?` never cross a
// "/", `**` as a whole segment is any number of segments (none too), `{a,b}` is one of its parts. Any
// other character is itself; there is no negation, a glob only ever adds files.
// Paths and globs are compared with "\" read as "/" on every platform — a path that reaches a hook from
// Windows may carry either — and without letter case on Windows and macOS, whose file systems ignore it by
// default: `.GitHub/Workflows/` there is the same folder as `.github/workflows/`. On Windows a Git Bash
// path /c/x is the same as c:/x, in the file and in the root.
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
const slashes = (p) => p.replace(/\\/g, "/")

/**
 * A glob of the profile written the way it matches: trimmed, "\\" read as "/", "./", a "." segment and a leading "/" dropped
 * (a glob is matched from the root of the repository; "x/./y" is "x/y"), doubled "/" made one, a trailing "/" read as the whole
 * folder ("tools/" is "tools/**"). null when nothing usable is left: not a string, blank, a negation, only
 * separators and ".", or a glob that leaves the repository (a ".." segment).
 */
function normalizeGlob(glob) {
    if (typeof glob !== "string") return null
    let g = slashes(glob.trim())
    if (g === "" || g.startsWith("!")) return null
    g = g.replace(/\/{2,}/g, "/")
    // A "." segment names the folder it stands in: "./x" is "x", "x/./y" is "x/y", "x/." is "x/".
    const dot = /(^|\/)\.(\/|$)/
    while (dot.test(g)) g = g.replace(dot, "$1")
    g = g.replace(/^\/+/, "")
    if (g.endsWith("/")) g += "**"
    if (g === "" || g === "." || g.split("/").includes("..")) return null
    return g
}

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
        else if (glob.trim().startsWith("!"))
            problems.push({
                path: at,
                message: `${at} ${JSON.stringify(glob)}: verification.paths only adds to the defaults, a negated glob removes nothing`,
            })
        else if (normalizeGlob(glob) === null)
            problems.push({ path: at, message: `${at} ${JSON.stringify(glob)}: a glob names files inside the repository, from its root` })
    })
    return problems
}

/** The defaults, then the usable globs of the profile's verification.paths as normalizeGlob writes them, each once. */
function verificationPaths(profile) {
    const v = isObject(profile) ? profile.verification : undefined
    const added = isObject(v) && Array.isArray(v.paths) ? v.paths.map(normalizeGlob).filter((g) => g !== null) : []
    return [...new Set([...DEFAULT_VERIFICATION_PATHS, ...added])]
}

const ignoresCase = (platform) => platform === "win32" || platform === "darwin"
const isAbsolute = (p) => p.startsWith("/") || /^[A-Za-z]:\//.test(p)
// Git Bash on Windows spells C:\\x as /c/x: on win32 both are the same absolute path.
const drive = (p, platform) => (platform === "win32" ? p.replace(/^\/([A-Za-z])(?=\/|$)/, "$1:") : p)

/** `file` from the root of the repository, "/"-separated; null when it is not inside it. */
function normalizePath(file, options = {}) {
    if (typeof file !== "string" || file === "") return null
    const platform = options.platform || process.platform
    const fold = ignoresCase(platform)
    let p = drive(slashes(file), platform)
    const hasRoot = typeof options.root === "string" && options.root !== ""
    if (isAbsolute(p) || hasRoot) {
        if (!hasRoot) return null
        let root = drive(slashes(options.root), platform)
        // A relative root ("." or "./") is taken from the working directory, as the file system takes it.
        if (!isAbsolute(root)) root = `${drive(slashes(process.cwd()), platform)}/${root}`
        root = path.posix.normalize(root).replace(/\/+$/, "")
        // A relative path is taken from the root first, so "../repo/x" that comes back inside it counts.
        const abs = path.posix.normalize(isAbsolute(p) ? p : `${root}/${p}`)
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
    return paths.some((glob) => {
        const g = normalizeGlob(glob)
        return g !== null && new RegExp(`^${source(g)}$`, flags).test(p)
    })
}

module.exports = { DEFAULT_VERIFICATION_PATHS, verificationPaths, verificationProblems, normalizeGlob, normalizePath, isVerificationPath }
