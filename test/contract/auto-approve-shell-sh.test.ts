// Differential test of the shell command parser of auto-approval (worfy-auto-approve ticket 02,
// the spec's section on security, item 4): for commands without side effects — `printf '%s\0'` in place of the
// program — the words analyze() gives must be the words a real shell passes. Each command runs in
// every shell of the machine the parser stands for: sh, dash, bash and zsh where installed (macOS has
// all four; a Linux runner at least sh and bash), Git Bash on Windows. A difference turns the test red.
//
// The commands run in an empty temporary folder, so a glob matches nothing: sh, dash and bash keep it
// as written, as analyze() does; zsh stops on it (NOMATCH), so glob commands skip zsh.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { analyze } from '../../src/main/agent/auto-approve/shell'
import { gitBash } from '../git-bash'
import { removeTestTree } from '../remove'

const ON_WINDOWS = process.platform === 'win32'
const P = "printf '%s\\0'"

const folder = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-auto-approve-sh-')))
mkdirSync(join(folder, 'sub'))
afterAll(() => removeTestTree(folder))

function exists(shell: string): boolean {
  return spawnSync(shell, ['-c', 'exit 0'], { stdio: 'ignore' }).status === 0
}

const shells: string[] = ON_WINDOWS ? [gitBash()] : ['sh', 'dash', 'bash', 'zsh'].filter(exists)

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

describe.each(shells)('%s', (shell) => {
  const zsh = /(^|[\\/])zsh$/.test(shell)
  it.each(cases.filter((each) => !(zsh && each.glob === true) && !(ON_WINDOWS && each.home === true)))('$command', ({ command }) => {
    const run = spawnSync(shell, ['-c', command], { cwd: folder, env, encoding: 'utf8' })
    expect(run.status, run.stderr).toBe(0)
    expect(expected(command)).toEqual(printed(run.stdout))
  })
})

it('runs in at least one shell', () => {
  expect(shells.length).toBeGreaterThan(0)
})
