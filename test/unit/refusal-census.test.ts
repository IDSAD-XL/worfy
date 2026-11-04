// scripts/refusal-census.mjs: the permission requests unattended Sessions refused, counted by
// category from the Autopilot Journals and the Claude Code transcripts (worfy-auto-approve ticket
// 01). Only numbers and cleaned templates may come out: no command, path, Session id or tool input.
//
// The fixtures (test/fixtures/refusal-census/, invented, every path under /tmp/demo) were written by
// hand from the shapes Claude Code and worfy write:
//   - projects/-tmp-demo-repo/demo-session-1.jsonl, the Orchestrator in /tmp/demo/repo: refusals of
//     AskUserQuestion (2026-10-12), Edit in a worktree (10-21), an MCP tool with the text in an
//     array (10-22), WebFetch (10-22) and one whose tool_use is missing (10-22); a Read result and a
//     grep result that quote the refusal text but do not start with it; a Bash result that starts
//     with it but is not an error (`grep -ho` of the source); a copy of the Subagent's refusal of
//     `ls` without its tool_use (the same tool_use_id: counted once, as Bash);
//   - demo-session-1/subagents/agent-ademo1.jsonl, an implementer in worktree 07: `cd … && rm -rf *`
//     with Claude Code's reason (10-12), a `for` loop removing "$M/$d" (10-12, written twice), a
//     multi-line `zsh -c` script with a reason that names a path (10-21), `ls` (10-21),
//     `T=$(mktemp -d)` then `rm -rf $T/*` (10-22), Write outside the Project (10-22);
//   - demo-quiet.jsonl: no refusal text, so not parsed: its unreadable line is not counted (the one
//     of demo-session-1.jsonl is);
//   - autopilot/: three Journals (one before the rule of 2026-10-20, two after), five
//     refused-dialog lines, one unreadable line, and a file that is not a Journal.
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'refusal-census.mjs')
const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'refusal-census')
const TRANSCRIPTS = join(FIXTURES, 'projects')
const JOURNALS = join(FIXTURES, 'autopilot')

type Category = 'rm-after-cd-glob' | 'rm-var-target' | 'multiline-c-script' | 'bash-other' | 'ask-user-question' | 'edit-write' | 'mcp-tool' | 'unknown-tool'
type Outcome = 'allow' | 'deny' | 'park' | 'hard-deny'
interface Report {
  rule: string
  journals: {
    found: boolean
    unreadable?: boolean
    runs: number
    runsBeforeRule: number
    runsAfterRule: number
    refusedLines: number
    unreadableLines: number
    byDialog: Record<string, number>
    byTool: Record<string, number>
    withReason: number
    byReason: Record<string, number>
    runsWithRefusal: { beforeRule: number; afterRule: number }
  }
  transcripts: {
    found: boolean
    files: number
    filesWithRefusal: number
    unreadableFolders: number
    unreadableFiles: number
    unreadableLines: number
    refusals: number
    days: number
    byCategory: Record<Category, number>
    byCategoryAfterRule: Record<Category, number>
    byCategoryFromSubagent: Record<Category, number>
    byReason: Record<string, number>
    byDay: Record<string, number>
    beforeRule: number
    afterRule: number
    patterns?: Record<string, Record<string, number>>
    draft?: Record<Outcome, number>
    draftByCategory?: Record<string, Record<string, number>>
    draftWhy?: Record<string, number>
  }
}
type Deps = { env: Record<string, string | undefined>; home: string; platform: string; out: (text: string) => void; err: (line: string) => void }
interface Census {
  refusalCensus: (args: string[], deps: Deps) => Promise<number>
  CATEGORIES: readonly Category[]
  classify: (tool: string | null, input: unknown) => Category
  pattern: (tool: string | null, input: unknown) => string
  cleanReason: (reason: string) => string
  draftOutcome: (refusal: { tool: string | null; input: unknown; cwd: string | null }, home: string) => Outcome
  draftVerdict: (refusal: { tool: string | null; input: unknown; cwd: string | null }, home: string) => { outcome: Outcome; why: string }
  defaultJournals: (env: Record<string, string | undefined>, home: string, platform: string) => string
  defaultTranscripts: (env: Record<string, string | undefined>, home: string) => string
}
const { refusalCensus, CATEGORIES, classify, pattern, cleanReason, draftOutcome, draftVerdict, defaultJournals, defaultTranscripts } = (await import(pathToFileURL(SCRIPT).href)) as Census

const dirs: string[] = []
const locked: string[] = []
afterEach(() => {
  for (const dir of locked.splice(0)) chmodSync(dir, 0o755)
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-refusal-census-')))
  dirs.push(dir)
  return dir
}

async function inProcess(args: string[], env: Record<string, string | undefined> = {}): Promise<{ status: number; stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const status = await refusalCensus(args, {
    env,
    home: '/tmp/demo/home',
    platform: 'darwin',
    out: (text) => {
      stdout += text
    },
    err: (line) => {
      stderr += `${line}\n`
    },
  })
  return { status, stdout, stderr }
}

async function report(args: string[] = []): Promise<Report> {
  const result = await inProcess(['--transcripts', TRANSCRIPTS, '--journals', JOURNALS, '--json', ...args])
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout) as Report
}

/** Every string of the fixtures that is data, not a category: none may reach the output. */
const PRIVATE = [
  '/tmp/demo',
  'demo-session-1',
  'ademo1',
  'toolu_demo',
  'a1b2c3',
  'd4e5f6',
  'demo-card',
  'demo__send',
  'send_message',
  'secret-folder',
  'elsewhere',
  'notes.txt',
  'Which demo branch',
  'hello from demo',
  'demo.invalid',
  'mktemp',
  'build',
  'echo done',
  '"$M/$d"',
  '$T',
  'worktrees',
]
/** The commands of the fixtures, whole. */
const COMMANDS = [
  'cd /tmp/demo/repo/.claude/worktrees/07/out && rm -rf *',
  'M=/tmp/demo/m; for d in a b; do rm -rf "$M/$d"; done',
  "zsh -c 'cd /tmp/demo/x\nrm -rf build\necho done'",
  'ls /tmp/demo/secret-folder',
  'T=$(mktemp -d)\nrm -rf $T/*',
  'grep -rn unattended /tmp/demo/repo/src',
]

describe('refusal census: transcripts', () => {
  it('counts each refusal of an unattended Session once, by category', async () => {
    const { transcripts } = await report()
    expect(transcripts.found).toBe(true)
    expect(transcripts.files).toBe(3)
    expect(transcripts.filesWithRefusal).toBe(2)
    expect(transcripts.unreadableLines).toBe(1)
    expect(transcripts.refusals).toBe(11)
    expect(transcripts.byCategory).toEqual({
      'rm-after-cd-glob': 1,
      'rm-var-target': 2,
      'multiline-c-script': 1,
      'bash-other': 1,
      'ask-user-question': 1,
      'edit-write': 2,
      'mcp-tool': 1,
      'unknown-tool': 2,
    })
  })

  it('counts the refusals a Subagent asked for apart from those of the Session itself', async () => {
    const { transcripts } = await report()
    expect(transcripts.byCategoryFromSubagent).toEqual({
      'rm-after-cd-glob': 1,
      'rm-var-target': 2,
      'multiline-c-script': 1,
      'bash-other': 1,
      'ask-user-question': 0,
      'edit-write': 1,
      'mcp-tool': 0,
      'unknown-tool': 0,
    })
  })

  it('counts by day, by Claude Code reason with paths cleaned, and before and after the rule of 2026-10-20', async () => {
    const { rule, transcripts } = await report()
    expect(rule).toBe('2026-10-20')
    expect(transcripts.days).toBe(3)
    expect(transcripts.byDay).toEqual({ '2026-10-12': 3, '2026-10-21': 3, '2026-10-22': 5 })
    expect(transcripts.beforeRule).toBe(3)
    expect(transcripts.afterRule).toBe(8)
    expect(transcripts.byCategoryAfterRule).toEqual({
      'rm-after-cd-glob': 0,
      'rm-var-target': 1,
      'multiline-c-script': 1,
      'bash-other': 1,
      'ask-user-question': 0,
      'edit-write': 2,
      'mcp-tool': 1,
      'unknown-tool': 2,
    })
    expect(transcripts.byReason).toEqual({
      '(none)': 9,
      'Dangerous rm operation on statically-unresolvable target': 1,
      'This shell -c script runs rm and could not be checked at <path>': 1,
    })
  })

  it('moves the rule date with --rule-date', async () => {
    const { rule, transcripts, journals } = await report(['--rule-date', '2026-10-22'])
    expect(rule).toBe('2026-10-22')
    expect([transcripts.beforeRule, transcripts.afterRule]).toEqual([6, 5])
    expect([journals.runsBeforeRule, journals.runsAfterRule]).toEqual([2, 1])
  })

  it('prints templates of the commands with --patterns, never the commands', async () => {
    const { transcripts } = await report(['--patterns'])
    expect(transcripts.patterns).toEqual({
      'rm-after-cd-glob': { 'cd <path> && rm -rf <glob>': 1 },
      'rm-var-target': { '<var>=<path>; for <arg> in <arg> <arg>; do rm -rf <var>/<var>; done': 1, '<var>=<subst>; rm -rf <var>/<glob>': 1 },
      'multiline-c-script': { 'zsh -c <script: 3 lines>': 1 },
      'bash-other': { 'ls <path>': 1 },
      'ask-user-question': { AskUserQuestion: 1 },
      'edit-write': { Edit: 1, Write: 1 },
      'mcp-tool': { 'mcp tool': 1 },
      'unknown-tool': { WebFetch: 1, '(no tool_use)': 1 },
    })
  })

  it('judges the past refusals by the draft policy with --draft: only numbers', async () => {
    const { transcripts } = await report(['--draft'])
    expect(transcripts.draft).toEqual({ allow: 3, deny: 3, park: 5, 'hard-deny': 0 })
    expect(transcripts.draftByCategory).toEqual({
      'rm-after-cd-glob': { allow: 1 },
      'rm-var-target': { allow: 1, deny: 1 },
      'multiline-c-script': { park: 1 },
      'bash-other': { deny: 1 },
      'ask-user-question': { deny: 1 },
      'edit-write': { allow: 1, park: 1 },
      'mcp-tool': { park: 1 },
      'unknown-tool': { park: 2 },
    })
    expect(transcripts.draftWhy).toEqual({
      'allow: inside a root': 3,
      'deny: question': 1,
      'deny: loop, condition or eval': 1,
      'deny: nothing to judge': 1,
      'park: outside the roots': 2,
      'park: tool without a rule': 2,
      'park: no tool_use': 1,
    })
  })
})

describe('refusal census: who asked and when, on transcripts written by the test', () => {
  const REFUSED = 'This Session runs unattended (worfy Autopilot): no one is there to answer a permission request, so the tool call is refused.'
  /** A transcript line pair: a Bash call and its refusal. */
  const call = (id: string, at: string, extra: Record<string, unknown> = {}): string =>
    [
      { type: 'assistant', timestamp: at, cwd: '/tmp/demo/repo', ...extra, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls /tmp/demo' } }] } },
      { type: 'user', timestamp: at, cwd: '/tmp/demo/repo', ...extra, message: { content: [{ type: 'tool_result', tool_use_id: id, content: REFUSED, is_error: true }] } },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n') + '\n'

  it('takes a Subagent from its agentId alone or from the subagents/ folder alone', async () => {
    const root = tempDir()
    mkdirSync(join(root, 'p', 's', 'subagents'), { recursive: true })
    writeFileSync(join(root, 'p', 'by-id.jsonl'), call('toolu_a', '2026-10-21T00:00:00.000Z', { agentId: 'ademo2' }))
    writeFileSync(join(root, 'p', 's', 'subagents', 'agent-x.jsonl'), call('toolu_b', '2026-10-21T00:00:00.000Z'))
    writeFileSync(join(root, 'p', 'session.jsonl'), call('toolu_c', '2026-10-21T00:00:00.000Z'))
    const result = await inProcess(['--json', '--transcripts', root, '--journals', JOURNALS])
    const { transcripts } = JSON.parse(result.stdout) as Report
    expect(transcripts.byCategory['bash-other']).toBe(3)
    expect(transcripts.byCategoryFromSubagent['bash-other']).toBe(2)
  })

  it('counts a refusal at midnight of the rule day, and a run started then, as after the rule', async () => {
    const root = tempDir()
    mkdirSync(join(root, 'p'))
    mkdirSync(join(root, 'j'))
    writeFileSync(join(root, 'p', 'edge.jsonl'), call('toolu_edge', '2026-10-20T00:00:00.000Z') + call('toolu_before', '2026-10-19T23:59:59.999Z'))
    const run = '2026-10-20T00-00-00-000Z-0e0e0e'
    writeFileSync(join(root, 'j', `${run}.jsonl`), `${JSON.stringify({ at: '2026-10-20T00:00:00.000Z', run, project: 'demo', epic: 'demo-epic', kind: 'run-started' })}\n`)
    const { transcripts, journals } = JSON.parse((await inProcess(['--json', '--transcripts', join(root, 'p'), '--journals', join(root, 'j')])).stdout) as Report
    expect([transcripts.beforeRule, transcripts.afterRule]).toEqual([1, 1])
    expect([journals.runsBeforeRule, journals.runsAfterRule]).toEqual([0, 1])
  })
})

describe('refusal census: Journals', () => {
  it('counts the runs, the refused-dialog lines by tool and the runs with a refusal before and after the rule', async () => {
    const { journals } = await report()
    expect(journals.found).toBe(true)
    expect(journals.runs).toBe(3)
    expect([journals.runsBeforeRule, journals.runsAfterRule]).toEqual([1, 2])
    expect(journals.refusedLines).toBe(5)
    expect(journals.unreadableLines).toBe(1)
    expect(journals.byDialog).toEqual({ permission_request: 4, card_ask: 1 })
    expect(journals.byTool).toEqual({ Bash: 2, AskUserQuestion: 1, 'mcp tool': 1 })
    expect(journals.withReason).toBe(1)
    expect(journals.byReason).toEqual({ 'This shell -c script runs rm and could not be checked at <path>': 1 })
    expect(journals.runsWithRefusal).toEqual({ beforeRule: 1, afterRule: 1 })
  })
})

describe('refusal census: nothing private comes out', () => {
  it('prints no command, path, id or tool input of the fixtures, as JSON or as text', async () => {
    const json = await inProcess(['--transcripts', TRANSCRIPTS, '--journals', JOURNALS, '--json', '--patterns', '--draft'])
    const text = await inProcess(['--transcripts', TRANSCRIPTS, '--journals', JOURNALS, '--patterns', '--draft'])
    for (const result of [json, text]) {
      expect(result.status).toBe(0)
      expect(result.stdout.length).toBeGreaterThan(200)
      for (const secret of [...PRIVATE, ...COMMANDS]) expect(result.stdout).not.toContain(secret)
    }
    expect(text.stdout).toContain('rm-after-cd-glob')
  })

  it('does not name a folder it could not read', async () => {
    const result = await inProcess(['--transcripts', '/tmp/demo/none', '--journals', JOURNALS])
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('--transcripts')
    expect(result.stderr).not.toContain('/tmp/demo')
  })
})

describe('refusal census: classify', () => {
  const bash = (command: string): Category => classify('Bash', { command })

  it('knows every category the table of the spec has', () => {
    expect([...CATEGORIES]).toEqual(['rm-after-cd-glob', 'rm-var-target', 'multiline-c-script', 'bash-other', 'ask-user-question', 'edit-write', 'mcp-tool', 'unknown-tool'])
  })

  it('puts a multi-line -c script first, then rm with a glob after cd, then rm with a variable target', () => {
    expect(bash("bash -lc 'cd /tmp/demo\nrm -rf *'")).toBe('multiline-c-script')
    expect(bash("zsh -fc 'rm -rf /tmp/demo/a'")).toBe('bash-other')
    expect(bash('cd /tmp/demo && rm -rf $X/*')).toBe('rm-after-cd-glob')
    expect(bash('rm -rf "${X}/a"')).toBe('rm-var-target')
    expect(bash('rm -rf /tmp/demo/*')).toBe('bash-other')
  })

  it('reads quotes: a quoted glob or a single-quoted dollar is a literal', () => {
    expect(bash("cd /tmp/demo && rm -f 'a*b'")).toBe('bash-other')
    expect(bash("rm -f '$X'")).toBe('bash-other')
    expect(bash('cd /tmp/demo; echo x | rm -f ./*.log')).toBe('rm-after-cd-glob')
  })

  it('skips the body of a here-document: its lines are text, not commands', () => {
    expect(bash("cd /tmp/demo && python3 - <<'EOF'\nrm -rf $X/*\nEOF\necho ok")).toBe('bash-other')
    expect(bash('cd /tmp/demo && cat <<-END > a.txt\n\trm -rf *\n\tEND\nrm -rf $Y')).toBe('rm-var-target')
    expect(pattern('Bash', { command: "cd /tmp/demo && python3 - <<'EOF'\nimport os\nEOF\necho ok" })).toBe('cd <path> && python3 <arg> << <arg>; echo <arg>')
  })

  it('sorts the tools that are not Bash', () => {
    expect(classify('AskUserQuestion', {})).toBe('ask-user-question')
    expect(classify('MultiEdit', {})).toBe('edit-write')
    expect(classify('NotebookEdit', {})).toBe('edit-write')
    expect(classify('mcp__x__y', {})).toBe('mcp-tool')
    expect(classify('Task', {})).toBe('unknown-tool')
    expect(classify(null, null)).toBe('unknown-tool')
    expect(classify('Bash', {})).toBe('bash-other')
  })
})

describe('refusal census: templates and reasons', () => {
  it('keeps known command names and plain flags, and replaces everything else', () => {
    expect(pattern('Bash', { command: 'my-secret-tool --token=abc /tmp/demo/a > /tmp/demo/out.txt' })).toBe('<cmd> <arg> <path> > <path>')
    expect(pattern('Bash', { command: 'git -C /tmp/demo push --force origin demo-branch' })).toBe('git -C <path> push --force <arg> <arg>')
    expect(pattern('Bash', { command: 'rm -rf ~/demo "${HOME}"/x `pwd`/y' })).toBe('rm -rf <path> <var>/<path> <subst>/<path>')
    expect(pattern('Bash', { command: 'A=1 B=two node x.mjs # a comment with /tmp/demo' })).toBe('<var>=<arg> <var>=<arg> node <arg>')
    expect(pattern('mcp__demo__x', {})).toBe('mcp tool')
    expect(pattern('Some_tool', {})).toBe('<tool>')
  })

  it('clips a long template', () => {
    expect(pattern('Bash', { command: Array.from({ length: 80 }, () => 'ls /tmp/demo').join(' && ') }).length).toBeLessThanOrEqual(160)
  })

  it('cleans paths, quoted text, variables and ids out of a reason', () => {
    expect(cleanReason('Cannot resolve "$DEMO" in rm under /tmp/demo/x and C:\\demo\\y')).toBe('Cannot resolve <quoted> in rm under <path> and <path>')
    expect(cleanReason("target `rm -rf $T` of session 0123456789abcdef in ~/demo")).toBe('target <code> of session <id> in <path>')
    expect(cleanReason('cannot check rm of src/demo.ts on demo.invalid or a\\b then target.')).toBe('cannot check rm of <path> on <path> or <path> then target.')
    expect(cleanReason('x'.repeat(300)).length).toBeLessThanOrEqual(120)
  })
})

describe('refusal census: the draft policy', () => {
  const home = '/tmp/demo/home'
  const tree = '/tmp/demo/repo/.claude/worktrees/07'
  const judge = (command: string, cwd: string = tree): Outcome => draftOutcome({ tool: 'Bash', input: { command }, cwd }, home)

  it('allows a removal inside a root, never of the root itself', () => {
    expect(judge('rm -rf out/cache')).toBe('allow')
    expect(judge('rm -rf /tmp/demo/repo/.scratch/demo-epic/tmp')).toBe('allow')
    expect(judge('rm -rf ./*')).toBe('deny')
    expect(judge(`rm -rf ${tree}`)).toBe('deny')
    expect(judge('rm -rf /tmp/demo/repo/.scratch')).toBe('deny')
  })

  it('follows cd and a mktemp variable, refuses to judge an unknown variable or a loop', () => {
    expect(judge('cd out && rm -rf *')).toBe('allow')
    expect(judge('X=$(mktemp -d) && rm -rf "$X"/*')).toBe('allow')
    expect(judge('rm -rf "$UNKNOWN"/*')).toBe('deny')
    expect(judge('for d in a b; do rm -rf $d; done')).toBe('deny')
    expect(judge('rm -rf $(pwd)/x')).toBe('deny')
    expect(judge("cat > out/a.txt <<'EOF'\nrm -rf out/x\nEOF")).toBe('deny')
    expect(judge('echo x > out/a.txt 2>&1')).toBe('allow')
    expect(judge('echo x > /tmp/demo/other.txt')).toBe('park')
  })

  it('parks a target outside the roots and hard-denies the secrets of the home folder', () => {
    expect(judge('rm -rf /tmp/demo/other')).toBe('park')
    expect(judge('rm -rf ~/.ssh/known_hosts')).toBe('hard-deny')
    expect(judge('cd ~ && rm -rf .claude/projects')).toBe('hard-deny')
    expect(judge('sudo rm -rf out')).toBe('hard-deny')
    expect(judge("zsh -c 'cd out\nrm -rf a\nrm -rf b'")).toBe('allow')
    expect(judge("zsh -c 'rm -rf a\nrm -rf /tmp/demo/other'")).toBe('park')
  })

  it('denies a questioned call with nothing to judge, and the questions themselves', () => {
    expect(judge('ls /tmp/demo')).toBe('deny')
    expect(draftOutcome({ tool: 'AskUserQuestion', input: {}, cwd: tree }, home)).toBe('deny')
    expect(draftOutcome({ tool: 'Write', input: { file_path: `${tree}/a.txt` }, cwd: tree }, home)).toBe('allow')
    expect(draftOutcome({ tool: 'Write', input: { file_path: `${home}/.claude/settings.json` }, cwd: tree }, home)).toBe('hard-deny')
    expect(draftOutcome({ tool: 'mcp__x__y', input: {}, cwd: tree }, home)).toBe('park')
  })

  it('says why with a fixed label, never with a part of the command', () => {
    const why = (command: string): string => draftVerdict({ tool: 'Bash', input: { command }, cwd: tree }, home).why
    expect(why('sudo rm -rf out')).toBe('system command')
    expect(why('rm -rf ~/.ssh')).toBe('home folder or its secrets')
    expect(why('rm -rf .')).toBe('a whole root')
    expect(why('rm -rf "$NOPE"')).toBe('unknown variable or substitution')
    expect(why('git push origin demo')).toBe('git push')
    expect(why('cat <<EOF\nx\nEOF')).toBe('here-document')
    expect(why("zsh -fc 'zmodload zsh/files\nprint x'")).toBe('zsh built-in')
  })

  it('judges the script of a trap with the variables it was given', () => {
    expect(judge(`T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; echo x > "$T/a"`)).toBe('allow')
    expect(judge(`trap 'rm -rf "$NOPE"' EXIT`)).toBe('deny')
    expect(judge(`trap 'rm -rf /tmp/demo/other' EXIT`)).toBe('park')
  })

  it('reads a Windows worktree and a Git Bash path as the same folder', () => {
    const win = 'C:\\demo\\repo\\.claude\\worktrees\\07'
    expect(draftOutcome({ tool: 'Bash', input: { command: 'rm -rf /c/demo/repo/.claude/worktrees/07/out' }, cwd: win }, 'C:\\demo\\home')).toBe('allow')
    expect(draftOutcome({ tool: 'Write', input: { file_path: 'c:\\Demo\\Repo\\.claude\\worktrees\\07\\a.txt' }, cwd: win }, 'C:\\demo\\home')).toBe('allow')
    expect(draftOutcome({ tool: 'Bash', input: { command: 'rm -rf /c/demo/home/.ssh' }, cwd: win }, 'C:\\demo\\home')).toBe('hard-deny')
  })
})

describe('refusal census: defaults and the command line', () => {
  it('reads the Journals of the installed worfy and the transcripts of the Claude Code home by default', () => {
    expect(defaultJournals({}, '/tmp/demo/home', 'darwin')).toBe(join('/tmp/demo/home', 'Library', 'Application Support', 'worfy', 'autopilot'))
    expect(defaultJournals({ APPDATA: 'D:\\Profiles\\demo' }, 'C:\\demo', 'win32')).toBe('D:\\Profiles\\demo\\worfy\\autopilot')
    expect(defaultJournals({ APPDATA: '\\\\server\\profiles\\demo' }, 'C:\\demo', 'win32')).toBe('\\\\server\\profiles\\demo\\worfy\\autopilot')
    expect(defaultJournals({ APPDATA: 'Roaming' }, 'C:\\demo', 'win32')).toBe('C:\\demo\\AppData\\Roaming\\worfy\\autopilot')
    expect(defaultJournals({}, 'C:\\demo', 'win32')).toBe('C:\\demo\\AppData\\Roaming\\worfy\\autopilot')
    expect(defaultJournals({ WORFY_DATA_DIR: '/tmp/demo/data' }, '/tmp/demo/home', 'darwin')).toBe(join('/tmp/demo/data', 'autopilot'))
    expect(defaultTranscripts({}, '/tmp/demo/home')).toBe(join('/tmp/demo/home', '.claude', 'projects'))
    expect(defaultTranscripts({ CLAUDE_CONFIG_DIR: '/tmp/demo/config' }, '/tmp/demo/home')).toBe(join('/tmp/demo/config', 'projects'))
  })

  it('reports a missing default folder as not found and fails only when both are missing', async () => {
    const empty = tempDir()
    const one = await inProcess(['--json', '--transcripts', TRANSCRIPTS], { WORFY_DATA_DIR: join(empty, 'data') })
    expect(one.status).toBe(0)
    expect((JSON.parse(one.stdout) as Report).journals).toEqual({ found: false })
    const none = await inProcess(['--json'], { WORFY_DATA_DIR: join(empty, 'data'), CLAUDE_CONFIG_DIR: join(empty, 'config') })
    expect(none.status).toBe(1)
  })

  it('refuses an unknown option, and does not echo an argument that is not an option name', async () => {
    const result = await inProcess(['--commands'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--commands')
    for (const arg of ['/tmp/demo/folder', '--x=/tmp/demo/y']) {
      const other = await inProcess([arg])
      expect(other.status).toBe(2)
      expect(other.stderr).toContain('unexpected argument')
      expect(other.stderr).not.toContain('/tmp/demo')
    }
  })

  // chmod 000 does not make a folder unreadable on Windows, nor for root.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reports a Journal folder it cannot read without its path and still counts the transcripts (not on Windows or as root: chmod 000 does not lock a folder there)', async () => {
    const copy = tempDir()
    cpSync(JOURNALS, join(copy, 'autopilot'), { recursive: true })
    chmodSync(join(copy, 'autopilot'), 0o000)
    locked.push(join(copy, 'autopilot'))
    const result = await inProcess(['--json', '--transcripts', TRANSCRIPTS, '--journals', join(copy, 'autopilot')])
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('could not be read')
    expect(result.stderr).not.toContain(copy)
    const parsed = JSON.parse(result.stdout) as Report
    expect(parsed.journals).toEqual({ found: false, unreadable: true })
    expect(parsed.transcripts.refusals).toBe(11)
    const text = await inProcess(['--transcripts', TRANSCRIPTS, '--journals', join(copy, 'autopilot')])
    expect(text.stdout).toContain('journals: folder unreadable')
    expect(text.stdout).not.toContain(copy)
  })

  it('runs as a script and writes nothing into the folders it reads', () => {
    const copy = tempDir()
    cpSync(FIXTURES, copy, { recursive: true })
    const before = listing(copy)
    const result = spawnSync(scriptNode(), [SCRIPT, '--transcripts', join(copy, 'projects'), '--journals', join(copy, 'autopilot'), '--patterns', '--draft'], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('refusals')
    expect(result.stdout).not.toContain(copy)
    expect(listing(copy)).toEqual(before)
  })
})

/** Every file under a folder with its size and modification time. */
function listing(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      const stat = statSync(path)
      if (stat.isDirectory()) walk(path)
      else files.push(`${path} ${stat.size} ${stat.mtimeMs} ${readFileSync(path).length}`)
    }
  }
  walk(root)
  return files.sort()
}
