// qmd as part of the Harness (src/main/harness/qmd.ts, worfy-harness ticket 17): the install
// through npm, the models with their size and the user's consent, node. `npm`, `node` and `qmd` are
// stand-in shell scripts in a temporary folder, the only one on the PATH of the "login shell"
// environment handed to the module; each writes its arguments and the variables it saw. HOME, the
// Harness home and the Claude home are temporary too: nothing reaches the owner's folders.
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MODELS_ANSWER_FILE,
  QMD_MODELS,
  QMD_VERSION,
  answerModels,
  installQmd,
  modelPlan,
  qmdState,
  readModelsAnswer,
  setupCollections,
} from '../../src/main/harness/qmd'
import { removeTestTree } from '../remove'

const REPO = join(import.meta.dirname, '..', '..')

let root: string
let bin: string
let home: string
let harnessHome: string
let claudeHome: string
let calls: string

/** A stand-in command: a /bin/sh script that uses only shell built-ins, so the PATH needs nothing else. */
function stub(name: string, body: string): void {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`)
  chmodSync(join(bin, name), 0o755)
}
const nodeStub = (version: string): void => stub('node', `printf '%s\\n' '${version}'`)
const qmdStub = (version: string, pullCode = 0): void =>
  stub(
    'qmd',
    [
      `if [ "$1" = --version ]; then printf 'qmd %s (abc1234)\\n' '${version}'; exit 0; fi`,
      `printf 'qmd %s emb=%s gen=%s mark=%s\\n' "$*" "$QMD_EMBED_MODEL" "\${QMD_GENERATE_MODEL:-unset}" "$LOGIN_MARK" >>"$CALLS"`,
      `[ ${pullCode} -eq 0 ] || { printf 'first\\npull: network down\\n' >&2; exit ${pullCode}; }`,
      // What qmd 2.8.3 prints per model; PULLED_GENERATE stands for a model pinned in index.yml.
      `[ "$1" = pull ] || exit 0`,
      `printf '\\033[1mPulling models\\033[0m\\n'`,
      `printf '%s\\n' "- $QMD_EMBED_MODEL -> /cache/a.gguf (610 MB, cached/checked)"`,
      `printf '%s\\n' "- \${PULLED_GENERATE:-\${QMD_GENERATE_MODEL:-${QMD_MODELS.generateDefault.uri}}} -> /cache/b.gguf (1 GB, refreshed)"`,
      `printf '%s\\n' '- ${QMD_MODELS.rerank.uri} -> /cache/c.gguf (610 MB, cached/checked)'`,
    ].join('\n'),
  )
const npmStub = (code = 0): void =>
  stub(
    'npm',
    [
      `printf 'npm %s mark=%s\\n' "$*" "$LOGIN_MARK" >>"$CALLS"`,
      `[ ${code} -eq 0 ] || { printf 'npm warn something\\nnpm error code EACCES\\n' >&2; exit ${code}; }`,
    ].join('\n'),
  )
const callLines = (): string[] => {
  try {
    return readFileSync(calls, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}
/** The login shell environment the module is handed: only the stand-ins on the PATH. */
const env = (): Record<string, string> => ({ PATH: bin, HOME: home, LOGIN_MARK: 'login-shell', CALLS: calls })
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
      else out[path.slice(dir.length)] = readFileSync(path, 'utf8')
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
    expect(state).toMatchObject({ version: 'warn', qmd: { version: '2.9.1', path: join(bin, 'qmd') } })
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

  it.each([
    ['node 20', 'v20.11.1', /node is 20\.11\.1.*brew install node/],
    ['no node', null, /there is no node.*brew install node/],
  ])('%s: npm is not run, the error names brew install node', async (_case, version, message) => {
    if (version !== null) nodeStub(version)
    npmStub()
    const result = await installQmd({ ...options(), consent: true })
    expect(result.status).toBe('no-node')
    expect(result.status === 'no-node' && result.error).toMatch(message)
    expect(callLines()).toEqual([])
    expect((await qmdState(options())).node.ok).toBe(false)
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

  it('the model URIs are the ones the Harness scripts set', () => {
    const script = (name: string): string => readFileSync(join(REPO, 'harness', 'bin', name), 'utf8')
    const mcp = script('qmd-mcp')
    expect(mcp).toContain(`EMBED_MODEL="${QMD_MODELS.embed.uri}"`)
    expect(mcp).toContain(`RU_GENERATE_MODEL="${RU}"`)
    expect(mcp).toContain(`DEFAULT_GENERATE_MODEL="${DEFAULT}"`)
    expect(mcp).toContain(`ANSWER_FILE="$HARNESS_HOME/${MODELS_ANSWER_FILE}"`)
    expect(script('qmd-refresh')).toContain(`QMD_EMBED_MODEL="${QMD_MODELS.embed.uri}"`)
    expect(script('qmd-collections')).toContain(`EMBED_MODEL = "${QMD_MODELS.embed.uri}"`)
  })
})

describe('setupCollections', () => {
  it('runs bin/qmd-collections <project> with the login shell environment and HARNESS_HOME', async () => {
    const scripts = join(root, 'harness-bin')
    mkdirSync(scripts)
    writeFileSync(join(scripts, 'qmd-collections'), `#!/bin/sh\nprintf 'args=%s mark=%s hh=%s\\n' "$*" "$LOGIN_MARK" "$HARNESS_HOME"\nexit 0\n`)
    chmodSync(join(scripts, 'qmd-collections'), 0o755)
    const result = await setupCollections({ ...options(), binDir: scripts, project: 'worfy' })
    expect(result).toEqual({ code: 0, output: `args=worfy mark=login-shell hh=${harnessHome}\n` })
  })
})
