// The protected areas of the guard hook (hooks/guard.mjs, section 5): the folders and files of the home folder that
// hold secrets or settings, %APPDATA% on Windows, worfy's data folder and the Harness home — the hard-deny areas of
// worfy's approval policy (roots.ts of its auto-approve module, HOME_AREAS and rootsOf), which judges only the
// permission requests an agent makes, so none in bypassPermissions or in Codex's Full access. The guard refuses a
// write or a removal there in any permission mode; a read is never refused (agents read the rules of the Harness under
// ~/.claude/worfy-harness/projects/). The same list, by the same ids, is in roots.ts: test/contract/
// guard-policy-parity.test.ts holds the two together, so a new area of one fails it until the other has it.
//
//   HOME_AREAS                      [id, name] under each home folder, in the order of roots.ts
//   AREA_IDS                        every id an area refusal carries (the categories of roots.ts but the two that need
//                                   the folders of a Run: other-session, other-worktree)
//   COMMAND_IDS                     the ids of the command rules of section 5: os-settings, run-download
//   GIT_FILES_ID                    the id of a direct write into .git/hooks/ or .git/config of any repository
//   OS_SETTINGS, OS_SETTINGS_SOME, DEFAULTS_READS
//                                   the programs of the os-settings rule, as policy.ts names them
//   protectedAreas({ env, platform, homedir, harnessHome })
//                                   [{ id, path }] — the areas on this machine: each home folder (HOME, the Git Bash
//                                   form /c/… read as C:/…, and the system's home), XDG_CONFIG_HOME/{gh,git},
//                                   %APPDATA% (Windows), worfy's data folder (WORFY_GUARD_DATA_DIR, which worfy sets
//                                   for the Sessions it starts when WORFY_DATA_DIR moved it, and both default folders
//                                   of the platform, worfy and worfy-dev) and the Harness home
//   openPlaces(areas, { env, platform })
//                                   the patterns inside the areas that stay open (`*` is one folder): the memory and
//                                   the plans Claude Code has a Session write with Write and Edit
//                                   (<home>/.claude/projects/*/memory, <home>/.claude/plans; spike 01 of the
//                                   worfy-harness-guarantees epic), the Cards folder of each Project
//                                   (<worfy data>/*/cards), and TMPDIR when it lies below an area (the Run's
//                                   temporary folder worfy gives an unattended Session is in its data folder)
//   areaOf(file, areas, open, { platform, folder })
//                                   the area ({ id, path }) an absolute path writes into, or null: inside an area and
//                                   not inside an open place, the most specific area (worfy-harness inside .claude);
//                                   with folder, a path above an area too, the first area of the list there (`rm -r ~`
//                                   removes them all)
//   gitFileOf(file, { platform })   whether the path is a direct write into .git/hooks/ or .git/config
//
// Paths are compared with "\" read as "/" and without letter case on Windows and macOS, whose file systems ignore it
// by default, as lib/verification-paths.cjs compares them. The guard passes each path twice: as the command names it
// and through the symbolic links of its nearest existing folder, so a link into an area counts.
//
// CommonJS, like the other modules of lib/: the hooks `require` it.
"use strict"

const SHELL_RC = [".zshrc", ".zshenv", ".zprofile", ".zlogin", ".zlogout", ".bashrc", ".bash_profile", ".bash_login", ".bash_logout", ".profile", ".inputrc"]

const HOME_AREAS = [
    ["claude-home", ".claude"],
    ["codex-home", ".codex"],
    ["ssh", ".ssh"],
    ["gnupg", ".gnupg"],
    ["gh-config", ".config/gh"],
    ["git-config", ".gitconfig"],
    ["git-config", ".git-credentials"],
    ["git-config", ".config/git"],
    ["npmrc", ".npmrc"],
    ["library", "Library"],
    ...SHELL_RC.map((name) => ["shell-rc", name]),
]

const AREA_IDS = [...new Set(HOME_AREAS.map(([id]) => id)), "appdata", "worfy-data", "harness-home"]
const COMMAND_IDS = ["os-settings", "run-download"]
const GIT_FILES_ID = "git-files"

// policy.ts, OS_SETTINGS, OS_SETTINGS_SOME and DEFAULTS_READS: a program of the first list changes the settings of
// the OS whatever it is given; one of the second only past its reads.
const OS_SETTINGS = ["sudo", "su", "doas", "launchctl", "security", "pfctl", "socketfilterfw", "netsh", "reg", "crontab"]
const OS_SETTINGS_SOME = ["defaults", "schtasks", "networksetup"]
const DEFAULTS_READS = ["read", "read-type", "domains", "find", "help"]

const foldsCase = (platform) => platform === "win32" || platform === "darwin"

// A path as it is compared: "/"-separated, a Git Bash drive (/c/…) read as C:/… on Windows, no doubled or trailing
// "/", the letter case folded where the file system ignores it. Null for a path that is not absolute.
function keyOf(file, platform) {
    if (typeof file !== "string" || file === "") return null
    let p = file.replace(/\\/g, "/")
    if (platform === "win32") p = p.replace(/^\/([A-Za-z])(?=\/|$)/, "$1:").replace(/^([a-z]):/, (_m, d) => `${d.toUpperCase()}:`)
    p = p.replace(/\/{2,}/g, "/")
    if (p.length > 1) p = p.replace(/\/+$/, "")
    if (/^[A-Za-z]:$/.test(p)) p += "/"
    if (!(p.startsWith("/") || /^[A-Za-z]:\//.test(p))) return null
    return foldsCase(platform) ? p.toLowerCase() : p
}

const within = (key, area) => key === area || key.startsWith(area.endsWith("/") ? area : `${area}/`)

// The home folders a command may mean: HOME as the shell of the command has it (on Windows Git Bash may spell it
// /c/…) and the system's home (USERPROFILE on Windows).
function homes(env, platform, homedir) {
    const out = []
    for (const h of [env.HOME, platform === "win32" ? env.USERPROFILE : undefined, homedir])
        if (typeof h === "string" && keyOf(h, platform) !== null && !out.some((o) => keyOf(o, platform) === keyOf(h, platform))) out.push(h)
    return out
}

const join = (base, rel) => `${base.replace(/[\\/]+$/, "")}/${rel}`

function protectedAreas({ env = process.env, platform = process.platform, homedir, harnessHome } = {}) {
    const areas = []
    const add = (id, p) => {
        if (keyOf(p, platform) !== null && !areas.some((a) => a.id === id && keyOf(a.path, platform) === keyOf(p, platform))) areas.push({ id, path: p })
    }
    const hs = homes(env, platform, homedir)
    for (const h of hs) for (const [id, rel] of HOME_AREAS) add(id, join(h, rel))
    if (env.XDG_CONFIG_HOME) {
        add("gh-config", join(env.XDG_CONFIG_HOME, "gh"))
        add("git-config", join(env.XDG_CONFIG_HOME, "git"))
    }
    const appData = platform === "win32" ? (keyOf(env.APPDATA, platform) !== null ? env.APPDATA : hs[hs.length - 1] ? join(hs[hs.length - 1], "AppData/Roaming") : null) : null
    if (appData) add("appdata", appData)
    for (const d of dataFolders(env, platform, hs, appData)) add("worfy-data", d)
    if (harnessHome) add("harness-home", harnessHome)
    return areas
}

// worfy's data folders: the one worfy named for the Session, and the defaults of both builds (its storage module, paths.ts,
// dataRoot): %APPDATA%\worfy on Windows, ~/Library/Application Support/worfy elsewhere, and worfy-dev of a dev run.
function dataFolders(env, platform, hs, appData) {
    const out = []
    if (env.WORFY_GUARD_DATA_DIR) out.push(env.WORFY_GUARD_DATA_DIR)
    const bases = platform === "win32" ? (appData ? [appData] : []) : hs.map((h) => join(h, "Library/Application Support"))
    for (const b of bases) out.push(join(b, "worfy"), join(b, "worfy-dev"))
    return out
}

function openPlaces(areas, { env = process.env, platform = process.platform } = {}) {
    const out = []
    for (const a of areas) {
        if (a.id === "claude-home") out.push(join(a.path, "projects/*/memory"), join(a.path, "plans"))
        if (a.id === "worfy-data") out.push(join(a.path, "*/cards"))
    }
    // The Session's own temporary folder, when it lies below an area: worfy gives an unattended Session
    // <worfy data>/autopilot-tmp/<run> as TMPDIR (run-approval.ts, runTempsDir).
    const tmp = keyOf(env.TMPDIR, platform)
    if (tmp !== null && areas.some((a) => { const k = keyOf(a.path, platform); return k !== null && k !== tmp && within(tmp, k) })) out.push(tmp)
    return out.map((p) => keyOf(p, platform)).filter(Boolean)
}

// Whether `key` is the pattern `open` or below it; `*` is one folder of any name.
function inOpen(key, open) {
    const k = key.split("/")
    const o = open.split("/")
    if (k.length < o.length) return false
    return o.every((part, i) => part === "*" ? k[i] !== "" : part === k[i])
}

function areaOf(file, areas, open, { platform = process.platform, folder = false } = {}) {
    const key = keyOf(file, platform)
    if (key === null) return null
    if (open.some((o) => inOpen(key, o))) return null
    let best = null
    let above = null
    for (const a of areas) {
        const ak = keyOf(a.path, platform)
        if (ak === null) continue
        if (within(key, ak)) {
            if (best === null || ak.length > best.len) best = { id: a.id, path: a.path, len: ak.length }
        } else if (folder && above === null && within(ak, key)) above = { id: a.id, path: a.path }
    }
    if (best) return { id: best.id, path: best.path }
    return above
}

function gitFileOf(file, { platform = process.platform } = {}) {
    const key = keyOf(file, platform)
    if (key === null) return false
    const parts = key.split("/")
    for (let i = 0; i < parts.length - 1; i++) {
        if (parts[i] !== ".git") continue
        if (parts[i + 1] === "hooks") return true
        if (parts[i + 1] === "config" && i + 2 === parts.length) return true
    }
    return false
}

module.exports = {
    HOME_AREAS,
    AREA_IDS,
    COMMAND_IDS,
    GIT_FILES_ID,
    OS_SETTINGS,
    OS_SETTINGS_SOME,
    DEFAULTS_READS,
    keyOf,
    protectedAreas,
    openPlaces,
    areaOf,
    gitFileOf,
}
