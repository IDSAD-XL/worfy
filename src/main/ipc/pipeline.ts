// Handlers of the `pipeline` domain (src/shared/ipc/pipeline.ts): the Stage of each Ticket of a
// Project, computed in main (src/main/workflow/stages.ts), read-only (ADR-0002, ADR-0005). The PRs
// come from the app's one PR tracker, shared with the badges and Autopilot (sharedPrTracker), and the
// workflow model from the app's one workflow hub.
//
// The Pipeline editor of Settings (worfy-pipeline ticket 08) reads and writes the Profile's
// `workflow.pipeline` only through the Harness's `bin/profile-set` (ADR-0073), started by the shared
// launcher of the Harness scripts as `bin/project-connect` is (src/main/projects/connect.ts): worfy
// never writes the Profile itself. The write is a `local` channel, so no Linked machine reaches it.
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { pipelineChanged, pipelineClose, pipelineGet, pipelineRead, pipelineWrite, type PipelineEditorRead, type PipelineWriteResult } from '../../shared/ipc/pipeline'
import { pipelineStageSchema } from '../../shared/workflow/pipeline'
import { ClientHolders, clientOf, type Client } from '../clients'
import { DeploymentReader } from '../github/deployments'
import { harnessHomes, locateHarness, scriptEnv } from '../harness/locate'
import { harnessScriptEnv, type HarnessScriptEnvSource } from '../harness/script-env'
import { insideProjects, realInsideProjects } from '../link/caller'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { HARNESS_SCRIPT_TIMEOUT_MS, HarnessScriptStartError, readPipelineProfile, runHarnessScript, scriptFailureDetail, type ProfileRun } from '../workflow/profile'
import { StageHub, type StageSources, type StageSubscriber } from '../workflow/stages'
import { sharedPrTracker } from './checks'
import { defineHandler, emit, type HandlerModule } from './index'
import { OpenedRoots, workflowHub } from './workflow'

/** The Profile's Pipeline through `bin/profile --json`, with the Harness scripts' environment of the app. */
export function pipelineProfileSource(home: string, env: HarnessScriptEnvSource): StageSources['profile'] {
  return async (root) => {
    const read = await readPipelineProfile({ root, claudeHome: home, env: await env() })
    return read.ok ? read : { ok: false, reason: read.reason }
  }
}

/** The app's Stages: one computation per Project, shared by the windows that asked for it. */
export const stageHub = new StageHub({
  workflow: workflowHub,
  prs: sharedPrTracker(),
  profile: pipelineProfileSource(claudeHome(), harnessScriptEnv),
  deployments: new DeploymentReader({ gh: (root, args) => sharedPrTracker().gh(root, args) }),
  harnessHome: harnessHomes(claudeHome()).harnessHome,
})

/**
 * Runs the Harness's `bin/profile-set` with `args`, `stdin` on its stdin. Resolves with the exit code
 * whatever it is; rejects with a HarnessScriptStartError when the script (ENOENT: a Harness older than
 * the editor) or node is missing.
 */
export type ProfileSetRunner = (args: readonly string[], stdin?: string) => Promise<ProfileRun>

/** The app's `bin/profile-set`: the Harness found on the machine, with the Harness scripts' environment of the app. */
export function profileSetRunner(home: string, env: HarnessScriptEnvSource): ProfileSetRunner {
  return async (args, stdin) => {
    const harness = locateHarness(harnessHomes(home))
    return runHarnessScript(join(harness.binDir, 'profile-set'), args, scriptEnv(harness, await env()), { stdin, timeoutMs: HARNESS_SCRIPT_TIMEOUT_MS })
  }
}

/** What `bin/profile-set --read` prints. */
const profileSetReadSchema = z.object({
  pipeline: z.unknown(),
  resolved: z.array(pipelineStageSchema),
  fingerprint: z.string().nullable(),
})

/** What `bin/profile-set --set` and `--reset` print on exit 0. */
const profileSetWrittenSchema = z.object({ fingerprint: z.string().nullable(), warning: z.string().nullable() })

/** The exit code of `bin/profile-set` when the Pipeline in the file is not the one the caller read. */
export const PROFILE_SET_CONFLICT = 5

/** A run of `bin/profile-set`, or null when this Harness has none; any other failure to start throws. */
async function runOrTooOld(run: ProfileSetRunner, args: readonly string[], stdin?: string): Promise<ProfileRun | null> {
  try {
    return await run(args, stdin)
  } catch (error) {
    if (error instanceof HarnessScriptStartError && error.code === 'ENOENT') return null
    throw error
  }
}

/** The JSON a run printed on stdout, checked against `schema`; throws with what the script printed otherwise. */
function printed<T>(run: ProfileRun, schema: z.ZodType<T>, what: string): T {
  let json: unknown
  try {
    json = JSON.parse(run.stdout)
  } catch {
    throw new Error(`bin/profile-set ${what} printed something that is not JSON: ${JSON.stringify(run.stdout.slice(0, 200))}`)
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw new Error(`bin/profile-set ${what} printed an unexpected answer: ${parsed.error.issues[0]?.message ?? ''}`)
  return parsed.data
}

/** Why a run failed, in a line: its exit code and what its stderr says. */
function failure(run: ProfileRun, what: string): Error {
  const how = run.code === null ? `stopped${run.signal ? ` by ${run.signal}` : ''}` : `exit ${run.code}`
  const detail = scriptFailureDetail(run.stderr)
  return new Error(`bin/profile-set ${what} failed (${how})${detail ? `: ${detail}` : ''}`)
}

export interface PipelineHandlersOptions {
  hub: Pick<StageHub, 'open' | 'close' | 'drop'>
  projects?: () => readonly { readonly path: string }[]
  /** Where the opens' roots are kept; a test passes its own to see them. */
  opened?: OpenedRoots
  /** The Pipeline editor's `bin/profile-set`; the app's (profileSetRunner) when absent. */
  profileSet?: ProfileSetRunner
}

/**
 * The handlers over a hub; a Linked machine reaches only the Projects of the list (src/main/link/caller.ts).
 * The hub computes a Project under its resolved root, and its snapshots carry that root; each client
 * gets them with the root as it sent it, since the window looks the root up by its own string. On
 * Windows the window keeps git's `C:/…` while path.resolve gives `C:\…` (worfy-windows ticket 63).
 */
export function pipelineHandlers(options: PipelineHandlersOptions): HandlerModule {
  const projects = options.projects ?? (() => projectStore().list())
  const opened = options.opened ?? new OpenedRoots()
  const profileSet = options.profileSet ?? profileSetRunner(claudeHome(), harnessScriptEnv)
  /** The client holding each id leaves every Project when it is destroyed or another client takes its id. */
  const holders = new ClientHolders((id) => {
    opened.forget(id)
    void options.hub.drop(id)
  })
  /** The client that called, as a subscriber of the root it spelled `asSent`. */
  const subscriberOf = (client: Client | undefined, asSent: string): StageSubscriber => {
    if (client === undefined) throw new Error('pipeline.get: the call came from no client')
    if (!holders.hold(client)) throw new Error('pipeline.get: the client is gone')
    return {
      id: client.id,
      send: (snapshot) => {
        if (!client.isDestroyed()) emit(client, pipelineChanged, { ...snapshot, root: asSent })
      },
    }
  }
  return [
    defineHandler(pipelineGet, async ({ root }, { event }) => {
      const checked = resolve(insideProjects(event, resolve(root), projects, 'the Project root'))
      const subscriber = subscriberOf(clientOf(event), root)
      opened.remember(subscriber.id, root, checked)
      return { ...(await options.hub.open(checked, subscriber)), root }
    }),
    // Not checked against the Projects: it closes under the root the open used (OpenedRoots).
    defineHandler(pipelineClose, async ({ root }, { event }) => {
      const client = clientOf(event)
      return { closed: client === undefined ? false : await options.hub.close(opened.take(client.id, root), client.id) }
    }),
    // The editor's read: what the Profile's Pipeline is, and its fingerprint for the write.
    defineHandler(pipelineRead, async ({ root }, { event }): Promise<PipelineEditorRead> => {
      const checked = resolve(insideProjects(event, resolve(root), projects, 'the Project root'))
      const run = await runOrTooOld(profileSet, ['-C', checked, '--read'])
      if (run === null) return { available: false, reason: 'this Harness has no bin/profile-set' }
      if (run.code !== 0) throw failure(run, '--read')
      const read = printed(run, profileSetReadSchema, '--read')
      return { available: true, custom: read.pipeline !== null, pipeline: read.resolved, fingerprint: read.fingerprint }
    }),
    // The editor's write: `local`, so only a window of this Machine gets here (the link adapter
    // refuses it to every Linked machine). The root must be a Project of this Machine all the same:
    // a window that shows a Linked machine sends `local` channels here, with a root of that Machine.
    defineHandler(pipelineWrite, async ({ root, expected, pipeline }): Promise<PipelineWriteResult> => {
      const checked = realInsideProjects(root, projects())
      if (checked === null) throw new Error(`pipeline.write: ${root} is not a Project of this Machine; a Pipeline is edited on the Machine of its Project`)
      const what = pipeline === null ? '--reset' : '--set'
      const args = ['-C', checked, '--expect', expected ?? 'null', ...(pipeline === null ? ['--reset'] : ['--set', '-'])]
      const run = await runOrTooOld(profileSet, args, pipeline === null ? undefined : JSON.stringify(pipeline))
      if (run === null) return { status: 'too-old' }
      if (run.code === PROFILE_SET_CONFLICT) return { status: 'conflict' }
      if (run.code === 1) return { status: 'invalid', reason: scriptFailureDetail(run.stderr).replace(/^profile-set: /u, '') || 'bin/profile-set refused the Pipeline' }
      if (run.code !== 0) throw failure(run, what)
      const written = printed(run, profileSetWrittenSchema, what)
      return { status: 'saved', fingerprint: written.fingerprint, warning: written.warning }
    }),
  ]
}

export default pipelineHandlers({ hub: stageHub })
