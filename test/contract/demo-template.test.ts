// The template of the Demo project (src/main/getting-started/demo-template.ts), run: written into a
// temporary folder, its own tests run with the Node that runs this test, its Profile draft goes
// through the real harness/bin/project-connect --check in a temporary Harness home, and the real
// harness/bin/epic-status reads its Epic. Nothing here starts an agent.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { demoTemplate } from '../../src/main/getting-started/demo-template'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const BIN = join(import.meta.dirname, '..', '..', 'harness', 'bin')

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

function tempDir(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(dir)
  return dir
}

type Files = Record<string, string>

/** Writes the template's files (changed by `edit`, if given) into a new folder. */
function written(edit?: (files: Files) => Files): { root: string; template: ReturnType<typeof demoTemplate> } {
  const root = tempDir('worfy-demo-template-')
  const template = demoTemplate({ root, profileName: 'worfy-demo' })
  for (const [file, text] of Object.entries(edit ? edit({ ...template.files }) : template.files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return { root, template }
}

/**
 * Runs a `node …` script of the demo's package.json with the real node (test/script-node.ts); the
 * demo's tests start their CLI with process.execPath, so it runs there too. No shell: the glob of `test:fast` is expanded by node, as on Windows. Returns the exit code
 * and the names of the tests that failed, from the TAP report.
 */
function runScript(root: string, script: string): { status: number | null; failed: string[]; output: string } {
  const scripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts
  const [node, flag, ...rest] = (scripts[script] ?? '').split(' ')
  expect([node, flag]).toEqual(['node', '--test'])
  const child = spawnSync(scriptNode(), ['--test', '--test-reporter=tap', ...rest], { cwd: root, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  const output = `${child.stdout}${child.stderr}`
  const failed = [...output.matchAll(/^\s*not ok \d+ - (.+)$/gmu)].map((match) => (match[1] ?? '').trim()).sort()
  return { status: child.status, failed, output }
}

// The `done` a finished Ticket of the demo would add, and the same without the check of a task that
// is already done — the edge case the reviewer's full check is there to catch.
const ALREADY_DONE_CHECK = "  if (task.done) throw new Error('Task ' + number + ' is already done.')\n"
const REFERENCE_DONE = [
  '',
  'export function done(dir, number) {',
  '  const tasks = load(dir)',
  '  const task = Number.isInteger(number) ? tasks[number - 1] : undefined',
  "  if (task === undefined) throw new Error('There is no task ' + number + '.')",
  ALREADY_DONE_CHECK + '  task.done = true',
  '  save(dir, tasks)',
  '  return task',
  '}',
  '',
].join('\n')
const DONE_COMMAND = "  done: (args) => {\n    const task = todo.done(process.cwd(), Number(args[0]))\n    console.log('Done: ' + task.text)\n  },\n"

function withDone(done: string): (files: Files) => Files {
  return (files) => {
    const cli = files['bin/todo.js'] ?? ''
    expect(cli).toContain('const commands = {\n')
    return { ...files, 'src/todo.js': (files['src/todo.js'] ?? '') + done, 'bin/todo.js': cli.replace('const commands = {\n', `const commands = {\n${DONE_COMMAND}`) }
  }
}

const DONE_TESTS = [
  'done <n> marks the task done',
  'done on a task that is already done prints a message and exits with 1',
  'done with a number outside the list prints a message and exits with 1',
]

describe('the tests of the Demo project', () => {
  it('before the Ticket: the fast suite passes, the whole suite fails in the done tests only', () => {
    const { root } = written()
    const fast = runScript(root, 'test:fast')
    expect(fast.status, fast.output).toBe(0)
    expect(fast.output).toMatch(/^# pass [1-9]/mu)
    const full = runScript(root, 'test')
    expect(full.status, full.output).not.toBe(0)
    expect(full.failed, full.output).toEqual(DONE_TESTS)
  })

  it('with a reference done the whole suite passes', () => {
    const reference = runScript(written(withDone(REFERENCE_DONE)).root, 'test')
    expect(reference.status, reference.output).toBe(0)
    expect(reference.failed).toEqual([])
  })

  it('with a done that misses the already-done check exactly the edge-case test fails', () => {
    expect(REFERENCE_DONE).toContain(ALREADY_DONE_CHECK)
    const careless = runScript(written(withDone(REFERENCE_DONE.replace(ALREADY_DONE_CHECK, ''))).root, 'test')
    expect(careless.status, careless.output).not.toBe(0)
    expect(careless.failed, careless.output).toEqual([DONE_TESTS[1]])
  })
})

describe('the Profile draft of the Demo project', () => {
  it('passes the real project-connect --check in a temporary Harness home', () => {
    const { template } = written()
    const home = tempDir('worfy-demo-harness-')
    const child = spawnSync(scriptNode(), [join(BIN, 'project-connect'), '--check'], {
      input: JSON.stringify(template.draft),
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HOME: home, USERPROFILE: home, HARNESS_HOME: join(home, 'harness') },
    })
    expect(child.status, `${child.stdout}${child.stderr}`).toBe(0)
    expect(JSON.parse(child.stdout)).toEqual({ ok: true, name: 'worfy-demo', gateKeys: ['worfy-demo'], workflowFolder: null })
  })
})

describe('the Epic of the Demo project', () => {
  it('epic-status sees the Epic todo with one open Ticket', () => {
    const { root } = written()
    const child = spawnSync(scriptNode(), [join(BIN, 'epic-status'), '--json', '--root', join(root, '.scratch'), 'todo'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    expect(child.status, `${child.stdout}${child.stderr}`).toBe(0)
    const status = JSON.parse(child.stdout) as { epics: unknown[]; tickets: unknown[] }
    expect(status.epics).toEqual([expect.objectContaining({ epic: 'todo', hasSpec: true })])
    expect(status.tickets).toEqual([
      expect.objectContaining({ epic: 'todo', num: 1, state: 'open', title: '01 — add `done <n>` that marks a task done', blockedParsed: true, statusError: null }),
    ])
  })
})
