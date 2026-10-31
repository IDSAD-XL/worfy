// qmd as part of the Harness (src/main/harness/qmd.ts, worfy-harness ticket 17): the install
// through npm, the models with their size and the user's consent, node. `npm`, `node` and `qmd` are
// the stand-ins of test/fixtures/qmd-stub in a temporary folder, the only one on the PATH of the "login shell"
// environment handed to the module: links to its shell scripts, on Windows `.cmd` files that run its Node
// ports, as npm leaves `.cmd` files there. Each writes its arguments and the variables it saw. HOME, the
// Harness home and the Claude home are temporary too: nothing reaches the owner's folders. The second
// part runs the qmd scripts of the Harness themselves, as `node <script>`, on a Node stand-in of qmd.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MODELS_ANSWER_FILE,
  QMD_MODELS,
  QMD_VERSION,
  answerModels,
  installQmd,
  modelCacheDir,
  modelPlan,
  qmdState,
  readModelsAnswer,
  setupCollections,
} from '../../src/main/harness/qmd'
import type { SpawnProcess } from '../../src/main/workflow/profile'
import { NODE, NODE_DIR, nodeScript, scriptsEnv } from '../harness-node'
import { removeTestTree } from '../remove'

const REPO = join(import.meta.dirname, '..', '..')
const WINDOWS = process.platform === 'win32'
/** What the module tells the user to run for node. */
const NODE_HINT = WINDOWS ? 'winget install OpenJS.NodeJS.LTS' : 'brew install node'

let root: string
let bin: string
let home: string
let harnessHome: string
let claudeHome: string
let calls: string

/**
 * The stand-in commands: /bin/sh scripts of test/fixtures/qmd-stub that use only shell built-ins, so
 * the PATH needs nothing else. A test links one into `bin` and sets what it answers in `stubVars`,
 * which go into the environment handed to the module. The scripts are the same files in every test:
 * a new executable file per test waits for the macOS check of new files, which timed out under load
 * (worfy-polish ticket 30). On Windows a `<name>.cmd` runs the Node port of the stand-in with the tests' node.
 */
const STUBS = join(import.meta.dirname, '..', 'fixtures', 'qmd-stub')
let stubVars: Record<string, string>
function stub(name: string, vars: Record<string, string>): void {
  if (WINDOWS) {
    writeFileSync(join(bin, `${name}.cmd`), `@"${NODE}" "${join(STUBS, `${name}.mjs`)}" %*\r\n`)
  } else {
    rmSync(join(bin, name), { force: true })
    symlinkSync(join(STUBS, name), join(bin, name))
  }
  Object.assign(stubVars, vars)
}
const nodeStub = (version: string): void => stub('node', { NODE_STUB_VERSION: version })
const qmdStub = (version: string, pullCode = 0): void =>
  stub('qmd', {
    QMD_STUB_VERSION: version,
    QMD_STUB_PULL_CODE: String(pullCode),
    QMD_STUB_GENERATE_DEFAULT: QMD_MODELS.generateDefault.uri,
    QMD_STUB_RERANK: QMD_MODELS.rerank.uri,
  })
const npmStub = (code = 0): void => stub('npm', { NPM_STUB_CODE: String(code) })
const callLines = (): string[] => {
  try {
    return readFileSync(calls, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}
/** A login shell's environment on Windows has SystemRoot: node and cmd.exe need it to start. */
const systemRoot = (): Record<string, string> => (WINDOWS && process.env.SystemRoot !== undefined ? { SystemRoot: process.env.SystemRoot } : {})
/** The login shell environment the module is handed: only the stand-ins on the PATH. */
const env = (): Record<string, string> => ({ ...systemRoot(), PATH: bin, HOME: home, LOGIN_MARK: 'login-shell', CALLS: calls, ...stubVars })
const options = () => ({ harnessHome, claudeHome, env: env() })
const profile = (dir: string, name: string, docs: string | null): void => {
  mkdirSync(join(dir, name), { recursive: true })
  const language = docs === null ? { reports: 'en', team: 'en' } : { reports: 'en', team: 'en', docs }
  writeFileSync(join(dir, name, 'profile.json'), `${JSON.stringify({ schema: 2, name, mode: 'full', language }, null, 2)}\n`)
}
/** Every file under a folder, with its content: what the module left behind. */
const snapshot = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {}
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) walk(path)
      // Keys with `/` on every platform, as the expectations write them.
      else out[path.slice(dir.length).split(sep).join('/')] = readFileSync(path, 'utf8')
    }
  }
  walk(dir)
  return out
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'worfy-qmd-'))
  bin = join(root, 'bin')
  home = join(root, 'home')
  harnessHome = join(home, '.claude', 'worfy-harness')
  claudeHome = join(home, '.claude')
  calls = join(root, 'calls.log')
  stubVars = {}
  for (const dir of [bin, home, harnessHome]) mkdirSync(dir, { recursive: true })
})
afterEach(() => {
  removeTestTree(root)
})

describe('installQmd', () => {
  it('without consent runs nothing at all', async () => {
    nodeStub('v24.19.0')
    npmStub()
    expect(await installQmd({ ...options(), consent: false })).toEqual({ status: 'declined' })
    expect(callLines()).toEqual([])
  })

  it('with consent runs exactly `npm install -g @tobilu/qmd@<QMD_VERSION>` in the login shell environment', async () => {
    nodeStub('v24.19.0')
    npmStub()
    const result = await installQmd({ ...options(), consent: true })
    expect(QMD_VERSION).toBe('2.8.3')
    expect(callLines()).toEqual([`npm install -g @tobilu/qmd@${QMD_VERSION} mark=login-shell`])
    // The stand-in npm put no qmd on the PATH, so the version after the install is unknown.
    expect(result).toEqual({ status: 'installed', version: null })
  })

  it('with qmd of another version on the PATH: a warning with that version, npm is not run', async () => {
    nodeStub('v24.19.0')
    npmStub()
    qmdStub('2.9.1')
    const result = await installQmd({ ...options(), consent: true })
    expect(result).toMatchObject({ status: 'other-version', version: '2.9.1' })
    expect(result.status === 'other-version' && result.warning).toMatch(/qmd 2\.9\.1 .*2\.8\.3/)
    expect(callLines()).toEqual([])
    const state = await qmdState(options())
    expect(state).toMatchObject({ version: 'warn', qmd: { version: '2.9.1', path: join(bin, WINDOWS ? 'qmd.cmd' : 'qmd') } })
    expect(state.warning).toMatch(/2\.9\.1/)
  })

  it('with the pinned qmd already there: nothing to do, npm is not run', async () => {
    nodeStub('v24.19.0')
    npmStub()
    qmdStub(QMD_VERSION)
    expect(await installQmd({ ...options(), consent: true })).toEqual({ status: 'already', version: QMD_VERSION })
    expect(callLines()).toEqual([])
    expect(await qmdState(options())).toMatchObject({ version: 'ok', warning: null })
  })

  it('a failed npm: an error with its exit code and the last line of stderr, and no second attempt', async () => {
    nodeStub('v24.19.0')
    npmStub(243)
    const result = await installQmd({ ...options(), consent: true })
    expect(result).toEqual({
      status: 'failed',
      code: 243,
      stderr: 'npm error code EACCES',
      error: `npm install -g @tobilu/qmd@${QMD_VERSION} exited 243: npm error code EACCES`,
    })
    expect(callLines()).toHaveLength(1)
  })

  it.for<[string, string | null, string]>([
    ['node 20', 'v20.11.1', 'qmd needs node 22.14 or newer, and node is 20.11.1'],
    // better-sqlite3 of qmd 2.8.3 kills every node below 22.14 without a word.
    ['node 22.13', 'v22.13.1', 'qmd needs node 22.14 or newer, and node is 22.13.1'],
    ['no node', null, 'qmd needs node 22.14 or newer, and there is no node'],
  ])('%s: npm is not run, the error names the command that installs node', async ([, version, message]) => {
    if (version !== null) nodeStub(version)
    npmStub()
    const result = await installQmd({ ...options(), consent: true })
    expect(result.status).toBe('no-node')
    expect(result.status === 'no-node' && result.error).toBe(`${message}: install it with \`${NODE_HINT}\``)
    expect(callLines()).toEqual([])
    expect((await qmdState(options())).node.ok).toBe(false)
  })

  it('node 22.14: npm runs', async () => {
    nodeStub('v22.14.0')
    npmStub()
    expect(await installQmd({ ...options(), consent: true })).toEqual({ status: 'installed', version: null })
    expect((await qmdState(options())).node).toEqual({ version: '22.14.0', ok: true })
  })
})

describe('the models', () => {
  const RU = QMD_MODELS.generateRu.uri
  const DEFAULT = QMD_MODELS.generateDefault.uri

  it('the size is the sum of the table, with the Russian model only for a Project with language.docs ru', async () => {
    const projects = join(harnessHome, 'projects')
    profile(projects, 'a', 'en')
    profile(projects, 'b', null)
    let state = await qmdState(options())
    expect(state.models.russian).toBe(false)
    expect(state.models.models.map((model) => model.uri)).toEqual([QMD_MODELS.embed.uri, QMD_MODELS.rerank.uri, DEFAULT])
    expect(state.models.bytes).toBe(QMD_MODELS.embed.bytes + QMD_MODELS.rerank.bytes + QMD_MODELS.generateDefault.bytes)

    // A Profile of the old Harness still counts (the transition).
    profile(join(claudeHome, 'profiles'), 'c', 'ru')
    state = await qmdState(options())
    expect(state.models.russian).toBe(true)
    expect(state.models.models.map((model) => model.uri)).toEqual([QMD_MODELS.embed.uri, QMD_MODELS.rerank.uri, RU])
    expect(state.models.bytes).toBe(639_150_592 + 639_153_184 + 1_107_409_152)
    expect(modelPlan(['ru']).bytes).toBe(2_385_712_928)
    expect(modelPlan([]).bytes).toBe(2_560_742_688)
  })

  it('sees which model files are already in the cache', async () => {
    const cache = join(home, '.cache', 'qmd', 'models')
    mkdirSync(cache, { recursive: true })
    writeFileSync(join(cache, QMD_MODELS.embed.file), '')
    expect((await qmdState(options())).models.present).toEqual([QMD_MODELS.embed.uri])
  })

  it('the cache lies in the home folder qmd takes: HOME, then USERPROFILE, unless XDG_CACHE_HOME says otherwise', () => {
    expect(modelCacheDir({ HOME: join('a', 'home'), USERPROFILE: join('a', 'profile') })).toBe(join('a', 'home', '.cache', 'qmd', 'models'))
    expect(modelCacheDir({ USERPROFILE: join('a', 'profile') })).toBe(join('a', 'profile', '.cache', 'qmd', 'models'))
    expect(modelCacheDir({ XDG_CACHE_HOME: join('a', 'cache'), HOME: join('a', 'home') })).toBe(join('a', 'cache', 'qmd', 'models'))
  })

  it('qmd pull runs only after the consent, with the variables of qmd-mcp, and the answer says downloaded', async () => {
    qmdStub(QMD_VERSION)
    profile(join(harnessHome, 'projects'), 'w', 'ru')
    expect(callLines()).toEqual([])
    expect(await qmdState(options())).toMatchObject({ answer: null })
    const result = await answerModels({ ...options(), download: true })
    expect(result).toEqual({ status: 'downloaded', models: [QMD_MODELS.embed.uri, RU, QMD_MODELS.rerank.uri] })
    expect(callLines()).toEqual([`qmd pull emb=${QMD_MODELS.embed.uri} gen=${RU} mark=login-shell`])
    expect(readFileSync(join(harnessHome, MODELS_ANSWER_FILE), 'utf8')).toBe(`downloaded\n${QMD_MODELS.embed.uri}\n${RU}\n${QMD_MODELS.rerank.uri}\n`)
    expect(readModelsAnswer(harnessHome)).toEqual({ answer: 'downloaded', models: [QMD_MODELS.embed.uri, RU, QMD_MODELS.rerank.uri] })
    expect((await qmdState(options())).answer).toBe('downloaded')
  })

  it('without a Russian Project qmd pull gets no QMD_GENERATE_MODEL: the default expansion model', async () => {
    qmdStub(QMD_VERSION)
    await answerModels({ ...options(), env: { ...env(), QMD_GENERATE_MODEL: 'from-the-shell' }, download: true })
    expect(callLines()).toEqual([`qmd pull emb=${QMD_MODELS.embed.uri} gen=unset mark=login-shell`])
  })

  it('the answer lists the models qmd pull reported: a model pinned in index.yml wins over the plan', async () => {
    qmdStub(QMD_VERSION)
    profile(join(harnessHome, 'projects'), 'w', 'ru')
    const result = await answerModels({ ...options(), env: { ...env(), PULLED_GENERATE: DEFAULT }, download: true })
    expect(result).toEqual({ status: 'downloaded', models: [QMD_MODELS.embed.uri, DEFAULT, QMD_MODELS.rerank.uri] })
    expect(readModelsAnswer(harnessHome)?.models).toEqual([QMD_MODELS.embed.uri, DEFAULT, QMD_MODELS.rerank.uri])
  })

  it('skipping writes skipped and runs nothing', async () => {
    qmdStub(QMD_VERSION)
    const before = snapshot(home)
    expect(await answerModels({ ...options(), download: false })).toEqual({ status: 'skipped' })
    expect(callLines()).toEqual([])
    expect(readFileSync(join(harnessHome, MODELS_ANSWER_FILE), 'utf8')).toBe('skipped\n')
    expect(readModelsAnswer(harnessHome)).toEqual({ answer: 'skipped', models: [] })
    // The answer file is the only thing written.
    expect(Object.keys(snapshot(home)).filter((path) => !(path in before))).toEqual([`/.claude/worfy-harness/${MODELS_ANSWER_FILE}`])
  })

  it('a failed qmd pull writes no answer: the server stays off', async () => {
    qmdStub(QMD_VERSION, 3)
    const result = await answerModels({ ...options(), download: true })
    expect(result).toMatchObject({ status: 'failed', code: 3, stderr: 'pull: network down' })
    expect(readModelsAnswer(harnessHome)).toBeNull()
  })

  it('with no qmd the consent downloads nothing and writes nothing', async () => {
    expect(await answerModels({ ...options(), download: true })).toEqual({ status: 'no-qmd' })
    expect(readModelsAnswer(harnessHome)).toBeNull()
  })

  it('the model URIs and the answer file are the ones the Harness scripts use', () => {
    const shared = readFileSync(join(REPO, 'harness', 'hooks', 'qmd-common.cjs'), 'utf8')
    expect(shared).toContain(`EMBED_MODEL = "${QMD_MODELS.embed.uri}"`)
    expect(shared).toContain(`RU_GENERATE_MODEL = "${RU}"`)
    expect(shared).toContain(`DEFAULT_GENERATE_MODEL = "${DEFAULT}"`)
    expect(shared).toContain(`path.join(harnessHome(), "${MODELS_ANSWER_FILE}")`)
  })
})

// The behaviour of worfy-harness ticket 17 on the Node version of the scripts (worfy-windows ticket 15).
describe('the qmd scripts of the Harness, as Claude Code starts them', () => {
  const HARNESS = join(REPO, 'harness')
  const EMBED = QMD_MODELS.embed.uri
  const RU = QMD_MODELS.generateRu.uri
  let tools: string

  beforeEach(() => {
    tools = join(root, 'wrapper-bin')
    mkdirSync(tools)
    // Node scripts named as the real ones: qmd-mcp finds `qmd` on the PATH and starts it with its own node.
    writeFileSync(
      join(tools, 'qmd'),
      `#!/usr/bin/env node\nconst e = process.env\nrequire("fs").appendFileSync(e.CALLS, process.argv[2] + " gen=" + (e.QMD_GENERATE_MODEL || "unset") + " emb=" + (e.QMD_EMBED_MODEL || "unset") + "\\n")\n`,
      { mode: 0o755 },
    )
    writeFileSync(join(root, 'profile'), '#!/usr/bin/env node\nconsole.log(process.env.LANG_DOCS)\n')
  })

  /** `node harness/bin/qmd-mcp`, stdin closed at once, with the versions and answers a case sets. */
  const qmdMcp = (vars: Record<string, string> = {}) =>
    spawnSync(NODE, [join(HARNESS, 'bin', 'qmd-mcp')], {
      cwd: root,
      encoding: 'utf8',
      input: '',
      env: {
        ...systemRoot(),
        PATH: [tools, NODE_DIR].join(delimiter),
        HOME: home,
        HARNESS_HOME: harnessHome,
        CALLS: calls,
        QMD_MCP_NO_REFRESH: '1',
        QMD_MCP_PROFILE_BIN: join(root, 'profile'),
        QMD_NPM_PREFIX: join(root, 'no-npm-prefix'),
        // The check of the version is its own case: the others do not depend on the node of the machine.
        QMD_NODE_VERSION: '24.0.0',
        LANG_DOCS: 'en',
        ...vars,
      },
    })
  const answer = (text: string): void => writeFileSync(join(harnessHome, MODELS_ANSWER_FILE), text)

  it.for<[string, string | null]>([
    ['no answer', null],
    ['the answer "skipped"', 'skipped\n'],
  ])('qmd-mcp with %s: exit code 3, one stderr line that names the grep fallback, and no `qmd mcp`', ([, text]) => {
    if (text !== null) answer(text)
    const run = qmdMcp()
    expect(run.status).toBe(3)
    expect(run.stderr.trimEnd().split('\n')).toHaveLength(1)
    expect(run.stderr).toContain("search with grep over the profile's qmd.fallback_grep")
    expect(callLines()).toEqual([])
  })

  it('qmd-mcp with language.docs ru: the Russian query expansion model', () => {
    answer('downloaded\n')
    const run = qmdMcp({ LANG_DOCS: 'ru' })
    expect(run.status, run.stderr).toBe(0)
    expect(callLines()).toEqual([`mcp gen=${RU} emb=${EMBED}`])
  })

  it('qmd-mcp with another language: the default query expansion model of qmd', () => {
    answer('downloaded\n')
    const run = qmdMcp()
    expect(run.status, run.stderr).toBe(0)
    expect(callLines()).toEqual([`mcp gen=unset emb=${EMBED}`])
  })

  it('qmd-mcp on node 22.13: exit code 3, one line that says why, and qmd does not start, because it would die without a word', () => {
    answer('downloaded\n')
    const run = qmdMcp({ QMD_NODE_VERSION: '22.13.1' })
    expect(run.status).toBe(3)
    expect(run.stderr.trimEnd().split('\n')).toHaveLength(1)
    expect(run.stderr).toMatch(/22\.13\.1 is older than 22\.14\.0.*qmd\.fallback_grep/)
    expect(callLines()).toEqual([])
  })

  it('.mcp.json and the Stop hook start the scripts through node, not by their first line', () => {
    const mcp = JSON.parse(readFileSync(join(HARNESS, '.mcp.json'), 'utf8')) as { mcpServers: Record<string, unknown> }
    expect(mcp.mcpServers.qmd).toEqual({ command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp'] })
    const hooks = JSON.parse(readFileSync(join(HARNESS, 'hooks', 'hooks.json'), 'utf8')) as { hooks: { Stop: { hooks: { command: string }[] }[] } }
    expect(hooks.hooks.Stop.flatMap((group) => group.hooks.map((hook) => hook.command))).toContain('node "${CLAUDE_PLUGIN_ROOT}/bin/qmd-refresh" --quiet')
  })
})

describe('setupCollections', () => {
  // worfy-windows ticket 30: Windows does not run the file by its `#!` line; the script goes through
  // the launcher of every Harness script, as `node <script> <project>`.
  it('starts the Node script as node <script> <project>, node from the PATH of the login shell', async () => {
    const scripts = join(root, 'harness-bin')
    mkdirSync(scripts)
    // A Node stand-in, not executable: only `node <file>` runs it.
    writeFileSync(join(scripts, 'qmd-collections'), nodeScript("process.stdout.write(`args=${process.argv.slice(2).join(' ')} mark=${process.env.LOGIN_MARK} hh=${process.env.HARNESS_HOME}\\n`)"))
    const started: { command: string; args: string[] }[] = []
    const spawnRecording: SpawnProcess = (command, args, spawnOptions) => {
      started.push({ command, args: [...args] })
      return spawn(command, args, spawnOptions)
    }
    const result = await setupCollections({ harnessHome, claudeHome, env: scriptsEnv([NODE_DIR], { HOME: home, LOGIN_MARK: 'login-shell' }), binDir: scripts, project: 'worfy', spawn: spawnRecording })
    expect(started).toEqual([{ command: NODE, args: [join(scripts, 'qmd-collections'), 'worfy'] }])
    expect(result).toEqual({ code: 0, output: `args=worfy mark=login-shell hh=${harnessHome}\n` })
  })

  it('no node on the PATH: nothing starts, code null and the reason', async () => {
    const scripts = join(root, 'harness-bin')
    mkdirSync(scripts)
    writeFileSync(join(scripts, 'qmd-collections'), nodeScript('process.exitCode = 0'))
    const result = await setupCollections({ harnessHome, claudeHome, env: scriptsEnv([bin], { HOME: home }), binDir: scripts, project: 'worfy' })
    expect(result).toEqual({ code: null, output: `node not found in PATH: ${join(scripts, 'qmd-collections')} is not run` })
  })
})
