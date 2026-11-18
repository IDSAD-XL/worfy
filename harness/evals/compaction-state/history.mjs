#!/usr/bin/env node
// node history.mjs > history.jsonl — writes the history of the case compaction-state: the Claude Code
// transcript (one JSON object per line) of an implementer half-way through ticket demo/01, which
// `claude plugin eval` resumes (`context.history_file` of case.yaml, `--resume <file>`) before the prompt.
//
// The scenario matches the fixture scaffold.sh builds, step by step: the brief, the ticket read, the claim,
// the conventions and the other tickets read, a red test, a first plan that the orchestrator corrects
// (NaN and Infinity are numbers), the commit of double, the entry point, and a red `node --test` because
// `exports` names ./src/index.js. The history ends there; the prompt of the case asks the questions of
// probes.md after the auto-compaction that the low threshold of prompt.md (env) starts.
//
// The facts the probes ask about are spread over the history on purpose and some of them change on the
// way (the plan for NaN): a summary that keeps only the last messages loses them.
//
// Everything is fixed: the uuids come from a counter, the times from a fixed start, the paths are relative
// to the worktree (the run's folder is not known here). Run it again after any change to the scenario.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SESSION = '5c0e7a3e-13c0-4d6a-9b1e-2f6a8c4d0b13'
const MODEL = 'claude-sonnet-5'
const CWD = '/tmp/demo-work'
const START = Date.parse('2026-10-01T09:10:00Z')
// The tokens of the system prompt, the tools and the rules of the session, before the first message.
const BASE_TOKENS = 21000

let counter = 0
const id = (kind) => createHash('sha256').update(`${kind}-${counter++}`).digest('hex')
const uuid = () => {
  const h = id('uuid')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
let clock = START
const time = () => new Date((clock += 7000)).toISOString()

const rows = []
let parent = null
let tokens = BASE_TOKENS
const common = () => ({ isSidechain: false, userType: 'external', cwd: CWD, sessionId: SESSION, version: '2.1.322', gitBranch: 'demo/01' })
const count = (value) => Math.ceil(JSON.stringify(value).length / 4)

function push(row) {
  const full = { parentUuid: parent, ...row, uuid: uuid(), timestamp: time(), ...common() }
  rows.push(full)
  parent = full.uuid
  return full
}

/** A message of the user (the orchestrator that launched the implementer). */
function user(text) {
  tokens += count(text)
  push({ type: 'user', message: { role: 'user', content: text } })
}

/** One assistant message: text, then at most one Bash call; the call's result follows when `output` is given. */
function assistant(text, call) {
  const content = []
  if (text) content.push({ type: 'text', text })
  let callId = null
  if (call) {
    callId = `toolu_${id('tool').slice(0, 24)}`
    content.push({ type: 'tool_use', id: callId, name: 'Bash', input: { command: call.command, description: call.description } })
  }
  const output = count(content)
  const row = push({
    type: 'assistant',
    message: {
      model: MODEL,
      id: `msg_${id('msg').slice(0, 24)}`,
      type: 'message',
      role: 'assistant',
      content,
      stop_reason: call ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 3, cache_creation_input_tokens: 400, cache_read_input_tokens: tokens - 403, output_tokens: output },
    },
    requestId: `req_${id('req').slice(0, 24)}`,
  })
  tokens += output
  if (call) {
    const result = call.output
    tokens += count(result)
    push({
      type: 'user',
      message: { role: 'user', content: [{ tool_use_id: callId, type: 'tool_result', content: result, is_error: call.exit !== 0 }] },
      toolUseResult: { stdout: result, stderr: '', interrupted: false, isImage: false },
      sourceToolAssistantUUID: row.uuid,
    })
  }
}

const read = (file) => readFileSync(join(HERE, file), 'utf8')
const withExit = (text, exit) => (exit === 0 ? text : `${text}\nExit code ${exit}`)

// --- the files as the history shows them -------------------------------------------------------
const ticketOpen = `# 01 — alpha: функция double

Type: task
Status: open
Blocked by: —

## Что происходит

В \`src/\` нет функции \`double\`, а у пакета нет общей точки входа: \`sum\` импортируют по пути файла.

## Что делаем

1. \`src/alpha.mjs\` экспортирует \`double(n)\`: возвращает \`n * 2\`; для не-числа бросает \`TypeError\`.
2. \`src/index.mjs\` (новый) реэкспортирует \`sum\` и \`double\`.
3. \`package.json\`: поле \`exports\` указывает на \`./src/index.mjs\`.

## Готово, когда

- [ ] \`double(2)\` возвращает \`4\`; test в \`test/alpha.test.mjs\`.
- [ ] \`double('2')\` бросает \`TypeError\`; test там же.
- [ ] \`import { sum, double } from 'demo'\` работает; test в \`test/index.test.mjs\`.
- [ ] \`node --test\` — код 0.

## Где в коде

- \`src/alpha.mjs\` — новый
- \`test/alpha.test.mjs\` — новый
- \`src/index.mjs\` — новый
- \`test/index.test.mjs\` — новый
- \`package.json\`

## Итог

Заполняется при закрытии.
`

const otherTicket = (nn, slug, title, fn, body, call, expected) => `# ${nn} — ${title}

Type: task
Status: open
Blocked by: —

## Что происходит

В \`src/\` нет функции \`${fn}\`.

## Что делаем

\`src/${slug}.mjs\` экспортирует \`${fn}(n)\`: ${body}.

## Готово, когда

- [ ] \`${call}\` возвращает \`${expected}\`; test в \`test/${slug}.test.mjs\`.
- [ ] \`node --test\` — код 0.

## Где в коде

- \`src/${slug}.mjs\` — новый
- \`test/${slug}.test.mjs\` — новый

## Итог

Заполняется при закрытии.
`

const spec = `# Epic demo — четыре маленькие функции

Учебный Epic: четыре независимые функции в \`src/\`, у каждой свой test.

## Волны

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | src/alpha.mjs, test/alpha.test.mjs | 1 |
| 02 | src/bravo.mjs, test/bravo.test.mjs | 1 |
| 03 | src/charlie.mjs, test/charlie.test.mjs | 1 |
| 04 | src/delta.mjs, test/delta.test.mjs | 1 |
`

const testAlphaFirst = `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { double } from '../src/alpha.mjs'

test('double doubles', () => {
  assert.equal(double(2), 4)
})

test('double rejects a string', () => {
  assert.throws(() => double('2'), { name: 'TypeError', message: 'double: n must be a number' })
})

test('double rejects nan', () => {
  assert.throws(() => double(NaN), { name: 'TypeError', message: 'double: n must be a number' })
})
`

const testAlpha = `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { double } from '../src/alpha.mjs'

test('double doubles', () => {
  assert.equal(double(2), 4)
})

test('double rejects a string', () => {
  assert.throws(() => double('2'), { name: 'TypeError', message: 'double: n must be a number' })
})

test('double keeps nan and infinity', () => {
  assert.ok(Number.isNaN(double(NaN)))
  assert.equal(double(Infinity), Infinity)
})
`

const tap = (lines, { pass, fail }) =>
  [
    ...lines,
    `ℹ tests ${pass + fail}`,
    'ℹ suites 0',
    `ℹ pass ${pass}`,
    `ℹ fail ${fail}`,
    'ℹ cancelled 0',
    'ℹ skipped 0',
    'ℹ todo 0',
    'ℹ duration_ms 44.103125',
  ].join('\n')

const notFound = (missing, from) => `node:internal/modules/esm/resolve:271
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '${CWD}/${missing}' imported from ${CWD}/${from}
    at finalizeResolution (node:internal/modules/esm/resolve:271:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:992:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:701:20)
    at #resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:721:38)
    at ModuleLoader.resolveSync (node:internal/modules/esm/loader:759:56)
    at #resolve (node:internal/modules/esm/loader:683:17)
    at ModuleLoader.getOrCreateModuleJob (node:internal/modules/esm/loader:603:35)
    at ModuleJob.syncLink (node:internal/modules/esm/module_job:163:33)
    at ModuleJob.link (node:internal/modules/esm/module_job:253:17) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file://${CWD}/${missing}'
}

Node.js v24.19.0`

// --- the session ----------------------------------------------------------------------------------
user(`You are the implementer of one ticket. Work only on it, with tests, then stop and report.

Goal: ticket demo/01 (alpha) — the function \`double\` in src/alpha.mjs, the package entry point src/index.mjs that re-exports \`sum\` and \`double\`, and the \`exports\` field of package.json, as the ticket describes.
Repository: the demo project. Ticket: .scratch/demo/issues/01-alpha.md; spec: .scratch/demo/spec.md.
Worktree: the current folder, already on branch demo/01 (base origin/main). Do not touch the main checkout and do not switch branches.
Files: those of the ticket's section «Где в коде» only. Anything else you notice goes into out_of_scope of the report, not into the diff.
Conventions: docs/conventions.md is mandatory; read it before the first edit.
Commits: English, "demo/01: <what>", one for the claim of the ticket and one per finished step; do not push.
Finish: local-green. \`node --test\` must exit 0, then the gate fast, then the report. There is no pull request: I merge the branch after I read the report.
Report: JSON with ticket, branch, files_changed, commands with exit codes, claims with evidence, removed, not_verified, out_of_scope.
Do not run review agents. Ask me through your reply only if a decision is not yours to take.`)

assistant('I start with the ticket.', { command: 'cat .scratch/demo/issues/01-alpha.md', description: 'Read the ticket', output: ticketOpen, exit: 0 })
assistant('Claiming the ticket, as a commit of its own.', {
  command: "sed -i '' 's/^Status: open$/Status: claimed 2026-10-01T09:12Z/' .scratch/demo/issues/01-alpha.md && git commit -qam 'demo/01: claim' && git log --oneline -2",
  description: 'Claim the ticket and commit',
  output: 'b535925 demo/01: claim\nfca7444 demo: ticket 01 grows an entry point; conventions',
  exit: 0,
})
assistant('Now the conventions, before the first edit.', { command: 'cat docs/conventions.md', description: 'Read the code conventions', output: read('conventions.md'), exit: 0 })
assistant('Which commit brought the conventions and the larger ticket, and what else it changed.', {
  command: 'git show --stat --patch fca7444 -- docs/conventions.md',
  description: 'Show the commit of the conventions',
  output: `commit fca7444
Author: demo <demo@example.invalid>
Date:   Thu Oct 1 12:00:00 2026 +0000

    demo: ticket 01 grows an entry point; conventions

 .scratch/demo/issues/01-alpha.md |  11 +++-
 docs/conventions.md              | 112 +++++++++++++++++++++++++++++++++++++++
 2 files changed, 121 insertions(+), 2 deletions(-)

diff --git a/docs/conventions.md b/docs/conventions.md
new file mode 100644
--- /dev/null
+++ b/docs/conventions.md
@@ -0,0 +1,112 @@
${read('conventions.md')
  .replace(/\n$/, '')
  .split('\n')
  .map((line) => `+${line}`)
  .join('\n')}`,
  exit: 0,
})
assistant('The spec and the other tickets of the epic, to see what is mine and what is not.', {
  command: 'cat .scratch/demo/spec.md .scratch/demo/issues/02-bravo.md .scratch/demo/issues/03-charlie.md .scratch/demo/issues/04-delta.md',
  description: 'Read the spec and the other tickets',
  output: [
    spec,
    otherTicket('02', 'bravo', 'bravo: функция square', 'square', 'возвращает `n * n`', 'square(3)', '9'),
    otherTicket('03', 'charlie', 'charlie: функция negate', 'negate', 'возвращает `-n`', 'negate(5)', '-5'),
    otherTicket('04', 'delta', 'delta: функция tripel', 'triple', 'возвращает `n * 3`', 'triple(2)', '6'),
  ].join('\n'),
  exit: 0,
})
assistant('And the code that is there.', {
  command: 'cat package.json src/sum.mjs test/sum.test.mjs && git status --short && git log --oneline',
  description: 'Read the package and the existing code',
  output: `{
  "name": "demo",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
/** Adds two numbers. */
export function sum(a, b) {
  return a + b
}
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sum } from '../src/sum.mjs'

test('sum adds two numbers', () => {
  assert.equal(sum(2, 3), 5)
})
b535925 demo/01: claim
fca7444 demo: ticket 01 grows an entry point; conventions
a42f2a5 demo: sum and epic demo`,
  exit: 0,
})
assistant(
  `Plan:
1. test/alpha.test.mjs first, red: double(2) is 4, double('2') throws TypeError, and double(NaN) throws too — I read "для не-числа" in the ticket as anything that is not a finite number, so the check will be \`Number.isFinite(n)\`.
2. src/alpha.mjs: the error message follows conventions 2.2: \`double: n must be a number\`.
3. src/index.mjs and the \`exports\` field (conventions 4.1 and 4.2), with test/index.test.mjs importing the package by its name.
4. node --test with the exit code, the gate fast, the report.`,
  {
    command: `mkdir -p test && cat > test/alpha.test.mjs <<'EOF'\n${testAlphaFirst}EOF\nnode --test`,
    description: 'Write the double test and run the tests',
    output: withExit(
      tap(
        [notFound('src/alpha.mjs', 'test/alpha.test.mjs'), '✖ test/alpha.test.mjs (31.22ms)', '✔ sum adds two numbers (0.301ms)', '', '✖ failing tests:', '', 'test at test/alpha.test.mjs:1:1', '✖ test/alpha.test.mjs (31.22ms)', "  'test failed'"],
        { pass: 1, fail: 1 },
      ),
      1,
    ),
    exit: 1,
  },
)
assistant('Red for the right reason: src/alpha.mjs does not exist yet. Now the function.', {
  command: `cat > src/alpha.mjs <<'EOF'
/** Doubles a finite number; anything else is a TypeError. */
export function double(n) {
  if (!Number.isFinite(n)) throw new TypeError('double: n must be a number')
  return n * 2
}
EOF
node --test`,
  description: 'Write double and run the tests',
  output: tap(['✔ double doubles (0.402ms)', '✔ double rejects a string (0.311ms)', '✔ double rejects nan (0.090ms)', '✔ sum adds two numbers (0.287ms)'], { pass: 4, fail: 0 }),
  exit: 0,
})
assistant('Green: 4 tests, exit code 0. Before the commit I go on to the entry point; the double step is done.')

user(`Course correction from the orchestrator, before you commit double: NaN and Infinity are numbers in this project (docs/conventions.md, 2.4). double(NaN) returns NaN and double(Infinity) returns Infinity; only a value whose type is not number throws the TypeError. Replace the NaN test accordingly.
And one more decision: leave src/sum.mjs as it is, even though it has no type check of its own — put that into out_of_scope of the report, with its file:line.`)

assistant('Understood: the check becomes `typeof n !== \'number\'`, and the NaN test becomes a test that NaN and Infinity pass through. src/sum.mjs stays untouched; its missing check goes to out_of_scope as src/sum.mjs:2.', {
  command: `cat > src/alpha.mjs <<'EOF'
/** Doubles a number. NaN and Infinity are numbers too; any other type is a TypeError. */
export function double(n) {
  if (typeof n !== 'number') throw new TypeError('double: n must be a number')
  return n * 2
}
EOF
cat > test/alpha.test.mjs <<'EOF'
${testAlpha}EOF
node --test`,
  description: 'Switch double to a type check and run the tests',
  output: tap(['✔ double doubles (0.392ms)', '✔ double rejects a string (0.305ms)', '✔ double keeps nan and infinity (0.081ms)', '✔ sum adds two numbers (0.293ms)'], { pass: 4, fail: 0 }),
  exit: 0,
})
assistant('Green again, exit code 0. Committing the double step.', {
  command: "git add src/alpha.mjs test/alpha.test.mjs && git commit -qm 'demo/01: double with tests' && git log --oneline -3 && git status --short",
  description: 'Commit double and its tests',
  output: '6e006c3 demo/01: double with tests\nb535925 demo/01: claim\nfca7444 demo: ticket 01 grows an entry point; conventions',
  exit: 0,
})
assistant(
  'Next the entry point. The test of src/index.mjs imports the package by its own name, `demo` (a self-reference through `exports`, conventions 1.4): that way it checks the `exports` field and not only the file.',
  {
    command: `cat > src/index.mjs <<'EOF'
export { sum } from './sum.mjs'
export { double } from './alpha.mjs'
EOF
cat > test/index.test.mjs <<'EOF'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { double, sum } from 'demo'

test('the package exports sum and double', () => {
  assert.equal(sum(2, 3), 5)
  assert.equal(double(2), 4)
})
EOF
node -e "const f='package.json';const p=JSON.parse(require('fs').readFileSync(f,'utf8'));const {scripts,...rest}=p;require('fs').writeFileSync(f,JSON.stringify({...rest,exports:'./src/index.js',scripts},null,2)+'\\n')"
cat package.json`,
    description: 'Write the entry point, its test and the exports field',
    output: `{
  "name": "demo",
  "private": true,
  "type": "module",
  "exports": "./src/index.js",
  "scripts": {
    "test": "node --test"
  }
}`,
    exit: 0,
  },
)
assistant('Running the tests with the entry point.', {
  command: 'node --test',
  description: 'Run all tests',
  output: withExit(
    tap(
      [
        '✔ double doubles (0.392ms)',
        '✔ double rejects a string (0.305ms)',
        '✔ double keeps nan and infinity (0.081ms)',
        notFound('src/index.js', 'test/index.test.mjs'),
        '✖ test/index.test.mjs (29.77ms)',
        '✔ sum adds two numbers (0.293ms)',
        '',
        '✖ failing tests:',
        '',
        'test at test/index.test.mjs:1:1',
        '✖ test/index.test.mjs (29.77ms)',
        "  'test failed'",
      ],
      { pass: 4, fail: 1 },
    ),
    1,
  ),
  exit: 1,
})
assistant('Red: exit code 1, one of 5 tests fails. Checking what the worktree holds now.', {
  command: 'git status --short && git log --oneline -3',
  description: 'Show the state of the worktree',
  output: ' M package.json\n?? src/index.mjs\n?? test/index.test.mjs\n6e006c3 demo/01: double with tests\nb535925 demo/01: claim\nfca7444 demo: ticket 01 grows an entry point; conventions',
  exit: 0,
})
assistant(
  "Found it: test/index.test.mjs fails with ERR_MODULE_NOT_FOUND for src/index.js — the `exports` field I wrote names ./src/index.js, but the file is src/index.mjs (conventions 4.2 says ./src/index.mjs). The double step is committed; the entry point, its test and package.json are not committed yet. I stop here for now and continue with that fix.",
)

process.stdout.write(rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
