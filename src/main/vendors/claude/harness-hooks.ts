// Whether the Harness loaded in Claude Code (worfy-harness-guarantees ticket 07): what a Session's system/init
// says of the plugin `worfy`, and the `harnessHooks` part of the Claude driver (src/main/vendors/harness-hooks.ts).
//
// A Session. system/init lists the plugins Claude Code loaded and, under `plugin_errors`, what failed while
// they loaded (the spike of ticket 01, test/fixtures/sdk-messages/init-plugin-errors.jsonl). A hooks.json that
// is not JSON keeps the plugin's row in `plugins` and adds an error `hook-load-failed` whose `plugin` is the
// FOLDER of the inline plugin with `@inline` (`harness@inline`), not the name `worfy` of its manifest; then not
// one hook of the plugin runs. A Session that worfy gave the Harness (sessionHarnessPlugin, options.ts) and
// whose init lacks the plugin `worfy` or carries an error of it gets the notice "Harness did not load"
// (harnessLoadProblems, harnessNotice; session.ts sends it). With the old Harness worfy gives no plugin, and
// only an error of a plugin `worfy` the user has counts. An init that does not list `plugins` checks nothing.
// What system/init cannot tell: a hook script that is missing gives no error there (the hook fails when it
// runs, and the tool runs all the same), and `engines` of the manifest is ignored without a word.
//
// The part. Without a message Claude Code sends no system/init (checked on 2.1.322 for this ticket: a query
// whose input never yields gets SessionStart hooks run and no init), so the check asks the control request
// `get_hooks_listing` (getHooksListing() of the SDK, in sdk.mjs 0.3.322, not in its sdk.d.ts) of a query
// that carries the Session's Harness and sends no message, so no model is called: approved when the plugin
// `worfy` has PreToolUse and Stop hooks listed and none of them `disabled` (`disableAllHooks` marks every
// row so). A hooks.json that is not JSON lists no hook of the plugin at all. Anything else is `unknown`
// with its reason, and Autopilot does not start on Claude Code then (Orchestrators.unattendedRefusal).
// The old Harness gives no plugin and is not checked (the `shortcut:` in readClaudeHooks).
// The query runs in worfy's own folder with the Project as its config root, as the MCP inventory's does
// (query.ts sdkHooksListingStarter), and starts no MCP server. Under WORFY_AGENT=fake the listing is read
// from the Harness's hooks.json itself (fakeHooksListingStarter), with no Claude Code.
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { AgentEvent } from '../../../shared/agent/events'
import type { HarnessHooksAnswer, HarnessHooksPart } from '../harness-hooks'

/** The name of the Harness plugin (HARNESS_PLUGIN_NAME of src/main/harness/locate.ts). */
const HARNESS = 'worfy'

/** The title of the notice of a Session whose Harness did not load. */
export const HARNESS_NOTICE_TITLE = 'Harness did not load'
/** Its last line: what the person must know. */
export const HARNESS_NOTICE_CONSEQUENCE = 'Guards and the gate do not hold in this Session.'

/** What an Autopilot start on Claude Code answers while the Harness's hooks do not run there; the reason follows it. */
export const CLAUDE_HOOKS_REFUSAL = 'Autopilot did not start: the Harness hooks do not run in Claude Code.'

/** How long the check waits for Claude Code to start and answer the hooks listing. */
export const CLAUDE_HOOKS_TIMEOUT_MS = 15_000

/** The hook events the guarantees of the workflow rest on: the guard of each tool call and the gate at the end of a turn. */
export const REQUIRED_EVENTS = ['PreToolUse', 'Stop'] as const

type InitEvent = Extract<AgentEvent, { type: 'init' }>
type NoticeEvent = Extract<AgentEvent, { type: 'notice' }>

/** One thing that went wrong with the Harness at a Session's start: Claude Code's error type and message, or worfy's own. */
export interface HarnessLoadProblem {
  type: string
  message: string
}

/** `worfy@inline` → `worfy`: the name of a plugin id without its marketplace. */
function bareName(id: string): string {
  const at = id.lastIndexOf('@')
  return at <= 0 ? id : id.slice(0, at)
}

/**
 * What went wrong with the Harness by a Session's system/init: `given` is the folder worfy gave it inline
 * (sessionHarnessPlugin), null when it gave none (the old Harness), undefined when the query did not say
 * (the fake agent). Empty: nothing to tell, also when the init does not list `plugins`.
 */
export function harnessLoadProblems(init: Pick<InitEvent, 'plugins' | 'pluginErrors'>, given: string | null | undefined): HarnessLoadProblem[] {
  const plugins = init.plugins
  if (plugins === undefined) return []
  const loaded = plugins.find((plugin) => plugin.name === HARNESS)
  // An inline plugin's error names its folder, `<folder>@inline`; one that failed before it had a name, `inline[N]`
  // (sdk.d.ts) — worfy passes no inline plugin but the Harness.
  const folders = new Set<string>()
  if (typeof given === 'string') folders.add(basename(given))
  if (loaded !== undefined && loaded.path !== null && loaded.path !== '') folders.add(basename(loaded.path))
  const ours = (plugin: string): boolean =>
    bareName(plugin) === HARNESS || (plugin.endsWith('@inline') && folders.has(bareName(plugin))) || (typeof given === 'string' && /^inline\[\d+\]$/.test(plugin))
  const errors = (init.pluginErrors ?? []).filter((error) => ours(error.plugin)).map(({ type, message }) => ({ type, message }))
  if (loaded === undefined && typeof given === 'string') return [{ type: 'not-loaded', message: `Claude Code did not load the plugin ${HARNESS} from ${given}.` }, ...errors]
  return errors
}

/** The facts "Copy details" adds to the problems. */
export interface HarnessNoticeFacts {
  given: string | null | undefined
  init: Pick<InitEvent, 'cwd' | 'claudeCodeVersion' | 'plugins' | 'pluginErrors'>
}

/** The notice "Harness did not load" of `problems` (none: null), with Open Health and Copy details. */
export function harnessNotice(problems: readonly HarnessLoadProblem[], facts: HarnessNoticeFacts): NoticeEvent | null {
  if (problems.length === 0) return null
  const lines = problems.map((problem) => `${HARNESS} · ${problem.type}: ${problem.message}`)
  const details = [
    HARNESS_NOTICE_TITLE,
    ...lines,
    `Claude Code: ${facts.init.claudeCodeVersion ?? 'version unknown'}`,
    `Session folder: ${facts.init.cwd}`,
    `Harness given inline: ${typeof facts.given === 'string' ? facts.given : 'none'}`,
    `Plugins loaded: ${(facts.init.plugins ?? []).map((plugin) => (plugin.path === null ? plugin.name : `${plugin.name} (${plugin.path})`)).join(', ') || 'none'}`,
    ...(facts.init.pluginErrors ?? []).map((error) => `Plugin error: ${error.plugin} · ${error.type}: ${error.message}`),
  ].join('\n')
  return {
    type: 'notice',
    kind: 'notification',
    title: HARNESS_NOTICE_TITLE,
    text: [...lines, HARNESS_NOTICE_CONSEQUENCE].join('\n'),
    action: 'open-health',
    details,
  }
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether an answer of `get_hooks_listing` shows the hooks of the Harness running, and why not. */
export function hooksListingAnswer(listing: unknown): HarnessHooksAnswer {
  if (!isObject(listing) || !Array.isArray(listing.hooks)) return { trust: 'unknown', reason: 'Claude Code answered the hooks listing in a shape worfy does not know.' }
  const rows = (listing.hooks as unknown[]).filter((row): row is Json => isObject(row) && typeof row.pluginName === 'string' && bareName(row.pluginName) === HARNESS)
  for (const event of REQUIRED_EVENTS) {
    const listed = rows.filter((row) => row.event === event)
    if (listed.length === 0) return { trust: 'unknown', reason: `Claude Code lists no ${event} hook of the plugin ${HARNESS}.` }
    if (listed.some((row) => row.disabled === true)) return { trust: 'unknown', reason: `Claude Code keeps the ${event} hooks of the plugin ${HARNESS} from running.` }
  }
  return { trust: 'approved', reason: null }
}

/** A query of the check: no message ever goes to it. */
export interface HooksListingQuery {
  getHooksListing(): Promise<unknown>
  close(): void
}

/** Starts the query of the check with the Harness folder `harnessPlugin` inline, for the Project at `cwd` (none: worfy's own folder). */
export type HooksListingStarter = (input: { cwd: string | undefined; harnessPlugin: string }) => Promise<HooksListingQuery>

export interface ClaudeHooksCheckOptions {
  start: HooksListingStarter
  /** The Harness a Session gets now (sessionHarnessPlugin); null: the old Harness, none inline. */
  harnessPlugin: () => string | null | Promise<string | null>
  /** CLAUDE_HOOKS_TIMEOUT_MS by default. */
  timeoutMs?: number
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Asks Claude Code whether the Harness's hooks run, for a Project at `cwd`. Never throws: what cannot be read is `unknown`. */
export async function readClaudeHooks(cwd: string | undefined, options: ClaudeHooksCheckOptions): Promise<HarnessHooksAnswer> {
  let plugin: string | null
  try {
    plugin = await options.harnessPlugin()
  } catch (error) {
    return { trust: 'unknown', reason: `worfy could not find the Harness: ${messageOf(error)}` }
  }
  // shortcut: the old Harness (ADR-0049) is not checked — its hooks are lines of ~/.claude/settings.json that worfy
  // does not tell from the user's own, and Autopilot starts on it as before this check; redo when a machine with the
  // old Harness must be refused too, or drop it once the move to the plugin (src/main/harness/migrate/) has no old
  // Harness left to find.
  if (plugin === null) return { trust: 'approved', reason: null }
  const limit = options.timeoutMs ?? CLAUDE_HOOKS_TIMEOUT_MS
  const started = options.start({ cwd, harnessPlugin: plugin })
  let timer: ReturnType<typeof setTimeout> | undefined
  let late = false
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      late = true
      reject(new Error('Claude Code did not answer in time'))
    }, limit)
  })
  const asked = (async () => {
    const query = await started
    try {
      return hooksListingAnswer(await query.getHooksListing())
    } finally {
      query.close()
    }
  })()
  try {
    return await Promise.race([asked, timeout])
  } catch (error) {
    // Past the time the query is closed as soon as it has started; one that failed closed itself.
    if (late) started.then((query) => query.close()).catch(() => undefined)
    asked.catch(() => undefined)
    console.warn('[claude] could not read the hooks listing of Claude Code', error)
    return { trust: 'unknown', reason: `worfy could not read the hooks listing of Claude Code: ${messageOf(error)}` }
  } finally {
    clearTimeout(timer)
  }
}

/** The `harnessHooks` part of a Claude driver over `options`. */
export function claudeHarnessHooksPart(options: ClaudeHooksCheckOptions): HarnessHooksPart {
  return {
    check: (cwd) => readClaudeHooks(cwd, options),
    trust: async (cwd) => (await readClaudeHooks(cwd, options)).trust,
    refusal: CLAUDE_HOOKS_REFUSAL,
  }
}

/**
 * The listing as Claude Code builds it from the Harness's hooks/hooks.json, with no Claude Code: what the fake
 * agent (WORFY_AGENT=fake) answers. A file that is not JSON lists no hook, as Claude Code's listing does.
 */
export function fakeHooksListing(harnessPlugin: string): unknown {
  let file: unknown
  try {
    file = JSON.parse(readFileSync(join(harnessPlugin, 'hooks', 'hooks.json'), 'utf8'))
  } catch {
    return { events: [], hooks: [], policy: { allDisabled: false } }
  }
  const hooks: Json[] = []
  if (isObject(file) && isObject(file.hooks)) {
    for (const [event, groups] of Object.entries(file.hooks)) {
      if (!Array.isArray(groups)) continue
      for (const group of groups as unknown[]) {
        if (!isObject(group) || !Array.isArray(group.hooks)) continue
        for (const hook of group.hooks as unknown[]) {
          if (!isObject(hook)) continue
          hooks.push({ event, matcher: typeof group.matcher === 'string' ? group.matcher : '', source: 'pluginHook', pluginName: `${HARNESS}@inline`, type: hook.type, commandText: hook.command })
        }
      }
    }
  }
  return { events: [...new Set(hooks.map((hook) => hook.event))].map((name) => ({ name })), hooks, policy: { allDisabled: false } }
}

/** The check's query on the fake agent: the listing of fakeHooksListing, no process. */
export const fakeHooksListingStarter: HooksListingStarter = ({ harnessPlugin }) => Promise.resolve({ getHooksListing: () => Promise.resolve(fakeHooksListing(harnessPlugin)), close: () => undefined })

/** The app's part: the pinned Claude Code through the Agent SDK, or fakeHooksListingStarter under WORFY_AGENT=fake. */
export const claudeHarnessHooks: HarnessHooksPart = claudeHarnessHooksPart({
  start: async (input) => {
    if (process.env.WORFY_AGENT === 'fake') return fakeHooksListingStarter(input)
    const { sdkHooksListingStarter } = await import('./query')
    return sdkHooksListingStarter()(input)
  },
  harnessPlugin: async () => {
    const [{ sessionHarnessPlugin }, { currentHarness }] = await Promise.all([import('./options'), import('../../harness/locate')])
    return sessionHarnessPlugin(currentHarness().kind)
  },
})
