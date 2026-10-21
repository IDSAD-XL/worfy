import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { projectDirName } from '../../src/main/claude-home/registry'
import {
  GateReader,
  gateKey,
  gateOutputs,
  gateRunDir,
  gateTag,
  lastGateOutcome,
  listWorktrees,
  markerOutcome,
  readVerdictFile,
  TranscriptGateScanner,
  verdictFileName,
  type Worktree,
} from '../../src/main/gate/state'
import { worktreeOfCwd, worktreeOfTicket, type ChecksSnapshot } from '../../src/shared/ipc/checks'

// The gate's verdict per worktree (ticket 17): the Gate's tag, the key from gate/config.json, the
// red/unverified markers, and the last `[gate]` line of the worktree's transcripts. The tests named
// «on Windows» pass the platform (worfy-windows ticket 03), so they run on macOS and Linux too.

const temps: string[] = []
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-gate-')))
  temps.push(dir)
  return dir
}

describe('gateTag', () => {
  // The expected tags are the output of `printf %s <path> | shasum | cut -c1-8`, written out so the
  // test needs no /bin/sh (it runs on Windows too) and still checks against a hash made elsewhere.
  it.each([
    ['/Users/alexey/Stuff/CanvasForAI', '048d88a0'],
    ['/Users/test/projects/demo/.claude/worktrees/07', '80f45779'],
    ['/tmp/с пробелом и юникодом', '064900bc'],
  ])('equals the first 8 hex digits of `printf %%s <path> | shasum` for %s', (path, expected) => {
    expect(gateTag(path)).toBe(expected)
  })
})

// worfy-windows ticket 03: the Gate hashes the path as `git rev-parse --show-toplevel` prints it,
// `C:/Users/x/worfy` on Windows, and worfy has it from realpath as `C:\Users\x\worfy`. The platform
// is a parameter, so these run on macOS and Linux too.
describe('gateTag on Windows', () => {
  const sha1 = (text: string): string => createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 8)

  it('gives one tag for C:\\a\\b and C:/a/b: the tag of the spelling git prints', () => {
    expect(gateTag('C:/a/b', 'win32')).toBe('6499f282')
    expect(gateTag('C:\\a\\b', 'win32')).toBe('6499f282')
    expect(gateTag('c:\\a\\b', 'win32')).toBe('6499f282')
    expect(gateTag('\\\\srv\\share\\a', 'win32')).toBe(sha1('//srv/share/a'))
  })

  it('gives a macOS path the tag it gives today, and leaves a `\\` in a macOS name alone', () => {
    expect(gateTag('/Users/test/projects/demo/.claude/worktrees/07')).toBe('80f45779')
    expect(gateTag('/Users/test/projects/demo/.claude/worktrees/07', 'darwin')).toBe('80f45779')
    expect(gateTag('/Users/test/projects/demo/.claude/worktrees/07', 'win32')).toBe('80f45779')
    expect(gateTag('/tmp/a\\b', 'darwin')).toBe(sha1('/tmp/a\\b'))
    expect(gateTag('c:\\a\\b', 'linux')).toBe(sha1('c:\\a\\b'))
  })
})

describe('gateKey', () => {
  const config = {
    repos: [
      { key: 'outer', match: '/Users/test/projects' },
      { key: 'demo', match: '/Users/test/projects/demo' },
      { key: 'demo-other', match: '/Users/test/projects/demo-other' },
    ],
  }

  it('takes the longest `match` that is the root or a folder above it', async () => {
    expect(await gateKey(config, '/Users/test/projects/demo')).toBe('demo')
    expect(await gateKey(config, '/Users/test/projects/demo/sub')).toBe('demo')
    expect(await gateKey(config, '/Users/test/projects/elsewhere')).toBe('outer')
  })

  it('does not take a `match` that only starts like the root', async () => {
    expect(await gateKey({ repos: [{ key: 'demo', match: '/Users/test/projects/demo' }] }, '/Users/test/projects/demo-other')).toBeNull()
  })

  it('is null without a config or without a matching entry', async () => {
    expect(await gateKey(null, '/Users/test/projects/demo')).toBeNull()
    expect(await gateKey(config, '/Volumes/x')).toBeNull()
  })
})

describe('gateKey on Windows', () => {
  const config = {
    repos: [
      { key: 'users', match: 'C:\\Users' },
      { key: 'worfy', match: 'C:\\Users\\x\\worfy' },
      { key: 'worfy-other', match: 'C:/Users/x/worfy-other' },
    ],
  }

  it('finds a `match` written with `\\` for the root git prints with `/`, and for a worktree under it', async () => {
    expect(await gateKey(config, 'C:/Users/x/worfy', 'win32')).toBe('worfy')
    expect(await gateKey(config, 'C:/Users/x/worfy/.claude/worktrees/07', 'win32')).toBe('worfy')
    expect(await gateKey(config, 'C:\\Users\\x\\worfy\\.claude\\worktrees\\07', 'win32')).toBe('worfy')
    expect(await gateKey(config, 'C:\\Users\\x\\worfy-other\\src', 'win32')).toBe('worfy-other')
  })

  it('does not tell letter case apart, and still takes only a whole folder name', async () => {
    expect(await gateKey(config, 'c:\\users\\X\\Worfy', 'win32')).toBe('worfy')
    expect(await gateKey(config, 'C:/Users/x/worfy-third', 'win32')).toBe('users')
    expect(await gateKey(config, 'D:/Users/x/worfy', 'win32')).toBeNull()
  })

  it('on macOS a `\\` is a character of a name and letter case counts, as before', async () => {
    expect(await gateKey(config, 'C:/Users/x/worfy', 'darwin')).toBeNull()
    expect(await gateKey({ repos: [{ key: 'demo', match: '/Users/test/projects/demo' }] }, '/Users/test/projects/Demo', 'darwin')).toBeNull()
  })
})

describe('markerOutcome', () => {
  it('reads red and unverified markers of this key and tag only; red wins', () => {
    expect(markerOutcome(new Set(['red-worfy-abcdef12']), 'worfy', 'abcdef12')).toBe('red')
    expect(markerOutcome(new Set(['unverified-worfy-abcdef12']), 'worfy', 'abcdef12')).toBe('unverified')
    expect(markerOutcome(new Set(['unverified-worfy-abcdef12', 'red-worfy-abcdef12']), 'worfy', 'abcdef12')).toBe('red')
    expect(markerOutcome(new Set(['red-auction-abcdef12', 'red-worfy-00000000', 'nokey-broken-abcdef12-s']), 'worfy', 'abcdef12')).toBeNull()
  })
})

describe('lastGateOutcome', () => {
  // The lines of the gate as it prints them now, and the same verdicts in the Russian words of the
  // gate of the release before: both give the same outcome.
  // shortcut: accepts the old Russian token, remove after the next release (worfy-neutral 08)
  it.each([
    ['[gate] green (fast): worfy/.:lint', '[gate] зелено (fast): worfy/.:lint', 'green'],
    ['[gate] green (fast): worfy/.:lint (cache)', '[gate] зелено (fast): worfy/.:lint (кэш)', 'green'],
    ['[gate] red (fast): worfy/.:test (passed: lint)', '[gate] красно (fast): worfy/.:test (прошло: lint)', 'red'],
    ['[gate] nothing ran (fast): no changes. This is not green.', '[gate] ничего не прогналось (fast): нет изменений. Это не «зелено».', 'none'],
    ['[gate] not verified: node not found', '[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: node не найден', 'unverified'],
    ['[gate] not verified — environment unavailable:', '[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ — окружение недоступно:', 'unverified'],
    ['[gate] not verified: x\r\n[gate] green (full): a\r', '[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: x\r\n[gate] зелено (full): a\r', 'green'],
    // A bare verdict word at the end of a CRLF line (output of a Windows tool).
    ['[gate] green (fast): a\r\n[gate] red\r\n', '[gate] зелено (fast): a\r\n[gate] красно\r\n', 'red'],
  ])('new %j and old %j → %s', (now, before, outcome) => {
    expect(lastGateOutcome(now)).toBe(outcome)
    expect(lastGateOutcome(before)).toBe(outcome)
  })

  it.each([
    ['[gate] scope (fast): all packages\n[gate] green (fast): worfy/.:lint', 'green'],
    ['[gate] red (fast): worfy/.:test (passed: lint)', 'red'],
    ['[gate] not verified: node not found', 'unverified'],
    ['[gate] not verified — environment unavailable:', 'unverified'],
    ['[gate] nothing ran (fast): no changes. This is not green.', 'none'],
    ['[gate] green (fast): a\n…\n[gate] nothing ran (fast): b', 'none'],
    ['[gate] red (fast): a\nКОД=2\n[gate] green (fast): a', 'green'],
  ])('%j → %s', (text, outcome) => {
    expect(lastGateOutcome(text)).toBe(outcome)
  })

  it('knows every verdict word harness/hooks/gate.mjs prints', async () => {
    // The gate prints its verdict lines in English; whatever the words are, the transcript fallback
    // must read each of them.
    const gate = await readFile(join(__dirname, '..', '..', 'harness', 'hooks', 'gate.mjs'), 'utf8')
    // Every verdict is a string in double quotes there; the warning about a long file, which is no
    // verdict, is written in another kind of quotes.
    const words = new Set([...gate.matchAll(/"\[gate\] ([^"(:—$]+?)\s*[(:—]/gu)].map((match) => match[1]!.trim()).filter((word) => word !== 'scope'))
    // The search above reads the source at all: it finds the four verdicts.
    expect(words.size).toBeGreaterThanOrEqual(4)
    const outcomes = [...words].map((word) => lastGateOutcome(`[gate] ${word} (fast): x`))
    expect(outcomes).not.toContain(null)
    expect(new Set(outcomes)).toEqual(new Set(['green', 'red', 'none', 'unverified']))
  })

  // shortcut: accepts the old Russian token, remove after the next release (worfy-neutral 08)
  it('ignores lines that only mention the gate, not at the start of a line', () => {
    expect(lastGateOutcome('  echo "[gate] зелено ($PROFILE)"\n361:        echo "[gate] красно"')).toBeNull()
    expect(lastGateOutcome('  echo "[gate] green ($PROFILE)"\n361:        echo "[gate] red"')).toBeNull()
    expect(lastGateOutcome('[gate] набор (fast): все пакеты')).toBeNull()
    expect(lastGateOutcome('[gate] scope (fast): all packages')).toBeNull()
    // A word that only starts like a verdict is not one.
    expect(lastGateOutcome('[gate] reduced (fast): x\n[gate] greenish: y')).toBeNull()
  })
})

describe('gateRunDir', () => {
  const cwd = '/Users/test/projects/demo'
  // Paths of macOS, so the platform is macOS's: on Windows `cd /Users/…` is under Git Bash's own
  // root and cannot be placed (the Windows rules have their own block below).
  it.each([
    ['bash ~/.claude/hooks/gate.sh fast </dev/null; echo "КОД=$?"', cwd],
    ['~/.claude/hooks/gate.sh fast > /tmp/g.out 2>&1; tail -1 /tmp/g.out', cwd],
    ['cd .claude/worktrees/07 && bash ~/.claude/hooks/gate.sh fast', `${cwd}/.claude/worktrees/07`],
    ['cd /Users/test/Work/Auction && ~/.claude/hooks/gate.sh fast', '/Users/test/Work/Auction'],
    ['cd ~/.claude && ls; cd /Users/test/projects/demo && ~/.claude/hooks/gate.sh fast', cwd],
    ["cd '/Users/test/My Projects/x' && gate.sh", '/Users/test/My Projects/x'],
    ['GATE_SCOPE=all bash ~/.claude/hooks/gate.sh full; cd /elsewhere', cwd],
  ])('%s → %s', (command, dir) => {
    expect(gateRunDir(command, cwd, 'darwin')).toBe(dir)
  })

  // The home folder is this machine's, so these run on its own platform.
  it.each([
    ['cd && ~/.claude/hooks/gate.sh fast', homedir()],
    ['cd ~/x && ~/.claude/hooks/gate.sh fast', join(homedir(), 'x')],
  ])('%s → %s', (command, dir) => {
    expect(gateRunDir(command, cwd)).toBe(dir)
  })

  it('is undefined for a command that does not run gate.sh', () => {
    expect(gateRunDir('cd ~/.claude && for t in hooks/tests/*.test.sh; do bash $t; done', cwd)).toBeUndefined()
    expect(gateRunDir('bash ~/.claude/hooks/tests/gate-unregistered.test.sh', cwd)).toBeUndefined()
    expect(gateRunDir('tail -20 /tmp/scratch/gate-fast.txt', cwd)).toBeUndefined()
  })

  it('is null when the folder cannot be told without a shell', () => {
    expect(gateRunDir('W=/x; cd $W && gate.sh fast', cwd)).toBeNull()
    expect(gateRunDir('cd "$(git rev-parse --show-toplevel)" && gate.sh fast', cwd)).toBeNull()
    expect(gateRunDir('pushd /x; popd; gate.sh fast', cwd)).toBeNull()
    expect(gateRunDir('cd sub && gate.sh fast', null)).toBeNull()
  })

  it('is the Session’s own folder (\'\') when the record names none and there is no cd', () => {
    expect(gateRunDir('bash ~/.claude/hooks/gate.sh fast', null)).toBe('')
  })
})

// worfy-windows ticket 03: the Gate is harness/hooks/gate.mjs, run by node; gate.sh stays in old
// transcripts and in the old Harness under ~/.claude.
describe('gateRunDir: gate.mjs, gate.sh and Windows paths', () => {
  const cwd = 'C:\\Users\\x\\worfy'
  const gate = 'node "C:\\Users\\x\\plugin\\hooks\\gate.mjs" fast'

  it.each([
    [gate, cwd],
    ['node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast </dev/null; echo "EXIT=$?"', cwd],
    ['node hooks\\gate.mjs full', cwd],
    ['bash ~/.claude/hooks/gate.sh fast', cwd],
    ['cd /c/x && node ./hooks/gate.mjs full', 'C:\\x'],
    ['cd /c && node x/hooks/gate.mjs full', 'C:\\'],
    [`cd "C:\\Users\\x\\worfy\\.claude\\worktrees\\07" && ${gate}`, 'C:\\Users\\x\\worfy\\.claude\\worktrees\\07'],
    [`cd C:/Users/x/other; ${gate}`, 'C:\\Users\\x\\other'],
    [`cd '\\\\srv\\share\\repo' && ${gate}`, '\\\\srv\\share\\repo'],
    [`cd .claude/worktrees/07 && ${gate}`, 'C:\\Users\\x\\worfy\\.claude\\worktrees\\07'],
    [`cd ".claude\\worktrees\\07"; cd '..\\08'; ${gate}`, 'C:\\Users\\x\\worfy\\.claude\\worktrees\\08'],
    [`cd /c/elsewhere && ls; cd "C:\\Users\\x\\worfy" && ${gate}`, cwd],
    [`cd 'C:\\Users\\x\\My Projects\\y' && ${gate}`, 'C:\\Users\\x\\My Projects\\y'],
    // In double quotes bash keeps a `\` before an ordinary character and makes one of `\\`.
    [`cd "C:\\\\Users\\\\x\\\\other" && ${gate}`, 'C:\\Users\\x\\other'],
  ])('on Windows %s → %s', (command, dir) => {
    expect(gateRunDir(command, cwd, 'win32')).toBe(dir)
  })

  it('on Windows is null for a folder only the shell can place: Git Bash’s own root, the current drive, no cwd', () => {
    expect(gateRunDir(`cd /tmp/x && ${gate}`, cwd, 'win32')).toBeNull()
    expect(gateRunDir(`cd "\\x" && ${gate}`, cwd, 'win32')).toBeNull()
    expect(gateRunDir(`cd D:x && ${gate}`, cwd, 'win32')).toBeNull()
    expect(gateRunDir(`cd sub && ${gate}`, null, 'win32')).toBeNull()
    expect(gateRunDir(`cd "$W" && ${gate}`, cwd, 'win32')).toBeNull()
  })

  it('on Windows is null for a cd argument with a `\\` outside quotes: Git Bash reads it as an escape and goes elsewhere or nowhere', () => {
    // `cd C:\Users\x\worfy` is `cd C:Usersxworfy` to bash: it fails, and after `&&` the Gate does not run.
    expect(gateRunDir(`cd C:\\Users\\x\\worfy && ${gate}`, cwd, 'win32')).toBeNull()
    expect(gateRunDir(`cd .claude\\worktrees\\07; ${gate}`, cwd, 'win32')).toBeNull()
    expect(gateRunDir(`cd \\x && ${gate}`, cwd, 'win32')).toBeNull()
    // An escaped space: the folder is `C:\my repo`, which the argument up to the space does not say.
    expect(gateRunDir(`cd /c/my\\ repo && ${gate}`, cwd, 'win32')).toBeNull()
  })

  it('takes a `\\` before the name for a path separator on Windows only: to bash on macOS `my\\gate.sh` is mygate.sh', () => {
    const root = '/Users/test/projects/demo'
    expect(gateRunDir('bash my\\gate.sh fast', root, 'darwin')).toBeUndefined()
    expect(gateRunDir('node hooks\\gate.mjs fast', root, 'linux')).toBeUndefined()
    expect(gateRunDir('bash ~/.claude/hooks/gate.sh fast', root, 'darwin')).toBe(root)
    expect(gateRunDir(gate, cwd, 'win32')).toBe(cwd)
  })

  // Known limits, recorded in the ticket's result section; these pin what the reader answers today.
  it('takes a command that only names the script for a Gate call, and reads a PowerShell command by the rules of bash', () => {
    for (const platform of ['win32', 'darwin'] as const) {
      expect(gateRunDir('cat harness/hooks/gate.mjs', cwd, platform)).toBe(cwd)
      expect(gateRunDir('echo gate.mjs', cwd, platform)).toBe(cwd)
      expect(gateRunDir('cat ~/.claude/hooks/gate.sh', cwd, platform)).toBe(cwd)
    }
    // `Set-Location` is not a `cd` here: the run in C:\other is taken for one in the Session's folder.
    expect(gateRunDir('Set-Location C:\\other; node C:\\Users\\x\\plugin\\hooks\\gate.mjs fast', cwd, 'win32')).toBe(cwd)
  })

  it('is undefined for a command that runs neither gate.mjs nor gate.sh', () => {
    for (const platform of ['win32', 'darwin'] as const) {
      expect(gateRunDir('node harness/hooks/gate-resolve.mjs --which', cwd, platform)).toBeUndefined()
      expect(gateRunDir('bash harness/hooks/tests/gate-verdict.test.sh', cwd, platform)).toBeUndefined()
      expect(gateRunDir('node hooks/mygate.mjs fast', cwd, platform)).toBeUndefined()
      expect(gateRunDir('node hooks/gate.mjs.bak fast', cwd, platform)).toBeUndefined()
    }
  })

  it('on macOS takes gate.mjs like gate.sh, and a path is absolute only with `/` in front', () => {
    const root = '/Users/test/projects/demo'
    expect(gateRunDir('node "/Users/test/plugin/hooks/gate.mjs" fast', root, 'darwin')).toBe(root)
    expect(gateRunDir('cd /c/x && node ./hooks/gate.mjs full', root, 'darwin')).toBe('/c/x')
    expect(gateRunDir('cd .claude/worktrees/07 && node ./hooks/gate.mjs full', root, 'darwin')).toBe(`${root}/.claude/worktrees/07`)
    expect(gateRunDir('cd C:/x && node ./hooks/gate.mjs full', root, 'darwin')).toBe(`${root}/C:/x`)
    expect(gateRunDir('node hooks/gate.mjs fast', null, 'darwin')).toBe('')
  })
})

describe('gateOutputs', () => {
  const gateCall = (id: string, command: string, cwd?: string) => ({ type: 'assistant', cwd, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } })
  const result = (id: string, content: unknown) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } })

  it('takes the result of a tool call that ran gate.sh, with the folder it ran in, once', () => {
    // Folders of macOS (`cd /other`), so the platform is macOS's.
    const calls = new Map<string, string | null>()
    expect(gateOutputs(gateCall('a', 'bash ~/.claude/hooks/gate.sh fast', '/r'), calls, 'darwin')).toEqual([])
    expect(gateOutputs(gateCall('b', 'cd /other && ~/.claude/hooks/gate.sh fast', '/r'), calls, 'darwin')).toEqual([])
    expect(gateOutputs(result('a', '[gate] green (fast): x'), calls, 'darwin')).toEqual([{ text: '[gate] green (fast): x', dir: '/r' }])
    expect(gateOutputs(result('b', [{ type: 'text', text: 'b' }, { type: 'image' }]), calls, 'darwin')).toEqual([{ text: 'b', dir: '/other' }])
    expect(gateOutputs(result('a', '[gate] green (fast): x'), calls, 'darwin')).toEqual([])
    expect(calls.size).toBe(0)
  })

  it('leaves out the result of any other tool call, though it prints gate lines', () => {
    const calls = new Map<string, string | null>()
    gateOutputs(gateCall('t', 'cd ~/.claude && for t in hooks/tests/*.test.sh; do bash $t; done', '/r'), calls)
    expect(gateOutputs(result('t', '[gate] not verified: fixture'), calls)).toEqual([])
    expect(gateOutputs(result('unknown', '[gate] red (fast): x'), calls)).toEqual([])
  })

  it('takes hook output, about the folder of the record', () => {
    const calls = new Map<string, string | null>()
    expect(gateOutputs({ type: 'attachment', cwd: '/r', attachment: { type: 'hook_success', content: 'c', stdout: 'o', stderr: 'e' } }, calls)).toEqual([
      { text: 'c', dir: '/r' },
      { text: 'o', dir: '/r' },
      { text: 'e', dir: '/r' },
    ])
    expect(gateOutputs({ type: 'system', subtype: 'stop_hook_summary', hookErrors: ['[gate] red (fast): x'] }, calls)).toEqual([{ text: '[gate] red (fast): x', dir: '' }])
  })

  it('leaves out prompts, briefs, task notifications and the model’s own text', () => {
    const calls = new Map<string, string | null>()
    expect(gateOutputs({ type: 'user', message: { content: '[gate] green (…)' } }, calls)).toEqual([])
    expect(gateOutputs({ type: 'user', message: { content: [{ type: 'text', text: '[gate] green (…)' }] } }, calls)).toEqual([])
    expect(gateOutputs({ type: 'assistant', message: { content: [{ type: 'text', text: '[gate] green (…)' }] } }, calls)).toEqual([])
    expect(gateOutputs({ type: 'attachment', attachment: { type: 'queued_command', prompt: '[gate] green (…)' } }, calls)).toEqual([])
    expect(gateOutputs({ type: 'queue-operation', content: '[gate] green (…)' }, calls)).toEqual([])
  })

  it('on Windows takes a record’s cwd written as C:\\…, for a gate.mjs call and for hook output', () => {
    const calls = new Map<string, string | null>()
    expect(gateOutputs(gateCall('a', 'node "C:\\p\\hooks\\gate.mjs" fast', 'C:\\r'), calls, 'win32')).toEqual([])
    expect(gateOutputs(gateCall('b', 'cd sub && node "C:\\p\\hooks\\gate.mjs" fast', 'C:\\r'), calls, 'win32')).toEqual([])
    expect(gateOutputs(result('a', '[gate] green (fast): x'), calls, 'win32')).toEqual([{ text: '[gate] green (fast): x', dir: 'C:\\r' }])
    expect(gateOutputs(result('b', '[gate] red (fast): x'), calls, 'win32')).toEqual([{ text: '[gate] red (fast): x', dir: 'C:\\r\\sub' }])
    expect(gateOutputs({ type: 'attachment', cwd: 'C:\\r', attachment: { type: 'hook_success', stdout: 'o' } }, calls, 'win32')).toEqual([{ text: 'o', dir: 'C:\\r' }])
    // A cwd that is not absolute names no folder: the output is about the Session's own.
    expect(gateOutputs({ type: 'attachment', cwd: 'r\\sub', attachment: { type: 'hook_success', stdout: 'o' } }, calls, 'win32')).toEqual([{ text: 'o', dir: '' }])
    expect(gateOutputs({ type: 'attachment', cwd: 'C:\\r', attachment: { type: 'hook_success', stdout: 'o' } }, calls, 'darwin')).toEqual([{ text: 'o', dir: '' }])
  })
})

// ── a Project with a worktree of Ticket 07 ──────────────────────────────────

let callIds = 0
/** A Bash call running `command` in `cwd` and its result `text`: two transcript lines. */
const bashRun = (text: string, timestamp: string, options: { command?: string; cwd?: string } = {}) => {
  callIds += 1
  const id = `toolu_${callIds}`
  return [
    JSON.stringify({ type: 'assistant', timestamp, ...(options.cwd ? { cwd: options.cwd } : {}), message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: options.command ?? 'bash ~/.claude/hooks/gate.sh fast </dev/null; echo "КОД=$?"' } }] } }),
    JSON.stringify({ type: 'user', timestamp, ...(options.cwd ? { cwd: options.cwd } : {}), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } }),
  ].join('\n')
}
const toolResult = (text: string, timestamp: string) => bashRun(text, timestamp)
const prompt = (text: string, timestamp: string) => JSON.stringify({ type: 'user', timestamp, message: { role: 'user', content: text } })

interface World {
  home: string
  root: string
  worktree07: string
  worktrees: Worktree[]
  transcript: string
  marker: string
}

async function world(): Promise<World> {
  const base = await tempDir()
  const home = join(base, 'claude')
  const root = join(base, 'demo')
  const worktree07 = join(root, '.claude', 'worktrees', '07')
  await mkdir(join(home, 'gate', 'state'), { recursive: true })
  await mkdir(worktree07, { recursive: true })
  await writeFile(join(home, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'worfy', match: root, profile: 'worfy', pm: 'pnpm' }] }))
  const folder = join(home, 'projects', projectDirName(worktree07))
  await mkdir(folder, { recursive: true })
  const transcript = join(folder, '44444444-4444-4444-8444-444444444444.jsonl')
  await writeFile(
    transcript,
    [
      toolResult('[gate] red (fast): worfy/.:test', '2026-10-05T10:00:00.000Z'),
      toolResult('[gate] scope (fast): all packages\n[gate] green (fast): worfy/.:lint worfy/.:typecheck worfy/.:test', '2026-10-05T10:05:00.000Z'),
      prompt('Brief: finish when `[gate] red` is gone\n[gate] red (fast): quoted', '2026-10-05T10:06:00.000Z'),
      '',
    ].join('\n'),
  )
  const marker = join(home, 'gate', 'state', `red-worfy-${gateTag(worktree07)}`)
  await writeFile(marker, '')
  return { home, root, worktree07, worktrees: [{ path: root, branch: 'main' }, { path: worktree07, branch: 'demo/07' }], transcript, marker }
}

const snapshotOf = (root: string, worktrees: ChecksSnapshot['worktrees']): ChecksSnapshot => ({ root, worktrees, pulls: [], gh: { available: true, error: null, intervalMs: 60_000 } })
const DEMO_TICKETS = [
  { epic: 'demo', num: 7 },
  { epic: 'demo', num: 8 },
]

describe('worktreeOfTicket', () => {
  const gate = { outcome: 'red' as const, source: 'marker' as const, at: null }
  const at07 = (branch: string | null) => snapshotOf('/r', [{ path: '/r', branch: 'main', gate }, { path: '/r/.claude/worktrees/07', branch, gate }])

  it('takes the worktree in .claude/worktrees/<NN> when its branch names no Ticket', () => {
    expect(worktreeOfTicket(at07('feature-x'), { epic: 'demo', num: 7 }, DEMO_TICKETS)?.path).toBe('/r/.claude/worktrees/07')
    expect(worktreeOfTicket(at07(null), { epic: 'demo', num: 7 }, DEMO_TICKETS)?.path).toBe('/r/.claude/worktrees/07')
    expect(worktreeOfTicket(at07('feature-x'), { epic: 'demo', num: 8 }, DEMO_TICKETS)).toBeNull()
  })

  it('does not take it by folder when its branch names another Ticket', () => {
    expect(worktreeOfTicket(at07('demo/09'), { epic: 'demo', num: 7 }, DEMO_TICKETS)).toBeNull()
  })

  it('does not take it by folder when another Epic of the Project has a Ticket with that number', () => {
    const tickets = [...DEMO_TICKETS, { epic: 'other', num: 7 }]
    expect(worktreeOfTicket(at07('feature-x'), { epic: 'demo', num: 7 }, tickets)).toBeNull()
    expect(worktreeOfTicket(at07('feature-x'), { epic: 'other', num: 7 }, tickets)).toBeNull()
    // A branch that names the Ticket still says whose it is.
    expect(worktreeOfTicket(at07('other/07'), { epic: 'other', num: 7 }, tickets)?.path).toBe('/r/.claude/worktrees/07')
  })
})

describe('worktreeOfCwd', () => {
  const gate = { outcome: 'none' as const, source: 'none' as const, at: null }
  const snapshot = (...paths: string[]) => snapshotOf(paths[0]!, paths.map((path) => ({ path, branch: null, gate })))

  // worfy-windows ticket 03: git names a worktree `C:/Users/x/worfy`, Claude Code names the folder
  // of a Session `C:\Users\x\worfy`, and NTFS does not tell letter case apart.
  it('finds a worktree of Windows for a cwd in the other spelling: either separator, any letter case', () => {
    const asGit = snapshot('C:/Users/x/worfy', 'C:/Users/x/worfy/.claude/worktrees/07')
    expect(worktreeOfCwd(asGit, 'C:\\Users\\x\\worfy\\src')?.path).toBe('C:/Users/x/worfy')
    expect(worktreeOfCwd(asGit, 'c:\\users\\x\\worfy')?.path).toBe('C:/Users/x/worfy')
    const asRealpath = snapshot('C:\\Users\\x\\worfy', 'C:\\Users\\x\\worfy\\.claude\\worktrees\\07')
    expect(worktreeOfCwd(asRealpath, 'C:/Users/x/worfy/src')?.path).toBe('C:\\Users\\x\\worfy')
    expect(worktreeOfCwd(snapshot('//srv/share/repo'), '\\\\srv\\share\\repo\\src')?.path).toBe('//srv/share/repo')
  })

  it('takes the deepest worktree of Windows, and only a whole folder name', () => {
    const asGit = snapshot('C:/Users/x/worfy', 'C:/Users/x/worfy/.claude/worktrees/07')
    expect(worktreeOfCwd(asGit, 'C:\\Users\\x\\worfy\\.claude\\worktrees\\07\\src')?.path).toBe('C:/Users/x/worfy/.claude/worktrees/07')
    expect(worktreeOfCwd(asGit, 'C:\\Users\\x\\worfy\\.claude\\worktrees\\08')?.path).toBe('C:/Users/x/worfy')
    expect(worktreeOfCwd(asGit, 'C:/Users/x/worfy2')).toBeNull()
    expect(worktreeOfCwd(asGit, 'C:\\Users\\x\\worfy2\\src')).toBeNull()
    expect(worktreeOfCwd(asGit, 'D:\\Users\\x\\worfy')).toBeNull()
  })

  it('compares a POSIX path exactly as before: letter case counts and a `\\` is a character of a name', () => {
    const posix = snapshot('/Users/x/worfy', '/Users/x/worfy/.claude/worktrees/07')
    expect(worktreeOfCwd(posix, '/Users/x/worfy/src')?.path).toBe('/Users/x/worfy')
    expect(worktreeOfCwd(posix, '/Users/x/worfy/.claude/worktrees/07/src')?.path).toBe('/Users/x/worfy/.claude/worktrees/07')
    expect(worktreeOfCwd(posix, '/Users/X/worfy')).toBeNull()
    expect(worktreeOfCwd(posix, '/Users/x/worfy\\src')).toBeNull()
    expect(worktreeOfCwd(posix, '/Users/x/worfy2')).toBeNull()
    expect(worktreeOfCwd(snapshot('/Users/x/Wor\\fy'), '/Users/x/Wor\\fy/src')?.path).toBe('/Users/x/Wor\\fy')
    expect(worktreeOfCwd(snapshot('/Users/x/Wor\\fy'), '/Users/x/wor/fy/src')).toBeNull()
  })
})

describe('GateReader', () => {
  it('a red marker of the worktree of Ticket 07 makes Ticket 07 and a Session in that worktree red; without it, the transcript’s last gate line says green', async () => {
    const { home, root, worktree07, worktrees, marker } = await world()
    const reader = new GateReader({ home })

    const red = snapshotOf(root, await reader.read(root, worktrees))
    expect(worktreeOfTicket(red, { epic: 'demo', num: 7 }, DEMO_TICKETS)?.gate).toEqual({ outcome: 'red', source: 'marker', at: null })
    expect(worktreeOfCwd(red, join(worktree07, 'src'))?.gate.outcome).toBe('red')
    expect(worktreeOfCwd(red, root)?.gate).toEqual({ outcome: 'none', source: 'none', at: null })

    await rm(marker)
    const green = snapshotOf(root, await reader.read(root, worktrees))
    expect(worktreeOfTicket(green, { epic: 'demo', num: 7 }, DEMO_TICKETS)?.gate).toEqual({ outcome: 'green', source: 'transcript', at: '2026-10-05T10:05:00.000Z' })
    expect(worktreeOfCwd(green, worktree07)?.gate.outcome).toBe('green')
    expect(worktreeOfTicket(green, { epic: 'demo', num: 8 }, DEMO_TICKETS)).toBeNull()
  })

  it('reads an unverified marker, and nothing for a marker of another key', async () => {
    const { home, root, worktree07, worktrees, marker } = await world()
    await rm(marker)
    await writeFile(join(home, 'gate', 'state', `red-auction-${gateTag(worktree07)}`), '')
    await writeFile(join(home, 'gate', 'state', `unverified-worfy-${gateTag(worktree07)}`), '')
    const [, wt07] = await new GateReader({ home }).read(root, worktrees)
    expect(wt07!.gate).toEqual({ outcome: 'unverified', source: 'marker', at: null })
  })

  it('ignores markers when the Project has no key in gate/config.json, and reads the transcript', async () => {
    const { home, root, worktrees } = await world()
    await writeFile(join(home, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'worfy', match: '/somewhere/else' }] }))
    const [, wt07] = await new GateReader({ home }).read(root, worktrees)
    expect(wt07!.gate.outcome).toBe('green')
  })

  it('"nothing ran" after a green line is "no data", not green', async () => {
    const { home, root, worktrees, transcript, marker } = await world()
    await rm(marker)
    const reader = new GateReader({ home })
    expect((await reader.read(root, worktrees))[1]!.gate.outcome).toBe('green')
    await appendFile(transcript, `${toolResult('[gate] nothing ran (fast): no changes. This is not green.', '2026-10-05T11:00:00.000Z')}\n`)
    expect((await reader.read(root, worktrees))[1]!.gate).toEqual({ outcome: 'none', source: 'transcript', at: '2026-10-05T11:00:00.000Z' })
  })

  it('takes the latest gate line across the worktree’s transcripts, by record time', async () => {
    const { home, root, worktree07, worktrees, marker } = await world()
    await rm(marker)
    const folder = join(home, 'projects', projectDirName(worktree07))
    await writeFile(join(folder, '55555555-5555-4555-8555-555555555555.jsonl'), `${toolResult('[gate] red (fast): later', '2026-10-05T12:00:00.000Z')}\n`)
    await writeFile(join(folder, '66666666-6666-4666-8666-666666666666.jsonl'), `${toolResult('[gate] green (fast): earlier', '2026-10-05T09:00:00.000Z')}\n`)
    expect((await new GateReader({ home }).read(root, worktrees))[1]!.gate).toEqual({ outcome: 'red', source: 'transcript', at: '2026-10-05T12:00:00.000Z' })
  })

  it('counts only gate.sh runs about this worktree: not other commands, not gate.sh after cd to another worktree or repository', async () => {
    const { home, root, worktree07, worktrees, marker } = await world()
    await rm(marker)
    // A Session started in the checkout: the gate's own tests print gate lines, gate.sh runs in
    // the worktree of Ticket 07 and in another repository. None of it is about the checkout.
    const rootFolder = join(home, 'projects', projectDirName(root))
    await mkdir(rootFolder, { recursive: true })
    await writeFile(
      join(rootFolder, '77777777-7777-4777-8777-777777777777.jsonl'),
      [
        bashRun('[gate] not verified: fixture of the gate’s tests', '2026-10-05T13:00:00.000Z', { command: 'cd ~/.claude && for t in hooks/tests/*.test.sh; do bash $t; done', cwd: root }),
        bashRun('[gate] red (fast): demo/.:test', '2026-10-05T13:01:00.000Z', { command: 'tail -1 /tmp/scratch/gate-fast.txt', cwd: root }),
        bashRun('[gate] red (fast): demo/.:test', '2026-10-05T13:02:00.000Z', { command: `cd ${worktree07} && bash ~/.claude/hooks/gate.sh fast`, cwd: root }),
        bashRun('[gate] red (fast): auction/.:test', '2026-10-05T13:03:00.000Z', { command: 'cd /Users/test/Work/Auction && ~/.claude/hooks/gate.sh fast', cwd: root }),
        bashRun('[gate] red (fast): demo/.:lint', '2026-10-05T13:04:00.000Z', { cwd: worktree07 }),
        '',
      ].join('\n'),
    )
    // In the worktree's own Session, a later red run after `cd` elsewhere is not about it either.
    await appendFile(
      join(home, 'projects', projectDirName(worktree07), '44444444-4444-4444-8444-444444444444.jsonl'),
      `${bashRun('[gate] red (fast): other', '2026-10-05T14:00:00.000Z', { command: `cd ${root} && bash ~/.claude/hooks/gate.sh fast`, cwd: worktree07 })}\n`,
    )
    const [checkout, wt07] = await new GateReader({ home }).read(root, worktrees)
    expect(checkout!.gate).toEqual({ outcome: 'none', source: 'none', at: null })
    expect(wt07!.gate).toEqual({ outcome: 'green', source: 'transcript', at: '2026-10-05T10:05:00.000Z' })

    // gate.sh run in the checkout itself (a subfolder of it) is the checkout's verdict.
    await appendFile(
      join(rootFolder, '77777777-7777-4777-8777-777777777777.jsonl'),
      `${bashRun('[gate] green (fast): demo/.:lint', '2026-10-05T15:00:00.000Z', { command: 'cd src && bash ~/.claude/hooks/gate.sh fast', cwd: root })}\n`,
    )
    expect((await new GateReader({ home }).read(root, worktrees))[0]!.gate).toEqual({ outcome: 'green', source: 'transcript', at: '2026-10-05T15:00:00.000Z' })
  })

  it('takes a gate.sh run whose result arrives in a later read', async () => {
    const { home, root, worktree07, worktrees, marker } = await world()
    await rm(marker)
    const transcript = join(home, 'projects', projectDirName(worktree07), '44444444-4444-4444-8444-444444444444.jsonl')
    const [call, result] = bashRun('[gate] red (fast): later', '2026-10-05T16:00:00.000Z', { cwd: worktree07 }).split('\n')
    const reader = new GateReader({ home })
    await appendFile(transcript, `${call}\n`)
    expect((await reader.read(root, worktrees))[1]!.gate.outcome).toBe('green')
    await appendFile(transcript, `${result}\n`)
    expect((await reader.read(root, worktrees))[1]!.gate.outcome).toBe('red')
  })

  it('writes nothing under the Claude home or in the Project', async () => {
    const { home, root, worktree07, worktrees, marker } = await world()
    await writeVerdict(home, { worktree: root, outcome: 'green' })
    await writeVerdict(home, { worktree: worktree07, outcome: 'none' })
    const listing = async (dir: string): Promise<string[]> => {
      const out: string[] = []
      for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
        const path = join(entry.parentPath, entry.name)
        const info = await stat(path)
        out.push(`${path} ${info.size} ${info.mtimeMs}`)
      }
      return out.sort()
    }
    const before = [await listing(home), await listing(root)]
    const reader = new GateReader({ home })
    await reader.read(root, worktrees)
    await rm(marker)
    const afterRemoval = [await listing(home), await listing(root)]
    await reader.read(root, worktrees)
    expect([await listing(home), await listing(root)]).toEqual(afterRemoval)
    expect(afterRemoval[0]!.length).toBe(before[0]!.length - 1)
  })
})

describe('GateReader and the Harness plugin (worfy-harness ticket 12)', () => {
  /**
   * The world above (its Gate state in <home>/gate) plus the Harness plugin in `harnessHome` with a
   * Gate state of its own: the registry, the red marker of worktree 07 and a green verdict file of
   * the checkout.
   */
  async function withPlugin(harnessHome?: string): Promise<World & { harnessHome: string; pluginMarker: string }> {
    const world0 = await world()
    const home = harnessHome ?? join(world0.home, 'worfy-harness')
    const plugin = join(home, 'plugin')
    await mkdir(join(plugin, '.claude-plugin'), { recursive: true })
    await mkdir(join(plugin, 'bin'), { recursive: true })
    await writeFile(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'worfy', version: '0.2.0+abc' }))
    await writeFile(join(plugin, 'bin', 'epic-status'), '#!/bin/sh\n')
    await mkdir(join(home, 'gate', 'state'), { recursive: true })
    await writeFile(join(home, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'plugged', match: world0.root, profile: 'worfy', pm: 'pnpm' }] }))
    const pluginMarker = join(home, 'gate', 'state', `red-plugged-${gateTag(world0.worktree07)}`)
    await writeFile(pluginMarker, '')
    await writeVerdict(home, { worktree: world0.root, outcome: 'green', key: 'plugged', at: '2026-10-05T11:00:00Z' })
    // The old Harness's state says otherwise about the checkout: unverified.
    await writeFile(join(world0.home, 'gate', 'state', `unverified-worfy-${gateTag(world0.root)}`), '')
    return { ...world0, harnessHome: home, pluginMarker }
  }

  it('reads the registry, the markers and the verdict file from <harnessHome>/gate with the plugin, and the transcripts from <claudeHome>/projects', async () => {
    const { home, root, worktrees, harnessHome, pluginMarker } = await withPlugin()
    const reader = new GateReader({ home })
    const [checkout, wt07] = await reader.read(root, worktrees)
    expect(checkout!.gate).toEqual({ outcome: 'green', source: 'file', at: '2026-10-05T11:00:00Z' })
    expect(wt07!.gate).toEqual({ outcome: 'red', source: 'marker', at: null })
    // Without the plugin's marker, worktree 07 falls back to its transcript in <claudeHome>/projects.
    await rm(pluginMarker)
    expect((await reader.read(root, worktrees))[1]!.gate.source).toBe('transcript')
    expect(harnessHome).toBe(join(home, 'worfy-harness'))
  })

  it('takes the Harness home it is given', async () => {
    const base = await tempDir()
    const { home, root, worktrees, harnessHome } = await withPlugin(join(base, 'elsewhere'))
    const [checkout, wt07] = await new GateReader({ home, harnessHome }).read(root, worktrees)
    expect(checkout!.gate.source).toBe('file')
    expect(wt07!.gate).toEqual({ outcome: 'red', source: 'marker', at: null })
    // Without it the reader looks in <home>/worfy-harness, finds no plugin and reads <home>/gate as before.
    const [checkoutDefault, wt07Default] = await new GateReader({ home }).read(root, worktrees)
    expect(checkoutDefault!.gate).toEqual({ outcome: 'unverified', source: 'marker', at: null })
    expect(wt07Default!.gate).toEqual({ outcome: 'red', source: 'marker', at: null })
  })

  it('keeps reading <claudeHome>/gate while the old Harness is there next to the plugin', async () => {
    const { home, root, worktrees, pluginMarker } = await withPlugin()
    await mkdir(join(home, 'bin'), { recursive: true })
    await writeFile(join(home, 'bin', 'epic-status'), '#!/bin/sh\n')
    const reader = new GateReader({ home })
    await rm(pluginMarker)
    const [checkout, wt07] = await reader.read(root, worktrees)
    // The old registry (key worfy) and markers: the checkout unverified, worktree 07 red.
    expect(checkout!.gate).toEqual({ outcome: 'unverified', source: 'marker', at: null })
    expect(wt07!.gate).toEqual({ outcome: 'red', source: 'marker', at: null })
    // The move takes the old scripts away: the next read, by the same reader, is the plugin's.
    await rm(join(home, 'bin'), { recursive: true })
    const [checkoutAfter] = await reader.read(root, worktrees)
    expect(checkoutAfter!.gate).toEqual({ outcome: 'green', source: 'file', at: '2026-10-05T11:00:00Z' })
  })

  it('writes nothing under the Claude home, the Harness home or in the Project', async () => {
    const { home, root, worktrees } = await withPlugin()
    const listing = async (dir: string): Promise<string[]> => {
      const out: string[] = []
      for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
        const path = join(entry.parentPath, entry.name)
        const info = await stat(path)
        out.push(`${path} ${info.size} ${info.mtimeMs}`)
      }
      return out.sort()
    }
    // The Harness home is inside the Claude home here, so the first listing covers both.
    const before = [await listing(home), await listing(root)]
    await new GateReader({ home }).read(root, worktrees)
    expect([await listing(home), await listing(root)]).toEqual(before)
  })
})

/** Writes `verdict-<tag>.json` of `fields.worktree` into the gate state folder, as gate.sh does. */
async function writeVerdict(home: string, fields: Record<string, unknown> & { worktree: string }, text?: string): Promise<string> {
  const file = join(home, 'gate', 'state', verdictFileName(gateTag(fields.worktree)))
  const verdict = { version: 1, outcome: 'green', profile: 'fast', key: 'worfy', head: 'a'.repeat(40), exit: 0, at: '2026-10-05T09:00:00Z', reason: null, ...fields }
  await writeFile(file, text ?? `${JSON.stringify(verdict)}\n`)
  return file
}

describe('GateReader and the verdict file', () => {
  /** The world with no marker and a transcript that has no gate line at all. */
  async function quiet(): Promise<World> {
    const w = await world()
    await rm(w.marker)
    await writeFile(w.transcript, `${prompt('no gate here', '2026-10-05T10:00:00.000Z')}\n`)
    return w
  }

  it('takes a green verdict file when the transcript has no gate line', async () => {
    const { home, root, worktree07, worktrees } = await quiet()
    await writeVerdict(home, { worktree: worktree07, outcome: 'green', at: '2026-10-05T09:30:00Z' })
    const [checkout, wt07] = await new GateReader({ home }).read(root, worktrees)
    expect(wt07!.gate).toEqual({ outcome: 'green', source: 'file', at: '2026-10-05T09:30:00Z' })
    expect(checkout!.gate).toEqual({ outcome: 'none', source: 'none', at: null })
  })

  it('a red marker wins over a verdict file that says none; an unverified marker wins over a green one', async () => {
    const { home, root, worktree07, worktrees, marker } = await world()
    await writeVerdict(home, { worktree: worktree07, outcome: 'none', reason: 'no changes relative to the merge-base' })
    const reader = new GateReader({ home })
    expect((await reader.read(root, worktrees))[1]!.gate).toEqual({ outcome: 'red', source: 'marker', at: null })
    await rm(marker)
    await writeFile(join(home, 'gate', 'state', `unverified-worfy-${gateTag(worktree07)}`), '')
    await writeVerdict(home, { worktree: worktree07, outcome: 'green' })
    expect((await reader.read(root, worktrees))[1]!.gate).toEqual({ outcome: 'unverified', source: 'marker', at: null })
  })

  it('takes the verdict file over a newer gate line in a transcript', async () => {
    const { home, root, worktree07, worktrees, marker } = await world()
    await rm(marker)
    // The transcript's last line is green at 10:05; the file, written at 09:00, says red.
    await writeVerdict(home, { worktree: worktree07, outcome: 'red', exit: 2, at: '2026-10-05T09:00:00Z' })
    expect((await new GateReader({ home }).read(root, worktrees))[1]!.gate).toEqual({ outcome: 'red', source: 'file', at: '2026-10-05T09:00:00Z' })
  })

  it('a file about another worktree is not taken: the transcript gives the verdict, the reason is logged once', async () => {
    const { home, root, worktree07, worktrees, marker } = await world()
    await rm(marker)
    // The name is worktree 07's, the worktree inside is another one: two tags that collide.
    await writeVerdict(home, { worktree: worktree07, outcome: 'red' }, `${JSON.stringify({ version: 1, outcome: 'red', profile: 'fast', worktree: '/elsewhere/repo', key: 'worfy', head: null, exit: 2, at: '2026-10-05T09:00:00Z', reason: null })}\n`)
    const warnings: string[] = []
    const reader = new GateReader({ home, warn: (message) => warnings.push(message) })
    expect((await reader.read(root, worktrees))[1]!.gate).toEqual({ outcome: 'green', source: 'transcript', at: '2026-10-05T10:05:00.000Z' })
    expect((await reader.read(root, worktrees))[1]!.gate.source).toBe('transcript')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('another worktree: /elsewhere/repo')
    expect(warnings[0]).not.toContain('\n')
  })

  it.each([
    ['not JSON', '{"version":1,"outcome":"gr'],
    ['an unknown version', JSON.stringify({ version: 2, outcome: 'red', profile: 'fast', key: null, head: null, exit: 2, at: '2026-10-05T09:00:00Z', reason: null })],
    ['an unknown outcome', JSON.stringify({ version: 1, outcome: 'зелено', profile: 'fast', key: null, head: null, exit: 0, at: '2026-10-05T09:00:00Z', reason: null })],
    ['no time', JSON.stringify({ version: 1, outcome: 'red', profile: 'fast', key: null, head: null, exit: 2, reason: null })],
  ])('a broken file (%s) is not taken: the transcript gives the verdict', async (_what, body) => {
    const { home, root, worktree07, worktrees, marker } = await world()
    await rm(marker)
    const text = body.startsWith('{"version":1,"outcome":"gr') ? body : JSON.stringify({ ...JSON.parse(body), worktree: worktree07 })
    await writeVerdict(home, { worktree: worktree07 }, text)
    const warnings: string[] = []
    const [, wt07] = await new GateReader({ home, warn: (message) => warnings.push(message) }).read(root, worktrees)
    expect(wt07!.gate).toEqual({ outcome: 'green', source: 'transcript', at: '2026-10-05T10:05:00.000Z' })
    expect(warnings).toHaveLength(1)
  })

  it('a file about another commit than the worktree’s HEAD is not taken; one about the same commit is', async () => {
    const { home, root, worktree07, marker } = await world()
    await rm(marker)
    await writeVerdict(home, { worktree: worktree07, outcome: 'red', exit: 2, head: 'a'.repeat(40) })
    const warnings: string[] = []
    const reader = new GateReader({ home, warn: (message) => warnings.push(message) })
    const recreated = [{ path: root, branch: 'main' }, { path: worktree07, branch: 'demo/07', head: 'b'.repeat(40) }]
    expect((await reader.read(root, recreated))[1]).toEqual({ path: worktree07, branch: 'demo/07', gate: { outcome: 'green', source: 'transcript', at: '2026-10-05T10:05:00.000Z' } })
    expect(warnings).toEqual([expect.stringContaining(`is about commit ${'a'.repeat(40)}, the worktree is at ${'b'.repeat(40)}`)])
    const same = [{ path: root, branch: 'main' }, { path: worktree07, branch: 'demo/07', head: 'a'.repeat(40) }]
    // The worktree's HEAD is not passed on: the result is the path, the branch and the gate state.
    expect((await reader.read(root, same))[1]).toEqual({ path: worktree07, branch: 'demo/07', gate: { outcome: 'red', source: 'file', at: '2026-10-05T09:00:00Z' } })
  })

  it('readVerdictFile takes a file with the timings of the run (total_ms, steps, cached) as the gate now writes it', async () => {
    const { home, worktree07 } = await world()
    const timings = {
      total_ms: 531_837,
      steps: [{ step: 'worfy/.:test', package: '.', script: 'test', ms: 518_989, exit: 1 }],
      cached: [{ step: 'worfy/.:lint', ms: 9_378, at: '2026-10-20T17:53:36Z' }],
    }
    const file = await writeVerdict(home, { worktree: worktree07, outcome: 'red', exit: 2, ...timings })
    expect(await readVerdictFile(file, worktree07)).toEqual({ verdict: expect.objectContaining({ outcome: 'red', exit: 2, worktree: worktree07 }) })
  })

  it('readVerdictFile: null without a file, the verdict for its own worktree', async () => {
    const { home, worktree07 } = await world()
    expect(await readVerdictFile(join(home, 'gate', 'state', verdictFileName(gateTag(worktree07))), worktree07)).toBeNull()
    const file = await writeVerdict(home, { worktree: worktree07, outcome: 'none', reason: 'nothing ran', key: null })
    expect(await readVerdictFile(file, worktree07)).toEqual({ verdict: expect.objectContaining({ outcome: 'none', reason: 'nothing ran', key: null, worktree: worktree07 }) })
  })

  it('readVerdictFile on Windows: a file whose `worktree` is in git’s spelling is about the same worktree as realpath spells it', async () => {
    const { home } = await world()
    const asGit = 'C:/Users/x/worfy/.claude/worktrees/07'
    const asRealpath = 'C:\\Users\\x\\worfy\\.claude\\worktrees\\07'
    const file = await writeVerdict(home, { worktree: asGit, outcome: 'red', exit: 2 })
    expect(await readVerdictFile(file, asRealpath, null, 'win32')).toEqual({ verdict: expect.objectContaining({ outcome: 'red', worktree: asGit }) })
    expect(await readVerdictFile(file, 'c:\\users\\X\\worfy\\.claude\\worktrees\\07', null, 'win32')).toEqual({ verdict: expect.objectContaining({ outcome: 'red' }) })
    expect(await readVerdictFile(file, 'C:\\Users\\x\\worfy\\.claude\\worktrees\\08', null, 'win32')).toEqual({ problem: `is about another worktree: ${asGit}` })
    // On macOS the two spellings are two different names.
    expect(await readVerdictFile(file, asRealpath, null, 'darwin')).toEqual({ problem: `is about another worktree: ${asGit}` })
  })

  // The paths do not exist, so the file system of the machine that runs the test has no say.
  it.each(['linux', 'darwin'] as const)('readVerdictFile on %s: a file whose `worktree` differs only in letter case is about another worktree', async (platform) => {
    const { home } = await world()
    const file = await writeVerdict(home, { worktree: '/nonexistent/worfy-gate/Repo', outcome: 'green' })
    expect(await readVerdictFile(file, '/nonexistent/worfy-gate/repo', null, platform)).toEqual({ problem: 'is about another worktree: /nonexistent/worfy-gate/Repo' })
    expect(await readVerdictFile(file, '/nonexistent/worfy-gate/Repo', null, platform)).toEqual({ verdict: expect.objectContaining({ outcome: 'green' }) })
  })

  it('reads the file harness/hooks/gate.mjs writes: a green run in a registered repository', async () => {
    const base = await tempDir()
    const home = join(base, 'claude')
    const repo = join(base, 'repo')
    await mkdir(join(home, 'gate', 'state'), { recursive: true })
    await mkdir(repo)
    const env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && !key.startsWith('CLAUDE_') && key !== 'HARNESS_HOME' && key !== 'GATE_SCOPE')),
      HOME: base,
      // os.homedir() reads USERPROFILE on Windows: the run must not reach the real home there.
      USERPROFILE: base,
      CLAUDE_GATE_STATE: join(home, 'gate', 'state'),
      CLAUDE_GATE_CONFIG: join(home, 'gate', 'config.json'),
      GATE_SCOPE: 'all',
    }
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: repo, env })
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { check: 'true' } }))
    git('init', '-q')
    git('add', 'package.json')
    git('commit', '-q', '-m', 'init')
    // pm is `true`: the gate runs "true run check", which passes.
    await writeFile(join(home, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'demo', match: repo, pm: 'true', root: { fast: ['check'] }, workspace: {} }] }))
    // process.execPath is Electron run as Node (ELECTRON_RUN_AS_NODE=1 is in the environment).
    const out = execFileSync(process.execPath, [join(__dirname, '..', '..', 'harness', 'hooks', 'gate.mjs'), 'fast'], { cwd: repo, env, input: '', encoding: 'utf8' })
    expect(out).toContain('[gate] green (fast)')
    // listWorktrees gives the worktree's HEAD, which the file's `head` must match.
    const [wt] = await new GateReader({ home }).read(repo, await listWorktrees(repo))
    expect(wt!.gate).toEqual({ outcome: 'green', source: 'file', at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u) })
    // git three times and the gate, each a process of its own: over 5 seconds on a busy Windows machine.
  }, 60_000)
})

describe('TranscriptGateScanner', () => {
  it('reads only what was appended since the last read, and starts over on a replaced file', async () => {
    const dir = await tempDir()
    const file = join(dir, 's.jsonl')
    await writeFile(file, `${toolResult('[gate] green (fast): a', '2026-10-05T10:00:00.000Z')}\n`)
    const scanner = new TranscriptGateScanner()
    expect((await scanner.lastIn(dir, { here: dir, worktrees: [dir] }))?.outcome).toBe('green')
    await appendFile(file, `${prompt('no gate here', '2026-10-05T10:01:00.000Z')}\n`)
    expect((await scanner.lastIn(dir, { here: dir, worktrees: [dir] }))?.outcome).toBe('green')
    await appendFile(file, `${toolResult('[gate] red (fast): b', '2026-10-05T10:02:00.000Z')}\n`)
    expect((await scanner.lastIn(dir, { here: dir, worktrees: [dir] }))?.outcome).toBe('red')
    await rm(file)
    await writeFile(file, `${prompt('fresh', '2026-10-05T10:03:00.000Z')}\n`)
    expect(await scanner.lastIn(dir, { here: dir, worktrees: [dir] })).toBeNull()
  })

  it('skips a gate.sh run whose folder cannot be told without a shell; the run before it stays the verdict', async () => {
    const dir = await tempDir()
    const file = join(dir, 's.jsonl')
    await writeFile(
      file,
      [
        bashRun('[gate] green (fast): a', '2026-10-05T10:00:00.000Z', { cwd: dir }),
        bashRun('[gate] red (fast): b', '2026-10-05T10:01:00.000Z', { command: 'W=/x; cd $W && bash ~/.claude/hooks/gate.sh fast', cwd: dir }),
        '',
      ].join('\n'),
    )
    expect(await new TranscriptGateScanner().lastIn(dir, { here: dir, worktrees: [dir] })).toEqual({ outcome: 'green', at: '2026-10-05T10:00:00.000Z' })
  })

  it('is null for a folder that does not exist', async () => {
    expect(await new TranscriptGateScanner().lastIn('/nonexistent/worfy-gate', { here: '/nonexistent', worktrees: ['/nonexistent'] })).toBeNull()
  })

  it('on Windows reads gate.mjs runs, and tells whose they are by paths in either spelling', async () => {
    const dir = await tempDir()
    const root = 'C:\\Users\\x\\worfy'
    const worktree07 = `${root}\\.claude\\worktrees\\07`
    const gate = 'node "C:\\Users\\x\\plugin\\hooks\\gate.mjs" fast </dev/null; echo "EXIT=$?"'
    await writeFile(
      join(dir, 's.jsonl'),
      [
        bashRun('[gate] green (fast): a', '2026-10-13T10:00:00.000Z', { command: gate, cwd: worktree07 }),
        // After `cd` to the checkout, as Git Bash spells it: not about the worktree.
        bashRun('[gate] not verified: b', '2026-10-13T10:01:00.000Z', { command: `cd /c/Users/x/worfy && ${gate}`, cwd: worktree07 }),
        // In a subfolder of the worktree, spelled with `/` and other letter case.
        bashRun('[gate] red (fast): c', '2026-10-13T10:02:00.000Z', { command: `cd c:/users/x/Worfy/.claude/worktrees/07/src && ${gate}`, cwd: root }),
        '',
      ].join('\n'),
    )
    const scanner = new TranscriptGateScanner('win32')
    const worktrees = [root, worktree07]
    expect(await scanner.lastIn(dir, { here: worktree07, worktrees })).toEqual({ outcome: 'red', at: '2026-10-13T10:02:00.000Z' })
    expect(await scanner.lastIn(dir, { here: root, worktrees })).toEqual({ outcome: 'unverified', at: '2026-10-13T10:01:00.000Z' })
  })

  // On macOS and Linux a path is compared as it is written. The paths do not exist, so the file
  // system of the machine that runs the test has no say.
  it.each(['linux', 'darwin'] as const)('on %s does not count a run after cd to a folder whose name only starts like the worktree’s, or to the worktree in another letter case', async (platform) => {
    const root = '/nonexistent/worfy-gate/repo'
    const gate = 'node "/nonexistent/plugin/hooks/gate.mjs" fast </dev/null; echo "EXIT=$?"'
    /** The verdict for `root` after a green run in it and a red run after `cd <target>`. */
    const lastAfterCdTo = async (target: string) => {
      const dir = await tempDir()
      await writeFile(
        join(dir, 's.jsonl'),
        [
          bashRun('[gate] green (fast): a', '2026-10-14T10:00:00.000Z', { command: gate, cwd: root }),
          bashRun('[gate] red (fast): b', '2026-10-14T10:01:00.000Z', { command: `cd ${target} && ${gate}`, cwd: root }),
          '',
        ].join('\n'),
      )
      return new TranscriptGateScanner(platform).lastIn(dir, { here: root, worktrees: [root] })
    }
    const green = { outcome: 'green', at: '2026-10-14T10:00:00.000Z' }
    expect(await lastAfterCdTo(`${root}-other`)).toEqual(green)
    expect(await lastAfterCdTo('/nonexistent/worfy-gate/Repo')).toEqual(green)
    // A subfolder of the worktree is the worktree: the red run counts.
    expect(await lastAfterCdTo(`${root}/src`)).toEqual({ outcome: 'red', at: '2026-10-14T10:01:00.000Z' })
  })
})

describe('listWorktrees', () => {
  it('lists the checkout first, then the worktrees with their branches', async () => {
    const dir = await tempDir()
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
    const root = join(dir, 'repo')
    await mkdir(root)
    git(root, 'init', '-q')
    git(root, 'commit', '-q', '--allow-empty', '-m', 'init')
    git(root, 'worktree', 'add', '-q', '-b', 'demo/07', join(root, '.claude', 'worktrees', '07'))
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, env, encoding: 'utf8' }).trim()
    // The paths are git's spelling (`C:/…` on Windows), as the app takes them: its consumers fold
    // `\` and `/` or resolve the path before comparing (worktreeOfCwd, onDisk, projectDirName).
    const toplevel = (cwd: string) => execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, env, encoding: 'utf8' }).trim()
    expect(await listWorktrees(root)).toEqual([
      { path: toplevel(root), branch: 'main', head },
      { path: toplevel(join(root, '.claude', 'worktrees', '07')), branch: 'demo/07', head },
    ])
  })

  it('is just the root outside git', async () => {
    const dir = await tempDir()
    expect(await listWorktrees(dir)).toEqual([{ path: dir, branch: null }])
  })
})
