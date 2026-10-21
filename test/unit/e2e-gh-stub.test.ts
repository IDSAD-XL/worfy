// No e2e start of the app can reach the machine's own gh (worfy-windows ticket 80). On 2026-10-21
// a gh.exe watcher on Windows saw `gh --version` and `gh auth status` from the app under test: the
// window.spec.ts starts that run Electron themselves left out WORFY_FIRST_RUN_AUTO=0, so the
// first-run screen opened and checked, and the first-run checks ran gh from the Path, not WORFY_GH.
//
// What keeps gh to the stand-in, and what this file checks:
// - every start of the app gets the isolation variables of test/e2e/launch-env.ts — launchEnv when
//   Playwright starts it, directStartEnv when a spec does — with WORFY_GH on the gh stub and the
//   first-run screen off;
// - a spec starts the app only through those: Playwright's Electron only in helpers.ts, and every
//   process a spec starts by a computed path (not a program name) is either a known tool or the app
//   with the env of directStartEnv;
// - worfy starts gh only through WORFY_GH: no process start of a bare `gh` anywhere in src/main, and
//   the places that pick the gh program are the known WORFY_GH-aware ones;
// - the first-run checks get WORFY_GH (src/main/ipc/first-run.ts) and run it for both gh rows
//   (test/unit/first-run-windows.test.ts, "the gh rows and WORFY_GH").
// It reads the source text, so a start written some other way is not seen: an aliased import of
// spawn, a program name built at run time, the app started through a launcher named by a literal
// (`npx electron .`, `open`, `sh -c`). An `env` shorthand counts by the file's last `const env =`
// before the call, whatever function it is in. The detectors' own tests below show what is seen.
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { directStartEnv, GH_STUB, launchEnv } from '../e2e/launch-env'
import { removeTestTree } from '../remove'

const REPO = join(import.meta.dirname, '..', '..')

interface Source {
  /** The path from the repository root, with forward slashes. */
  name: string
  text: string
}

/** Every .ts file under `dir`, at any depth. */
function sources(dir: string): Source[] {
  const found: Source[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sources(path))
    else if (entry.name.endsWith('.ts')) found.push({ name: relative(REPO, path).split(sep).join('/'), text: readFileSync(path, 'utf8') })
  }
  return found
}

/** The code without its comments: block comments and lines that are a `//` comment. */
const code = (text: string): string => text.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '')

/** From the `(` at `open`: the text up to its `)`, or up to the first top-level comma with `untilComma`. Strings are skipped. */
function argumentsAt(text: string, open: number, untilComma = false): string {
  let depth = 0
  let quote: string | null = null
  for (let at = open; at < text.length; at++) {
    const char = text[at]
    if (quote !== null) {
      if (char === '\\') at++
      else if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') quote = char
    else if (char === '(' || char === '[' || char === '{') depth++
    else if (char === ')' || char === ']' || char === '}') {
      depth--
      if (depth === 0) return text.slice(open + 1, at).trim()
    } else if (char === ',' && depth === 1 && untilComma) return text.slice(open + 1, at).trim()
  }
  return text.slice(open + 1).trim()
}

interface Start {
  file: string
  line: number
  /** The first argument: the program. */
  program: string
  /** All the arguments. */
  args: string
  /** Whether its env is the env of directStartEnv. */
  directStartEnv: boolean
}

const STARTERS = '(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)'

/** Every process a source starts through node:child_process. A `.exec(` of a RegExp or `pty.spawn(` is not one. */
function processStarts(source: Source): Start[] {
  const text = code(source.text)
  const found: Start[] = []
  for (const match of text.matchAll(new RegExp(`(?:(?<![\\w$.])|\\bchild_process\\.)${STARTERS}\\s*\\(`, 'g'))) {
    const open = match.index + match[0].length - 1
    const args = argumentsAt(text, open)
    // The env: directStartEnv right there, or `env` shorthand whose last assignment before the call is directStartEnv.
    let fromDirectStart = /\benv:\s*directStartEnv\(/.test(args)
    if (!fromDirectStart && /(?:^|[{,\s])env\s*[,}]/.test(args)) {
      const assignments = [...text.slice(0, match.index).matchAll(/\b(?:const|let)\s+env\b[^=\n]*=\s*(\S+)/g)]
      fromDirectStart = /^directStartEnv\(/.test(assignments.at(-1)?.[1] ?? '')
    }
    found.push({ file: source.name, line: text.slice(0, match.index).split('\n').length, program: argumentsAt(text, open, true), args, directStartEnv: fromDirectStart })
  }
  return found
}

/** A program named by a string literal (`'git'`) or Node itself is a tool; anything else, or a literal naming Electron or worfy, may be the app. */
const mayBeTheApp = (start: Start): boolean =>
  /electron|worfy/i.test(start.program) || !(/^(['"`])[^'"`]*\1$/.test(start.program) || start.program === 'process.execPath')

// Programs by a computed path that are not the app, each with what it is.
const KNOWN_TOOLS = [
  // The Claude Code binary inside the packaged app, run with --version.
  'test/e2e/packaged.spec.ts: binary',
  // The Limits bridge script of the packaged app.
  'test/e2e/packaged.spec.ts: bridge',
  // The Harness's bin/profile in the sandbox Harness.
  "test/e2e/projects-connect.spec.ts: join(harnessHome, 'plugin', 'bin', 'profile')",
]

/** The starts that may be the app and do not take the env of directStartEnv. */
function looseAppStarts(files: readonly Source[]): string[] {
  return files
    .flatMap(processStarts)
    .filter((start) => mayBeTheApp(start) && !KNOWN_TOOLS.includes(`${start.file}: ${start.program}`) && !start.directStartEnv)
    .map((start) => `${start.file}:${start.line} ${start.program}`)
}

/** Process starts of gh by its bare name, directly or as a command line. */
function bareGhStarts(files: readonly Source[]): string[] {
  return files.flatMap((file) =>
    [...code(file.text).matchAll(/(?<![\w$])(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|fork|spawnNodePty|runTool|run)\s*\(\s*['"`]gh\b/g)].map((match) => `${file.name}: ${match[0]}`),
  )
}

const e2e = sources(join(REPO, 'test', 'e2e'))
const main = sources(join(REPO, 'src', 'main'))
const scratch = mkdtempSync(join(tmpdir(), 'worfy-e2e-gh-stub-'))
afterAll(() => removeTestTree(scratch))

describe('every e2e start of the app gets the gh stub', () => {
  it('launchEnv: WORFY_GH is the stub and the first-run screen is off, whatever the test process has', async () => {
    const env = await launchEnv({ dataDir: 'd', claudeHome: 'c', shellDir: mkdtempSync(join(scratch, 'shell-')), source: { WORFY_GH: 'gh', WORFY_FIRST_RUN_AUTO: '1', PATH: '/usr/bin' } })
    expect(env).toMatchObject({ WORFY_GH: GH_STUB, WORFY_FIRST_RUN_AUTO: '0' })
  })

  it('directStartEnv: the same, with the spec\'s own variables on top', () => {
    const env = directStartEnv({ dataDir: 'd', claudeHome: 'c', source: { WORFY_GH: 'gh', WORFY_FIRST_RUN_AUTO: '1', ELECTRON_RUN_AS_NODE: '1' }, env: { WORFY_STARTUP_DIALOG: 'off' } })
    expect(env).toMatchObject({ WORFY_GH: GH_STUB, WORFY_FIRST_RUN_AUTO: '0', WORFY_DATA_DIR: 'd', WORFY_CLAUDE_HOME: 'c', WORFY_STARTUP_DIALOG: 'off' })
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('Playwright\'s Electron is used only in helpers.ts, with launchEnv', () => {
    // Imported under any local name (`import { _electron as electron }`), in any folder of test/e2e.
    const users = e2e.filter((file) => /import\s*\{[^}]*\b_electron\b[^}]*\}\s*from\s*['"]@playwright\/test['"]|\._electron\b/.test(code(file.text))).map((file) => file.name)
    expect(users).toEqual(['test/e2e/helpers.ts'])
    expect(e2e.find((file) => file.name === 'test/e2e/helpers.ts')?.text).toMatch(/await launchEnv\(/)
  })

  it('every process a spec starts by a computed path is a known tool or the app with the env of directStartEnv', () => {
    expect(looseAppStarts(e2e)).toEqual([])
    // The list of known tools names starts that are still there.
    const programs = e2e.flatMap(processStarts).map((start) => `${start.file}: ${start.program}`)
    for (const tool of KNOWN_TOOLS) expect(programs, tool).toContain(tool)
    // And the app starts of today are seen: two in window.spec.ts, two in packaged.spec.ts.
    expect(e2e.flatMap(processStarts).filter((start) => start.directStartEnv).map((start) => start.file)).toEqual(['test/e2e/packaged.spec.ts', 'test/e2e/packaged.spec.ts', 'test/e2e/window.spec.ts', 'test/e2e/window.spec.ts'])
  })

  it('the detector of app starts: a hand-built env, require(\'electron\'), execFile, fork and spawnSync are each caught', () => {
    const spec = (text: string): Source[] => [{ name: 'test/e2e/x.spec.ts', text }]
    expect(looseAppStarts(spec("const child = spawn(electron, [repoRoot], { env: { ...process.env } })"))).toEqual(['test/e2e/x.spec.ts:1 electron'])
    expect(looseAppStarts(spec("const env = { ...process.env }\nspawn(require('electron'), [repoRoot], { env })"))).toEqual(["test/e2e/x.spec.ts:2 require('electron')"])
    expect(looseAppStarts(spec('execFile(electronPath, [repoRoot], () => {})'))).toEqual(['test/e2e/x.spec.ts:1 electronPath'])
    expect(looseAppStarts(spec("fork(join(repoRoot, 'out', 'main', 'index.js'), { env: process.env })"))).toEqual(["test/e2e/x.spec.ts:1 join(repoRoot, 'out', 'main', 'index.js')"])
    expect(looseAppStarts(spec("spawnSync('electron', ['.'])"))).toEqual(["test/e2e/x.spec.ts:1 'electron'"])
    // An earlier directStartEnv does not cover a later env of another kind.
    expect(looseAppStarts(spec('let env = directStartEnv(o)\nconst env = { ...process.env }\nspawn(electron, [repoRoot], { env })'))).toEqual(['test/e2e/x.spec.ts:3 electron'])
    // The shapes the specs use pass; tools by name, Node, a RegExp's exec and node-pty are not starts of the app.
    expect(looseAppStarts(spec('const env = directStartEnv({ dataDir, claudeHome })\nconst child = spawn(electron, [repoRoot, ...NO_WINDOW_RESTORE], { cwd: repoRoot, env, stdio: \'ignore\' })'))).toEqual([])
    expect(looseAppStarts(spec('spawn(command, args, { env: directStartEnv({ dataDir, claudeHome }) })'))).toEqual([])
    expect(looseAppStarts(spec("execFileSync('git', ['status'], { env })\nspawnSync(process.execPath, [script])\n/x/.exec(text)\npty.spawn(shell, [])"))).toEqual([])
  })

  it('no spec sets WORFY_GH to the stub by hand: the variables live in launch-env.ts alone', () => {
    const copies = e2e.filter((file) => file.name !== 'test/e2e/launch-env.ts' && /WORFY_GH:\s*GH_STUB/.test(file.text)).map((file) => file.name)
    expect(copies).toEqual([])
  })

  it('a spec that overrides WORFY_GH points it at a path of its own, never a bare name or the test process\'s value', () => {
    // A spec may hand the app another stand-in (a sandbox gh, one that logs, a missing file), built
    // with join() or a helper. A string literal (`'gh'`) or the inherited value would let the app
    // look gh up on the Path again.
    const loose = e2e.filter((file) => /WORFY_GH:\s*(?:['"`]|process\.env)/.test(file.text)).map((file) => file.name)
    expect(loose).toEqual([])
  })
})

describe('worfy starts gh only through WORFY_GH', () => {
  it('no code in src/main starts gh by its bare name', () => {
    expect(bareGhStarts(main)).toEqual([])
  })

  it('the detector of bare gh starts: execFile, spawn, probes.run, runTool and a command line are each caught', () => {
    const file = (text: string): Source[] => [{ name: 'src/main/x.ts', text }]
    expect(bareGhStarts(file("execFile('gh', ['pr', 'list'], done)"))).toHaveLength(1)
    expect(bareGhStarts(file('spawn("gh", args)'))).toHaveLength(1)
    expect(bareGhStarts(file("await machine.probes.run('gh', ['--version'], env, 1000)"))).toHaveLength(1)
    expect(bareGhStarts(file("runTool('gh', ['auth', 'status'], env)"))).toHaveLength(1)
    expect(bareGhStarts(file('execSync(`gh pr list`)'))).toHaveLength(1)
    expect(bareGhStarts(file("// execFile('gh', [])\nexecFile(start.file, [...start.args, ...args])"))).toEqual([])
  })

  it('the places that pick the gh program are the WORFY_GH-aware ones, and no others', () => {
    // A new one must take the override: programStart(<WORFY_GH>, 'gh') (src/main/program.ts).
    const picks = main.flatMap((file) => [...code(file.text).matchAll(/programStart\([^()]*,\s*['"`]gh['"`]\)|(?:\?\?|\|\|)\s*['"`]gh['"`]/g)].map((match) => `${file.name}: ${match[0]}`))
    expect(picks.sort()).toEqual([
      // The gh rows of the first-run checks (runGh).
      "src/main/first-run/checks.ts: programStart(deps.gh?.command, 'gh')",
      // "Sign in with gh": signInCommand with WORFY_GH, or gh from the Path.
      "src/main/github/accounts.ts: ?? 'gh'",
      // ghRunner: the name for its error messages, and the program.
      "src/main/github/prs.ts: ?? 'gh'",
      "src/main/github/prs.ts: programStart(options.command, 'gh')",
    ])
  })

  it('`gh auth login` for the user to run is only in the sign-in action of the first-run screen', () => {
    // An intended exception to WORFY_GH: worfy types this command into a Terminal Node (or shows it
    // to copy), and the user's own shell runs it there, not worfy.
    const typed = main.filter((file) => /['"`]\s*gh auth login['"`]/.test(code(file.text))).map((file) => file.name)
    expect(typed).toEqual(['src/main/first-run/actions.ts', 'src/main/first-run/checks.ts'])
  })

  it('the first-run checks get WORFY_GH', () => {
    expect(readFileSync(join(REPO, 'src', 'main', 'ipc', 'first-run.ts'), 'utf8')).toMatch(/runChecks\(\{[^}]*\bgh: ghOverride\(process\.env\)/)
  })
})
