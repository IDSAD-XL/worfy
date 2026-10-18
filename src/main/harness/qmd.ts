// qmd as part of the Harness (worfy-harness ticket 17; ADR-0043): what is on the machine, the
// install through npm, the models with their size and the user's consent, and the collections of a
// Project. The buttons and the confirmation are the first-run screen's (ticket 19); this module
// only reads, and writes or runs something only when the call carries the user's answer.
//
// - The state: `qmd` on the PATH of the login shell (ADR-0007, src/main/agent/env.ts) and its
//   version, node (qmd needs 22 or newer), which models are in qmd's cache, and the answer the user
//   gave about the models.
// - installQmd: `npm install -g @tobilu/qmd@<QMD_VERSION>` in the login shell environment, only with
//   `consent: true`. The version is pinned: the Harness scripts rely on the behaviour of this one
//   (qmd-refresh reads index.yml itself; qmd-mcp sets the query expansion model through the
//   environment, because 2.8.3 does not read `generate:` from index.yml). A newer qmd comes as a PR
//   to harness/ together with a check of the scripts; another version on the PATH is a warning, and
//   nothing reinstalls it by itself. No node or one older than 22 — npm is not run, the answer
//   names `brew install node`: worfy installs nothing of the system (Q22).
// - The models: the list and its size before the consent, from the table below (QMD_MODELS, the
//   sizes of the files in the owner's ~/.cache/qmd/models on 2026-10-08). The Russian query
//   expansion model replaces the default one when any Project writes its documents in Russian
//   (`language.docs: ru`). The consent runs `qmd pull` with the model variables qmd-mcp sets, and
//   writes the answer to <harnessHome>/qmd-models (MODELS_ANSWER_FILE): `downloaded` and the model
//   URIs `qmd pull` reported, or `skipped`. Without `downloaded` qmd-mcp does not start the server, otherwise qmd would
//   download the models itself on the first query.
// - setupCollections runs the Harness script `bin/qmd-collections <project>` as `node <script>`
//   (src/main/workflow/profile.ts, runHarnessScript): the three collections of a Project in the
//   global index and their names in its Profile.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { agentEnv } from '../agent/env'
import { runHarnessScript, type SpawnProcess } from '../workflow/profile'

type Env = Readonly<Record<string, string | undefined>>

/** The npm package of qmd. */
export const QMD_PACKAGE = '@tobilu/qmd'
/** The qmd version the Harness scripts are checked with (ticket 17 pins it; ADR-0043 left the choice to it). */
export const QMD_VERSION = '2.8.3'
/** qmd 2.8.3 declares `engines.node >= 22`. */
export const MIN_NODE_MAJOR = 22
/** What the user runs when node is missing or too old: worfy does not install it. */
export const NODE_INSTALL_HINT = 'brew install node'
/** The answer about the models, in the Harness home; qmd-mcp, qmd-refresh and qmd-collections read it. */
export const MODELS_ANSWER_FILE = 'qmd-models'

export type QmdModelRole = 'embed' | 'rerank' | 'generate'

export interface QmdModel {
  role: QmdModelRole
  /** What qmd-mcp passes to qmd (QMD_EMBED_MODEL, QMD_GENERATE_MODEL) or qmd's own default. */
  uri: string
  /** The file name qmd gives it in its model cache. */
  file: string
  bytes: number
}

/**
 * The models qmd-mcp runs with. The URIs are also in harness/bin/qmd-mcp (and the embedding one in
 * qmd-refresh and qmd-collections); test/contract/harness-qmd.test.ts checks they agree.
 */
export const QMD_MODELS = Object.freeze({
  embed: {
    role: 'embed',
    uri: 'hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf',
    file: 'hf_Qwen_Qwen3-Embedding-0.6B-Q8_0.gguf',
    bytes: 639_150_592,
  },
  rerank: {
    role: 'rerank',
    uri: 'hf:ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/qwen3-reranker-0.6b-q8_0.gguf',
    file: 'hf_ggml-org_qwen3-reranker-0.6b-q8_0.gguf',
    bytes: 639_153_184,
  },
  generateRu: {
    role: 'generate',
    uri: 'hf:AGmind/qmd-query-expansion-ru/qmd-query-expansion-ru-q4_k_m.gguf',
    file: 'hf_AGmind_qmd-query-expansion-ru_qmd-query-expansion-ru-q4_k_m.gguf',
    bytes: 1_107_409_152,
  },
  generateDefault: {
    role: 'generate',
    uri: 'hf:tobil/qmd-query-expansion-1.7B-gguf/qmd-query-expansion-1.7B-q4_k_m.gguf',
    file: 'hf_tobil_qmd-query-expansion-1.7B-q4_k_m.gguf',
    bytes: 1_282_438_912,
  },
} satisfies Record<string, QmdModel>)

export interface ModelPlan {
  models: QmdModel[]
  /** The sum of the models' sizes. */
  bytes: number
  /** Whether the Russian query expansion model is in the list. */
  russian: boolean
}

/** The models to download for Projects whose documents are in these languages (`language.docs`). */
export function modelPlan(docsLanguages: readonly (string | null | undefined)[]): ModelPlan {
  const russian = docsLanguages.includes('ru')
  const models: QmdModel[] = [QMD_MODELS.embed, QMD_MODELS.rerank, russian ? QMD_MODELS.generateRu : QMD_MODELS.generateDefault]
  return { models, bytes: models.reduce((sum, model) => sum + model.bytes, 0), russian }
}

/** The environment of `qmd pull` and of the server: the variables qmd-mcp sets for this plan. */
export function modelEnv(plan: ModelPlan, env: Env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env, QMD_EMBED_MODEL: QMD_MODELS.embed.uri }
  if (plan.russian) out.QMD_GENERATE_MODEL = QMD_MODELS.generateRu.uri
  else delete out.QMD_GENERATE_MODEL
  return out
}

/** Where `<harnessHome>/projects/<name>/profile.json` and, during the transition, `<claudeHome>/profiles/<name>/profile.json` lie. */
export interface QmdHomes {
  harnessHome: string
  claudeHome: string
}

/**
 * `language.docs` of every Profile on the machine, read straight from profile.json: the list is
 * about the machine, not about one folder, so `bin/profile -C` has nothing to resolve. A Profile
 * that cannot be read gives no language.
 */
export function profileDocsLanguages(homes: QmdHomes): string[] {
  const languages: string[] = []
  for (const root of [join(homes.harnessHome, 'projects'), join(homes.claudeHome, 'profiles')]) {
    let names: string[]
    try {
      names = readdirSync(root)
    } catch {
      continue
    }
    for (const name of names) {
      try {
        const profile = JSON.parse(readFileSync(join(root, name, 'profile.json'), 'utf8')) as { language?: { docs?: unknown } }
        if (typeof profile.language?.docs === 'string') languages.push(profile.language.docs)
      } catch {
        // no profile.json or a broken one: no language from it
      }
    }
  }
  return languages
}

/** qmd's model cache: $XDG_CACHE_HOME/qmd/models, or ~/.cache/qmd/models. */
export function modelCacheDir(env: Env): string {
  return env.XDG_CACHE_HOME ? join(env.XDG_CACHE_HOME, 'qmd', 'models') : join(env.HOME ?? '', '.cache', 'qmd', 'models')
}

export type ModelsAnswer = 'downloaded' | 'skipped'

/** The answer file: null when there is none or its first line is neither answer. */
export function readModelsAnswer(harnessHome: string): { answer: ModelsAnswer; models: string[] } | null {
  let lines: string[]
  try {
    lines = readFileSync(join(harnessHome, MODELS_ANSWER_FILE), 'utf8').split('\n')
  } catch {
    return null
  }
  const answer = lines[0]
  if (answer !== 'downloaded' && answer !== 'skipped') return null
  return { answer, models: lines.slice(1).filter((line) => line.startsWith('hf:')) }
}

function writeModelsAnswer(harnessHome: string, answer: ModelsAnswer, models: readonly string[]): void {
  mkdirSync(harnessHome, { recursive: true })
  const file = join(harnessHome, MODELS_ANSWER_FILE)
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, [answer, ...models, ''].join('\n'))
  renameSync(tmp, file)
}

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  /** The command is not on the PATH (or not executable). */
  missing: boolean
}

const MAX_OUTPUT = 1024 * 1024

/** Runs a command with `env`, the PATH of `env` finding it. Never rejects. */
function runCommand(command: string, args: readonly string[], env: Env, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(command, args, { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8')
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: stderr || error.message, missing: error.code === 'ENOENT' || error.code === 'EACCES' })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, missing: false })
    })
  })
}

const lastLine = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .at(-1) ?? ''

/** The first executable `name` on the PATH of `env`. */
function onPath(name: string, env: Env): string | null {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // not in this folder
    }
  }
  return null
}

const SHORT_TIMEOUT_MS = 15_000
const NPM_TIMEOUT_MS = 10 * 60_000
const PULL_TIMEOUT_MS = 2 * 60 * 60_000
const COLLECTIONS_TIMEOUT_MS = 30 * 60_000

export interface QmdOptions extends QmdHomes {
  /** The login shell environment; agentEnv() when absent. */
  env?: Env
}

const loginEnv = async (options: QmdOptions): Promise<Env> => options.env ?? (await agentEnv()).env

export interface NodeState {
  /** `node --version` without the `v`; null when there is no node. */
  version: string | null
  ok: boolean
}

async function nodeState(env: Env): Promise<NodeState> {
  const run = await runCommand('node', ['--version'], env, SHORT_TIMEOUT_MS)
  const match = /v?(\d+)\.(\d+)\.(\d+)/.exec(run.stdout)
  if (run.code !== 0 || !match) return { version: null, ok: false }
  return { version: `${match[1]}.${match[2]}.${match[3]}`, ok: Number(match[1]) >= MIN_NODE_MAJOR }
}

export interface QmdBinaryState {
  path: string
  /** The version `qmd --version` prints; null when it printed none. */
  version: string | null
}

async function qmdBinary(env: Env): Promise<QmdBinaryState | null> {
  const path = onPath('qmd', env)
  if (path === null) return null
  const run = await runCommand(path, ['--version'], env, SHORT_TIMEOUT_MS)
  return { path, version: /(\d+\.\d+\.\d+)/.exec(run.stdout)?.[1] ?? null }
}

const otherVersionWarning = (qmd: QmdBinaryState): string =>
  `qmd ${qmd.version ?? '(unknown version)'} is on the PATH (${qmd.path}); the Harness is checked with ${QMD_VERSION} and does not reinstall it by itself`

export interface QmdState {
  qmd: QmdBinaryState | null
  /** `ok` — the pinned version; `warn` — another one (see `warning`); `missing` — no qmd on the PATH. */
  version: 'ok' | 'warn' | 'missing'
  warning: string | null
  node: NodeState
  /** What would be downloaded, and which of those files are already in qmd's cache. */
  models: ModelPlan & { present: string[] }
  answer: ModelsAnswer | null
}

/** What is on the machine. Runs `node --version` and `qmd --version`, writes nothing. */
export async function qmdState(options: QmdOptions): Promise<QmdState> {
  const env = await loginEnv(options)
  const [qmd, node] = await Promise.all([qmdBinary(env), nodeState(env)])
  const plan = modelPlan(profileDocsLanguages(options))
  const cache = modelCacheDir(env)
  const present = plan.models.filter((model) => existsSync(join(cache, model.file))).map((model) => model.uri)
  const version = qmd === null ? 'missing' : qmd.version === QMD_VERSION ? 'ok' : 'warn'
  return {
    qmd,
    version,
    warning: version === 'warn' && qmd !== null ? otherVersionWarning(qmd) : null,
    node,
    models: { ...plan, present },
    answer: readModelsAnswer(options.harnessHome)?.answer ?? null,
  }
}

export type InstallResult =
  | { status: 'declined' }
  | { status: 'installed'; version: string | null }
  | { status: 'already'; version: string }
  | { status: 'other-version'; version: string | null; warning: string }
  | { status: 'no-node'; error: string }
  | { status: 'failed'; code: number | null; stderr: string; error: string }

/**
 * `npm install -g @tobilu/qmd@<QMD_VERSION>` in the login shell environment. Without `consent: true`
 * it runs nothing. With qmd already on the PATH it does not run npm either: the pinned version is
 * `already`, another one is `other-version` with the warning. One attempt: a failed npm is an error
 * with its exit code and the last line of its stderr.
 */
export async function installQmd(options: QmdOptions & { consent: boolean }): Promise<InstallResult> {
  if (options.consent !== true) return { status: 'declined' }
  const env = await loginEnv(options)
  const node = await nodeState(env)
  if (!node.ok) {
    const found = node.version === null ? 'there is no node' : `node is ${node.version}`
    return { status: 'no-node', error: `qmd needs node ${MIN_NODE_MAJOR} or newer, and ${found}: install it with \`${NODE_INSTALL_HINT}\`` }
  }
  const present = await qmdBinary(env)
  if (present !== null) {
    if (present.version === QMD_VERSION) return { status: 'already', version: QMD_VERSION }
    return { status: 'other-version', version: present.version, warning: otherVersionWarning(present) }
  }
  const run = await runCommand('npm', ['install', '-g', `${QMD_PACKAGE}@${QMD_VERSION}`], env, NPM_TIMEOUT_MS)
  if (run.code !== 0) {
    const stderr = lastLine(run.stderr)
    return { status: 'failed', code: run.code, stderr, error: `npm install -g ${QMD_PACKAGE}@${QMD_VERSION} exited ${String(run.code)}: ${stderr}` }
  }
  return { status: 'installed', version: (await qmdBinary(env))?.version ?? null }
}

export type ModelsResult =
  | { status: 'downloaded'; models: string[] }
  | { status: 'skipped' }
  | { status: 'no-qmd' }
  | { status: 'failed'; code: number | null; stderr: string; error: string }

/**
 * The user's answer about the models. `download: true` runs `qmd pull` with the variables of
 * qmd-mcp and, once it exits 0, writes `downloaded` with the models; a failed pull writes nothing.
 * `download: false` writes `skipped` and runs nothing.
 */
export async function answerModels(options: QmdOptions & { download: boolean }): Promise<ModelsResult> {
  const plan = modelPlan(profileDocsLanguages(options))
  if (options.download !== true) {
    writeModelsAnswer(options.harnessHome, 'skipped', [])
    return { status: 'skipped' }
  }
  const env = await loginEnv(options)
  const qmd = onPath('qmd', env)
  if (qmd === null) return { status: 'no-qmd' }
  const run = await runCommand(qmd, ['pull'], modelEnv(plan, env), PULL_TIMEOUT_MS)
  if (run.code !== 0) {
    const stderr = lastLine(run.stderr)
    return { status: 'failed', code: run.code, stderr, error: `qmd pull exited ${String(run.code)}: ${stderr}` }
  }
  const pulled = pulledModels(run.stdout)
  const models = pulled.length > 0 ? pulled : plan.models.map((model) => model.uri)
  writeModelsAnswer(options.harnessHome, 'downloaded', models)
  return { status: 'downloaded', models }
}

/**
 * The models `qmd pull` reports (`- <uri> -> <file> (<size>, …)`, qmd 2.8.3). They can differ from
 * the plan: the first qmd command on a machine writes the models it resolved into index.yml, and
 * those win over the environment. The answer lists what is really on disk, so qmd-mcp picks among
 * those and qmd never downloads one by itself.
 */
export function pulledModels(stdout: string): string[] {
  const plain = stdout.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
  return [...plain.matchAll(/^- (hf:\S+) -> /gm)].map((match) => match[1] ?? '').filter((uri) => uri !== '')
}

export interface CollectionsResult {
  code: number | null
  /** The script's output, stdout then stderr. */
  output: string
}

/**
 * `<binDir>/qmd-collections <project>` (the Harness script) with the login shell environment and
 * HARNESS_HOME: the Project's collections in the global qmd index, their names in its Profile. It
 * starts as every Harness script does, `node <script> <project>` (runHarnessScript, worfy-windows
 * ticket 30): Windows does not run the file by its `#!` line. A script that could not be started
 * gives code null and the reason as its output.
 */
export async function setupCollections(options: QmdOptions & { binDir: string; project: string; spawn?: SpawnProcess }): Promise<CollectionsResult> {
  const env = await loginEnv(options)
  try {
    const run = await runHarnessScript(join(options.binDir, 'qmd-collections'), [options.project], { ...env, HARNESS_HOME: options.harnessHome }, { timeoutMs: COLLECTIONS_TIMEOUT_MS, spawn: options.spawn })
    return { code: run.code, output: `${run.stdout}${run.stderr}` }
  } catch (error) {
    return { code: null, output: error instanceof Error ? error.message : String(error) }
  }
}
