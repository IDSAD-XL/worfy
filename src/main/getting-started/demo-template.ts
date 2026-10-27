// The template of the Demo project of Getting started: the files of a tiny todo CLI with its Epic and
// Ticket, and the draft of its Profile for harness/bin/project-connect ({ profile, rules, gate },
// harness/profiles/draft.schema.json). The template lives in code, not as a build resource, so the
// packaging stays as it is. No input or output here: the caller writes the files and connects the
// Project.
//
// The demo's own checks are split on purpose. `test/fast/` (add, list) is what the implementer's
// check and the gate fast run; `test/full/` runs the CLI, `done <n>` and its edge cases included,
// and only the gate full before the merge runs it. The Ticket says nothing of the edge cases, so the
// review is likely to find one and the rework round shows.
import { join } from 'node:path'
import type { ProfileDraft } from '../../shared/ipc/projects'

export interface DemoTemplateInput {
  /** The absolute path of the demo's repository. */
  root: string
  /** The name of the demo's Profile (`worfy-demo`). */
  profileName: string
}

export interface DemoTemplate {
  /** Path inside the repository, `/`-separated, → the text of the file (line breaks are `\n` only). */
  files: Record<string, string>
  /** The draft for `bin/project-connect`. */
  draft: ProfileDraft
}

/** The lines of a file, each ended by `\n`. */
const text = (...lines: string[]): string => lines.map((line) => `${line}\n`).join('')

/** A path as one word of a POSIX shell command (bash, Git Bash on Windows): `/` separators, single quotes. */
const shellPath = (path: string): string => `'${path.replaceAll('\\', '/').replaceAll("'", `'\\''`)}'`

const PACKAGE_JSON = `${JSON.stringify(
  {
    name: 'worfy-demo',
    version: '0.1.0',
    private: true,
    description: 'A tiny todo CLI: the demo project of worfy',
    type: 'module',
    bin: { todo: 'bin/todo.js' },
    engines: { node: '>=22' },
    scripts: {
      // A glob, not a folder: `node --test test/fast/` takes the folder for a test file and fails.
      // Node expands the glob itself where the shell does not (cmd.exe on Windows).
      'test:fast': 'node --test test/fast/*.test.js',
      test: 'node --test',
    },
  },
  null,
  2,
)}\n`

const TODO_JS = text(
  '// The task list: todo.json in a folder, one { text, done } per task.',
  "import { existsSync, readFileSync, writeFileSync } from 'node:fs'",
  "import { join } from 'node:path'",
  '',
  "const fileIn = (dir) => join(dir, 'todo.json')",
  '',
  'export function load(dir) {',
  '  const file = fileIn(dir)',
  "  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []",
  '}',
  '',
  'export function save(dir, tasks) {',
  "  writeFileSync(fileIn(dir), JSON.stringify(tasks, null, 2) + '\\n')",
  '}',
  '',
  '/** Adds a task at the end of the list and returns its number. */',
  'export function add(dir, text) {',
  '  const tasks = load(dir)',
  '  tasks.push({ text, done: false })',
  '  save(dir, tasks)',
  '  return tasks.length',
  '}',
  '',
  '/** The tasks as lines: the number, [x] for a done task, the text. */',
  'export function list(dir) {',
  "  return load(dir).map((task, i) => i + 1 + '. [' + (task.done ? 'x' : ' ') + '] ' + task.text)",
  '}',
)

const CLI_JS = text(
  '#!/usr/bin/env node',
  '// todo <command> [arguments] — the task list of the current folder (todo.json).',
  '// An error goes to stderr, and the exit code is 1.',
  "import * as todo from '../src/todo.js'",
  '',
  'const commands = {',
  '  add: (args) => {',
  "    if (args.length === 0) throw new Error('Usage: todo add <text>')",
  "    console.log('Added task ' + todo.add(process.cwd(), args.join(' ')) + '.')",
  '  },',
  '  list: () => {',
  '    const lines = todo.list(process.cwd())',
  "    console.log(lines.length > 0 ? lines.join('\\n') : 'No tasks.')",
  '  },',
  '}',
  '',
  'const [name, ...args] = process.argv.slice(2)',
  'try {',
  "  if (!Object.hasOwn(commands, name)) throw new Error('Usage: todo <' + Object.keys(commands).join('|') + '> [arguments]')",
  '  commands[name](args)',
  '} catch (error) {',
  '  console.error(error.message)',
  '  process.exitCode = 1',
  '}',
)

const FAST_TEST_JS = text(
  "import assert from 'node:assert/strict'",
  "import { mkdtempSync } from 'node:fs'",
  "import { rm } from 'node:fs/promises'",
  "import { tmpdir } from 'node:os'",
  "import { join } from 'node:path'",
  "import { after, test } from 'node:test'",
  "import { add, list } from '../../src/todo.js'",
  '',
  'const dirs = []',
  'function folder() {',
  "  const dir = mkdtempSync(join(tmpdir(), 'todo-'))",
  '  dirs.push(dir)',
  '  return dir',
  '}',
  'after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))))',
  '',
  "test('add puts a task at the end of the list', () => {",
  '  const dir = folder()',
  "  assert.equal(add(dir, 'buy milk'), 1)",
  "  assert.equal(add(dir, 'call mom'), 2)",
  "  assert.deepEqual(list(dir), ['1. [ ] buy milk', '2. [ ] call mom'])",
  '})',
  '',
  "test('list of a folder without todo.json is empty', () => {",
  '  assert.deepEqual(list(folder()), [])',
  '})',
)

const FULL_TEST_JS = text(
  '// The CLI as a user runs it, every command.',
  "import assert from 'node:assert/strict'",
  "import { spawnSync } from 'node:child_process'",
  "import { mkdtempSync } from 'node:fs'",
  "import { rm } from 'node:fs/promises'",
  "import { tmpdir } from 'node:os'",
  "import { join } from 'node:path'",
  "import { after, test } from 'node:test'",
  '',
  "const CLI = join(import.meta.dirname, '..', '..', 'bin', 'todo.js')",
  '',
  'const dirs = []',
  'function folder() {',
  "  const dir = mkdtempSync(join(tmpdir(), 'todo-'))",
  '  dirs.push(dir)',
  '  return dir',
  '}',
  'after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))))',
  '',
  '/** Runs the CLI in a folder; the line breaks of its output made \\n (Windows prints \\r\\n). */',
  'function todo(dir, ...args) {',
  "  const child = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' })",
  "  const clean = (output) => output.replace(/\\r\\n/g, '\\n').trim()",
  '  return { status: child.status, stdout: clean(child.stdout), stderr: clean(child.stderr) }',
  '}',
  '',
  "test('add and list', () => {",
  '  const dir = folder()',
  "  assert.equal(todo(dir, 'add', 'buy', 'milk').status, 0)",
  "  assert.equal(todo(dir, 'add', 'call mom').status, 0)",
  "  const listed = todo(dir, 'list')",
  '  assert.equal(listed.status, 0)',
  "  assert.deepEqual(listed.stdout.split('\\n'), ['1. [ ] buy milk', '2. [ ] call mom'])",
  '})',
  '',
  "test('list without tasks says so', () => {",
  "  assert.equal(todo(folder(), 'list').stdout, 'No tasks.')",
  '})',
  '',
  "test('an unknown command prints the usage and exits with 1', () => {",
  "  const result = todo(folder(), 'frobnicate')",
  '  assert.equal(result.status, 1)',
  "  assert.notEqual(result.stderr, '')",
  '})',
  '',
  "test('done <n> marks the task done', () => {",
  '  const dir = folder()',
  "  todo(dir, 'add', 'buy milk')",
  "  todo(dir, 'add', 'call mom')",
  "  assert.equal(todo(dir, 'done', '2').status, 0)",
  "  assert.deepEqual(todo(dir, 'list').stdout.split('\\n'), ['1. [ ] buy milk', '2. [x] call mom'])",
  '})',
  '',
  "test('done on a task that is already done prints a message and exits with 1', () => {",
  '  const dir = folder()',
  "  todo(dir, 'add', 'buy milk')",
  "  assert.equal(todo(dir, 'done', '1').status, 0)",
  "  const again = todo(dir, 'done', '1')",
  '  assert.equal(again.status, 1)',
  "  assert.notEqual(again.stderr, '')",
  "  assert.deepEqual(todo(dir, 'list').stdout.split('\\n'), ['1. [x] buy milk'])",
  '})',
  '',
  "test('done with a number outside the list prints a message and exits with 1', () => {",
  '  const dir = folder()',
  "  todo(dir, 'add', 'buy milk')",
  "  assert.equal(todo(dir, 'done', '1').status, 0)",
  "  for (const number of ['0', '2']) {",
  "    const result = todo(dir, 'done', number)",
  '    assert.equal(result.status, 1, number)',
  "    assert.notEqual(result.stderr, '', number)",
  '  }',
  "  assert.deepEqual(todo(dir, 'list').stdout.split('\\n'), ['1. [x] buy milk'])",
  '})',
)

const README_MD = text(
  '# worfy demo',
  '',
  "A tiny todo CLI that worfy's Getting started created to show one ticket going from start to merge.",
  'Try `node bin/todo.js add "buy milk"` and `node bin/todo.js list`; the tests run with `npm test`.',
)

const SPEC_MD = text(
  '# todo: a task list on the command line',
  '',
  'Status: approved',
  "Source: the demo project of worfy's Getting started",
  '',
  '## Goal',
  '',
  'A task list for one folder, on the command line: `todo add <text>`, `todo list`, and a way to mark a',
  'task done. The tasks live in `todo.json` of the current folder. No dependencies: Node.js and its',
  'built-in `node:test` only.',
  '',
  '## How it works',
  '',
  '- `bin/todo.js` reads the arguments, calls `src/todo.js` and prints the answer. An error goes to stderr,',
  '  and the exit code is 1.',
  '- `src/todo.js` reads and writes `todo.json`.',
  '- Tests: `test/fast/` — the quick ones (`npm run test:fast`); `npm test` runs every test.',
  '',
  '## Tickets',
  '',
  '- 01 — add `done <n>` that marks a task done.',
)

const TICKET_MD = text(
  '# 01 — add `done <n>` that marks a task done',
  '',
  'Type: task',
  'Status: open',
  'Blocked by: —',
  'Source: [spec.md](../spec.md)',
  '',
  '## What is happening',
  '',
  '`todo add <text>` and `todo list` work, but a finished task stays open: there is no way to mark it',
  'done.',
  '',
  '## What we do',
  '',
  '- `todo done <n>` marks task number `<n>`, as `todo list` numbers them, done and saves the list.',
  '- `todo list` shows a done task with `[x]`.',
  '',
  '## Done when',
  '',
  '- [ ] `todo done <n>` marks the task done, and `todo list` shows it with `[x]`.',
  '- [ ] A test of `done` in `test/fast/todo.test.js`.',
  '- [ ] `npm run test:fast` — exit code 0.',
  '',
  '## Tests',
  '',
  '- `test/fast/todo.test.js`: a task marked done shows as done in the list.',
  '',
  '## Where in code',
  '',
  '- `src/todo.js`',
  '- `bin/todo.js`',
  '- `test/fast/todo.test.js`',
  '',
  '## Result',
  '',
  'Filled in when the ticket closes.',
)

const GITIGNORE = text('todo.json', '.claude/worktrees/')

const RULES_MD = text(
  '# worfy demo — project rules',
  '',
  "A tiny todo CLI that worfy's Getting started created to show one ticket going from the Orchestrator",
  'through review to main. It is a local git repository: no GitHub, no remote, no pull requests.',
  '',
  '## Commands',
  '',
  '- No install step: Node.js only, no dependencies.',
  '- `npm run test:fast` runs `test/fast/`: the check of a change, and the gate fast.',
  '- `npm test` runs every test: the gate full before the merge.',
  '- The CLI: `node bin/todo.js add <text>`, `node bin/todo.js list`.',
  '',
  '## Finish',
  '',
  'A ticket finishes locally (`workflow.finish` `local-green`): a green gate full, then its branch is merged',
  'into `main` of this repository. Agent marks go to the marks file of the Harness, not to GitHub.',
  'Ticket worktrees live in `.claude/worktrees/`, which `.gitignore` keeps out of git.',
  '',
  '## Sources',
  '',
  "- worfy wrote this profile from the template of its demo project (Getting started); it was not drafted by a Session.",
)

/** The files and the Profile draft of the Demo project in `root`. */
export function demoTemplate({ root, profileName }: DemoTemplateInput): DemoTemplate {
  const worktrees = join(root, '.claude', 'worktrees')
  const profile = {
    schema: 2,
    name: profileName,
    title: 'worfy demo',
    mode: 'full',
    language: { team: 'en', docs: 'en' },
    attribution: 'on',
    layout: {
      summary: 'one package without dependencies: a todo CLI (bin/todo.js, src/todo.js), tests on node:test in test/fast and test/full',
      packages: ['.'],
      repos: null,
    },
    stack: ['JavaScript (ES modules) on Node.js 22 or later, no dependencies', 'tests on the built-in node:test, no npm install'],
    commands: {
      install: null,
      lint: null,
      typecheck: null,
      test: 'npm run test:fast',
      test_one: 'node --test <file>',
      contract: null,
      e2e: null,
      build: null,
      verify: 'npm run test:fast',
      prepare_tree: null,
      requires: [],
    },
    parallel: 'worktrees',
    worktree: {
      root: `${worktrees}/`,
      base: 'main',
      implementer: `git worktree add -b <branch> ${shellPath(join(worktrees, '<NN>'))} main`,
      reviewer: `git worktree add ${shellPath(join(worktrees, 'review-<review-target>'))} --detach <branch>`,
    },
    tickets: {
      root: '.scratch/',
      path: '.scratch/<epic>/issues/NN-*.md',
      trail_section: '## Where in code',
      done_section: '## Done when',
      spec: '.scratch/<epic>/spec.md',
      branch: '<epic>/<NN>',
    },
    workflow: {
      folder: null,
      ticket_skill: 'ship-ticket',
      implementer_steps: 'steps 1-6: claim, a fresh local main, a failing test first, the change, a bare check with the exit code; no PR, the finish is local',
      finish: 'local-green',
      merge: 'orchestrator',
      // No CI Stage (it passes only on an open PR, and the demo has none) and no Closing.
      pipeline: [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'agent-review' }, { kind: 'gate-merge' }, { kind: 'done' }],
    },
    numbering: null,
    deploy: null,
    github: { account: null },
    docs: null,
    lessons: 'profile',
    mcp: { allowed: ['worfy-canvas'] },
    review: { lenses: ['correctness', 'tests'], ticket_lenses: ['correctness', 'tests'] },
  }
  // The gate runs package.json scripts with the package manager, npm when `pm` is null.
  const gate = [{ key: profileName, match: root, profile: profileName, pm: null, root: { fast: ['test:fast'], full: ['test'] }, workspace: {} }]
  return {
    files: {
      'package.json': PACKAGE_JSON,
      'src/todo.js': TODO_JS,
      'bin/todo.js': CLI_JS,
      'test/fast/todo.test.js': FAST_TEST_JS,
      'test/full/cli.test.js': FULL_TEST_JS,
      'README.md': README_MD,
      '.scratch/todo/spec.md': SPEC_MD,
      '.scratch/todo/issues/01-done-command.md': TICKET_MD,
      '.gitignore': GITIGNORE,
    },
    draft: { profile, rules: RULES_MD, gate },
  }
}
