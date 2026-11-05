// Differential test of the shell command parser of auto-approval (worfy-auto-approve ticket 02,
// the spec's section on security, item 4): for commands without side effects — `printf '%s\0'` in place of the
// program — the words analyze() gives must be the words a real shell passes. Each command runs in
// every shell the parser stands for: sh and bash, dash and zsh where installed (macOS has all four),
// Git Bash on Windows. A difference turns the test red. On Windows an absolute path is compared by the
// file it names, not by its spelling: Git Bash may spell one folder in more than one way (filesNamed below).
//
// The commands run in an empty temporary folder, so a glob matches nothing: sh, dash and bash keep it
// as written, as analyze() does; zsh stops on it (NOMATCH), so glob commands skip zsh.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyze } from '../../src/main/agent/auto-approve/shell'
import { gitBash } from '../git-bash'
import { removeTestTree } from '../remove'

const ON_WINDOWS = process.platform === 'win32'
const P = "printf '%s\\0'"

let folder = ''
beforeAll(() => {
  folder = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-auto-approve-sh-')))
  mkdirSync(join(folder, 'sub'))
})
afterAll(() => {
  if (folder !== '') removeTestTree(folder)
})

// The shells by name; each is looked for when its tests run, not when the file loads
// (test/unit/e2e-no-spawn-on-load.test.ts). sh and bash are on every macOS and Linux machine.
const shells: string[] = ON_WINDOWS ? ['git-bash'] : ['sh', 'dash', 'bash', 'zsh']
// macOS ships zsh as its own shell, so there a missing zsh is a red test, not a skip. The darwin guard
// also puts this file into the macos-tests CI job (scripts/ci-scope.mjs, DARWIN_GUARD): without it a
// pull request runs this file on Linux and Windows only, where zsh may be missing.
const REQUIRED = new Set(['sh', 'bash', 'git-bash', ...(process.platform === 'darwin' ? ['zsh'] : [])])
const found = new Map<string, string | null>()

/** The program of the shell `name`, or null when the machine has none. */
function program(name: string): string | null {
  if (!found.has(name)) {
    const path = name === 'git-bash' ? gitBash() : name
    found.set(name, spawnSync(path, ['-c', 'exit 0'], { stdio: 'ignore' }).status === 0 ? path : null)
  }
  return found.get(name) ?? null
}

// The environment of both the shell and the analysis: the test's own variables, and none that the
// parser refuses (IFS, CDPATH) or that a shell reads at its start (ENV, BASH_ENV).
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !['IFS', 'CDPATH', 'ENV', 'BASH_ENV'].includes(entry[0])))
env['DEMO_PATH'] = '/tmp/demo/x'
env['DEMO_EMPTY'] = ''
env['DEMO_TEXT'] = "it's a \"demo\" with \\ and $"
if (!ON_WINDOWS) env['HOME'] = '/tmp/demo-home'

interface Case {
  command: string
  /** Skipped in zsh: a glob that matches nothing stops zsh. */
  glob?: true
  /** Skipped on Windows: Git Bash spells HOME from the Windows form it was given. */
  home?: true
}

const cases: Case[] = [
  { command: `${P} a 'b c' "d e" f\\ g` },
  { command: `${P} "a\\$b" "a\\\\b" "a\\qb" 'a\\qb' a\\qb` },
  { command: `${P} 'a'"b"c 'x''y' "p""q"` },
  { command: `${P} "a'b" 'a"b' "tab\there" 'two\nlines'` },
  { command: `${P} '' "" a` },
  { command: `${P} "$DEMO_PATH" \${DEMO_PATH}/y "$DEMO_PATH"z $DEMO_PATH` },
  { command: `${P} a$DEMO_EMPTY "$DEMO_EMPTY" $DEMO_EMPTY b \${DEMO_EMPTY}c` },
  { command: `${P} "$DEMO_TEXT" "x$DEMO_TEXT"` },
  { command: `X=/tmp/x; ${P} "$X" $X "$X/y"` },
  { command: `X=a; X=$X-b; Y="$X c"; ${P} $X "$Y"` },
  { command: `${P} ~ ~/x a~b HEAD~1 x/~`, home: true },
  { command: `${P} a#b c # d e` },
  { command: `${P} a; ${P} b && ${P} c\n${P} d` },
  { command: `false || ${P} e; true && ${P} f` },
  { command: `${P} a \\\n b` },
  { command: `${P} [ = ] a=b --x=y -- -` },
  { command: `${P} a 2>/dev/null b 2>&1 c 3>&1` },
  { command: `${P} *.none ?.none a/*.none`, glob: true },
  { command: `sh -c "${P} inner 'y z'"` },
  { command: `sh -c '${P.replaceAll("'", "'\\''")} "$DEMO_PATH" in'` },
  { command: `bash -ec "cd sub && ${P} \\"\\$PWD\\""` },
  { command: `cd sub && ${P} "$PWD" $PWD/x` },
]

/** The words of every printf, from the output of the shell or from analyze(). */
function printed(output: string): string[] {
  return output.split('\0').slice(0, -1)
}

function expected(command: string): string[] {
  const analysis = analyze(command, { cwd: folder, env, platform: process.platform })
  if (!analysis.judged) throw new Error(`not judged: ${analysis.why}`)
  return analysis.actions.filter((action) => action.program === 'printf').flatMap((action) => (action.args.length === 1 ? [''] : action.args.slice(1)))
}

describe.each(shells)('%s', (name) => {
  it.for(cases.filter((each) => !(name === 'zsh' && each.glob === true) && !(ON_WINDOWS && each.home === true)))('$command', ({ command }, context) => {
    const shell = program(name)
    if (shell === null) {
      if (REQUIRED.has(name)) throw new Error(`no ${name} on this machine`)
      context.skip()
      return
    }
    const run = spawnSync(shell, ['-c', command], { cwd: folder, env, encoding: 'utf8' })
    expect(run.status, run.stderr).toBe(0)
    const words = { analyzed: expected(command), shell: printed(run.stdout) }
    const named = filesNamed(shell, [...words.analyzed, ...words.shell])
    expect(words.analyzed.map(named)).toEqual(words.shell.map(named))
  })
})

/**
 * On Windows, each absolute Git Bash path among `words` turned into the Windows path of the file it
 * names (cygpath -w, in lower case: NTFS ignores case); other words stay as they are. Elsewhere words
 * stay as they are.
 *
 * Git Bash spells one folder in more than one way. The MSYS runtime turns the Windows working folder
 * into a path under the longest mount that holds it, and Git for Windows mounts the user's %TEMP% at
 * /tmp (its /etc/fstab, `usertemp`): there `$PWD` of a folder under %TEMP% is `/tmp/…`, while
 * analyze() spells it through the drive, `/c/Users/…/Temp/…` (pc-main-red #1423). The Windows job of
 * CI passed with the old comparison (PR #1372); why the runner's Git Bash spelled the folder through the
 * drive is not known (its log does not show TEMP or the folder). Both
 * spellings name the same file, and the approval policy judges paths in their Windows form (the
 * writes, deletes and reads of an action), never the spelling of `$PWD`; so the test compares the
 * files the words name. analyze() cannot spell `$PWD` as Git Bash does without reading its mount table.
 */
function filesNamed(shell: string, words: string[]): (word: string) => string {
  if (!ON_WINDOWS) return (word) => word
  const paths = [...new Set(words.filter((word) => word.startsWith('/')))]
  if (paths.length === 0) return (word) => word
  const script = `for p; do w=$(/usr/bin/cygpath -w "$p") || exit 1; printf '%s\\0' "$w"; done`
  const run = spawnSync(shell, ['-c', script, 'cygpath', ...paths], { env, encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`cygpath -w failed: ${run.stderr}`)
  const windows = printed(run.stdout)
  if (windows.length !== paths.length) throw new Error(`cygpath -w gave ${windows.length} paths for ${paths.length}`)
  const of = new Map(paths.map((path, index) => [path, (windows[index] ?? '').toLowerCase()]))
  return (word) => of.get(word) ?? word
}

// Why a glob component that starts with a dot is refused: sh, dash and bash before 5.2 (macOS
// /bin/bash 3.2) match `.?` to `..`, so `ls .?` lists the parent folder; zsh and bash 5.2 do not.
// The fixture is a file in the test's own temporary folder, one level above the working folder.
describe('a glob component that starts with a dot', () => {
  it('is refused, and a real shell lists the parent folder for it', () => {
    const inner = join(folder, 'dots', 'inner')
    mkdirSync(inner, { recursive: true })
    writeFileSync(join(folder, 'dots', 'parent-only.txt'), 'fixture\n')
    expect(analyze('ls .?', { cwd: inner, env, platform: process.platform })).toMatchObject({ judged: false, why: 'a glob in a path component that starts with a dot' })
    const candidates = ON_WINDOWS ? ['git-bash'] : ['sh', 'dash', 'bash', ...(process.platform === 'darwin' ? ['/bin/bash'] : [])]
    const leaving = candidates.filter((name) => {
      const shell = name.startsWith('/') ? name : program(name)
      if (shell === null) return false
      const run = spawnSync(shell, ['-c', 'ls .?'], { cwd: inner, env, encoding: 'utf8' })
      return run.status === 0 && run.stdout.includes('parent-only.txt')
    })
    // macOS ships bash 3.2 as /bin/bash and as sh; on other machines the shells may skip `..`.
    if (process.platform === 'darwin') expect(leaving).toContain('/bin/bash')
  })
})
