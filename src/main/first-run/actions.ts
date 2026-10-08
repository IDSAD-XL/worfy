// The actions of the first-run screen (worfy-harness ticket 19, question Q22): each one is run only
// after a dialog that names what it will do — the command, the folder, the download — and the
// user's "Confirm". Nothing runs by itself at start. After an action the checks run again; a failed
// action makes the row of its check `fail` with the action's error, until the next attempt.
//
// The work itself is the functions of earlier tickets, called and not changed: the Harness
// installer (src/main/harness/install.ts, ticket 13), qmd, its models and collections
// (src/main/harness/qmd.ts, ticket 17). The move of the old Harness (ticket 14) is not here: the
// screen opens its form, which asks on its own. `gh-login` is only confirmed here; the screen types
// `gh auth login` into a Terminal Node, where the user signs in.
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { confirmationText, type InstallOutcome, type InstallPlan } from '../harness/install'
import {
  answerModels,
  installQmd,
  MODELS_ANSWER_FILE,
  modelCacheDir,
  modelPlan,
  profileDocsLanguages,
  QMD_MODELS,
  QMD_PACKAGE,
  QMD_VERSION,
  setupCollections,
  type QmdHomes,
} from '../harness/qmd'
import type { HarnessStatus } from '../../shared/ipc/harness'
import type { CheckId, FirstRunAction, FirstRunReport } from '../../shared/ipc/first-run'
import { formatBytes, type Env, type ProjectProfile } from './checks'

/** What the dialog shows; its buttons are "Confirm" and "Cancel". */
export interface Confirmation {
  message: string
  detail: string
}

export type RunnableAction = Exclude<FirstRunAction, 'migration-form'>

export interface ActionDeps {
  /** Runs every check (runChecks with the app's dependencies). */
  checks: () => Promise<FirstRunReport>
  /** The dialog: true only for "Confirm". */
  confirm: (confirmation: Confirmation) => Promise<boolean>
  /** The login shell environment, where npm and qmd run. */
  env: () => Promise<Env>
  homes: QmdHomes
  /** The installer of ticket 13: shows `confirm` its plan before it writes anything. */
  installHarness: (confirm: (plan: InstallPlan) => Promise<boolean>) => Promise<{ outcome: InstallOutcome; status: HarnessStatus }>
  /** The connected Projects with their Profiles. */
  projects: () => Promise<readonly ProjectProfile[]>
  /** The Harness plugin's scripts: <harnessHome>/plugin/bin. */
  binDir: string
}

export interface ActionResult {
  outcome: 'done' | 'declined' | 'failed' | 'confirmed'
  message: string | null
  report: FirstRunReport
}

/** The check whose row shows an action's failure. */
const CHECK_OF: Record<RunnableAction, CheckId> = {
  'harness-install': 'harness',
  'qmd-install': 'qmd',
  'qmd-models-download': 'qmd-models',
  'qmd-models-skip': 'qmd-models',
  'qmd-collections': 'qmd-collections',
  'gh-login': 'gh-auth',
}

type Outcome = { outcome: ActionResult['outcome']; message: string | null }
const declined: Outcome = { outcome: 'declined', message: null }
const done = (message: string | null = null): Outcome => ({ outcome: 'done', message })
const failed = (message: string): Outcome => ({ outcome: 'failed', message })

/** `npm prefix -g`: where `npm install -g` puts qmd. Read only; null when npm does not answer. */
function npmPrefix(env: Env): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('npm', ['prefix', '-g'], { env: env as NodeJS.ProcessEnv, timeout: 15_000, encoding: 'utf8' }, (error, stdout) => {
      resolve(error ? null : stdout.trim() || null)
    })
  })
}

const tail = (text: string, lines = 5): string =>
  text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .slice(-lines)
    .join('\n')

export class FirstRunActions {
  /** The last failure of each check's action, shown in its row until the next attempt. */
  private readonly failures = new Map<CheckId, string>()
  private running = false
  private last: FirstRunReport | null = null

  constructor(private readonly deps: ActionDeps) {}

  /** The checks, with the failures of the last actions on their rows. */
  async report(): Promise<FirstRunReport> {
    const report = await this.deps.checks()
    this.last = {
      ...report,
      checks: report.checks.map((check) => {
        const failure = this.failures.get(check.id)
        return failure === undefined ? check : { ...check, status: 'fail', hint: `The last attempt failed: ${failure}` }
      }),
    }
    return this.last
  }

  /** Runs one action after its dialog; one at a time. */
  async run(action: RunnableAction, context: { projectName?: string | undefined } = {}): Promise<ActionResult> {
    if (this.running) throw new Error('another action is running: wait for it to finish')
    this.running = true
    try {
      const result = await this.perform(action, context)
      if (result.outcome === 'failed') this.failures.set(CHECK_OF[action], result.message ?? 'failed')
      else if (result.outcome !== 'declined') this.failures.delete(CHECK_OF[action])
      // A confirmed gh-login goes on in the Terminal: checking now would only delay it, so the
      // screen keeps the last checks and the user checks again when signed in.
      const report = result.outcome === 'confirmed' && this.last !== null ? this.last : await this.report()
      return { ...result, report }
    } finally {
      this.running = false
    }
  }

  private async perform(action: RunnableAction, context: { projectName?: string | undefined }): Promise<Outcome> {
    switch (action) {
      case 'harness-install':
        return this.installHarness()
      case 'qmd-install':
        return this.installQmd()
      case 'qmd-models-download':
        return this.downloadModels()
      case 'qmd-models-skip':
        return this.skipModels()
      case 'qmd-collections':
        return this.setupCollections()
      case 'gh-login':
        return this.ghLogin(context.projectName)
    }
  }

  private async installHarness(): Promise<Outcome> {
    let result: { outcome: InstallOutcome; status: HarnessStatus }
    try {
      result = await this.deps.installHarness((plan) => {
        const text = confirmationText(plan)
        return this.deps.confirm({ message: text.message, detail: `${text.detail}\n\nNothing is downloaded: the copy comes from this build.` })
      })
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error))
    }
    if (result.outcome === 'declined') return declined
    const { state } = result.status
    if (state.kind === 'error') return failed(`${state.step}: ${tail(state.reason)}`)
    return done(result.outcome === 'nothing-to-do' ? 'The Harness of this build is already installed' : null)
  }

  private async installQmd(): Promise<Outcome> {
    const env = await this.deps.env()
    const prefix = await npmPrefix(env)
    const confirmed = await this.deps.confirm({
      message: `Install qmd ${QMD_VERSION}?`,
      detail: [
        'worfy runs in your login shell:',
        `  npm install -g ${QMD_PACKAGE}@${QMD_VERSION}`,
        '',
        `npm puts it into its global folder: ${prefix ?? "npm's global prefix"}.`,
        `Download: the ${QMD_PACKAGE} package and its dependencies from the npm registry; npm reports their size as it goes. The models are a separate step.`,
      ].join('\n'),
    })
    if (!confirmed) return declined
    const result = await installQmd({ ...this.deps.homes, env, consent: true })
    switch (result.status) {
      case 'installed':
      case 'already':
        return done()
      case 'other-version':
        return done(result.warning)
      case 'no-node':
      case 'failed':
        return failed(result.error)
      case 'declined':
        return declined
    }
  }

  private async downloadModels(): Promise<Outcome> {
    const env = await this.deps.env()
    const plan = modelPlan(profileDocsLanguages(this.deps.homes))
    const variables = [`QMD_EMBED_MODEL=${QMD_MODELS.embed.uri}`, ...(plan.russian ? [`QMD_GENERATE_MODEL=${QMD_MODELS.generateRu.uri}`] : [])]
    const confirmed = await this.deps.confirm({
      message: `Download the qmd models (${formatBytes(plan.bytes)})?`,
      detail: [
        `${formatBytes(plan.bytes)} from Hugging Face:`,
        ...plan.models.map((model) => `  ${model.uri}  ${formatBytes(model.bytes)}`),
        '',
        `Into ${modelCacheDir(env)}. worfy runs in your login shell:`,
        `  ${variables.join(' ')} qmd pull`,
        '',
        `Then it writes the answer to ${join(this.deps.homes.harnessHome, MODELS_ANSWER_FILE)}.`,
      ].join('\n'),
    })
    if (!confirmed) return declined
    const result = await answerModels({ ...this.deps.homes, env, download: true })
    if (result.status === 'downloaded' || result.status === 'skipped') return done()
    if (result.status === 'no-qmd') return failed('qmd is not installed: install it first')
    return failed(result.error)
  }

  private async skipModels(): Promise<Outcome> {
    const confirmed = await this.deps.confirm({
      message: 'Skip the qmd models?',
      detail: [
        `worfy writes "skipped" to ${join(this.deps.homes.harnessHome, MODELS_ANSWER_FILE)}. Nothing is downloaded.`,
        '',
        'Without the models the Harness searches with grep. You can download them later from this screen.',
      ].join('\n'),
    })
    if (!confirmed) return declined
    const env = await this.deps.env()
    await answerModels({ ...this.deps.homes, env, download: false })
    return done()
  }

  private async setupCollections(): Promise<Outcome> {
    const projects = (await this.deps.projects()).filter((project) => project.profile !== null && project.collections.length === 0)
    if (projects.length === 0) return done('Every connected Project already has its collections')
    const names = projects.map((project) => project.profile ?? project.name)
    const script = join(this.deps.binDir, 'qmd-collections')
    const confirmed = await this.deps.confirm({
      message: `Set up qmd collections for ${names.join(', ')}?`,
      detail: [
        'worfy runs in your login shell:',
        ...names.map((name) => `  ${script} ${name}`),
        '',
        "Each Project gets three collections (<name>-docs, <name>-tickets, <name>-memory) in qmd's index (~/.config/qmd/index.yml), and their names go to its Profile.",
        'Download: in Full mode the script clones a copy of main from origin when there is none.',
      ].join('\n'),
    })
    if (!confirmed) return declined
    const env = await this.deps.env()
    const errors: string[] = []
    for (const name of names) {
      const result = await setupCollections({ ...this.deps.homes, env, binDir: this.deps.binDir, project: name })
      if (result.code !== 0) errors.push(`${name}: qmd-collections exited ${String(result.code)}: ${tail(result.output, 3)}`)
    }
    return errors.length === 0 ? done() : failed(errors.join('\n'))
  }

  private async ghLogin(projectName: string | undefined): Promise<Outcome> {
    if (projectName === undefined) return failed('there is no Project to open a Terminal in: copy the command and run it in a terminal')
    const confirmed = await this.deps.confirm({
      message: 'Sign in to GitHub in a Terminal?',
      detail: [
        `worfy opens a Terminal Node on the Canvas of ${projectName} and types:`,
        '  gh auth login',
        '',
        'gh asks its questions there and you answer them; worfy does not read them or sign in for you. Check again when you are done.',
      ].join('\n'),
    })
    return confirmed ? { outcome: 'confirmed', message: null } : declined
  }
}
