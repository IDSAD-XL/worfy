// How the app's Claude Sessions start Claude Code (the Claude driver, ADR-0094 item 2): the Agent SDK's
// query() with the options of options.ts, the Project's canvas and Browser servers, its MCP and skills
// allowlists and the autocompact window of the Session's role. WORFY_AGENT=fake swaps Claude Code for
// the fake agent (src/main/agent/fake-query.ts), which plays
// test/fixtures/agent-scripts/<WORFY_AGENT_SCRIPT or "turn">.jsonl. With WORFY_AGENT_LOG set, the
// fake agent also appends what it was asked to do (FakeCall, one JSON line each) to that file, so
// e2e runs can see the control calls. The fake agent's Browser tools are exposed by the Session
// registry (src/main/agent/app-registry.ts), which this driver never imports.
//
// A Product Session (worfy-product-session ticket 04) also gets the Mind map server `worfy-mind-map`, bound
// to its Project's Product Session folder, next to its canvas; no other Session gets it. Its guard
// (worfy-polish ticket 82) gets the Project's list «Product Session may also write here», the folders no
// write reaches and the person to ask (productWritesFor); the fake agent runs the same guard (productHooks).
//
// The Project's private skills (worfy-human-review ticket 05, ADR-0102): a Session in a Project that a
// person is at — Orchestrator, "New session", "Ship ticket", a Product Session — gets the team reviewer's
// private folder of the Profile folder as an extra directory after the Cards folder, when its SKILL.md is
// there. The Profile folder is read at each start, like the lists; an unattended Session never asks.
//
// The autocompact window (worfy-polish ticket 24) is read from the app settings of this Machine
// each time a Session starts Claude Code — the Orchestrator's for a Project's Orchestrator, the
// other one for any other Session — so a change reaches the next start, never a running process.
// A window the person never chose gives way to `autoCompactWindow` of the user's settings.json,
// read at the same moment (worfy-polish ticket 29, autoCompactWindowSource).
//
// The Integrations of the Project (worfy-integrations ticket 06, ADR-0111) go with the canvas too: each enabled entry
// of the Project's `integrations` (its settings.json) the Machine's store still has — an id it lost is skipped — is the
// SDK server of the proxy (src/main/integrations/proxy.ts) under its server name; an unattended Session gets only those
// «Available to Autopilot». The query handed on carries their labels for the rows of the chip (labelIntegrations).
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { app } from 'electron'
import { productFolder } from '../../../shared/product/paths'
import { autoCompactWindowFor } from '../../../shared/settings/app-settings'
import { agentEnv, type Env } from '../../agent/env'
import { fakeInventoryStarter, fakeQueryFactory, type FakeQueryOptions, type FakePreToolUse } from '../../agent/fake-query'
import type { ProductWriteList } from '../../agent/product-guard'
import type { QueryFactory, QueryHandle, QueryRequest } from '../../agent/session'
import { readUserAutoCompactWindow } from '../../claude-home/user-model'
import { currentHarness } from '../../harness/locate'
import { browserForSession, type BrowserResolver, type BrowserSession } from '../../mcp/browser-server'
import { canvasForSession, projectForCwd, type CanvasResolver, type CanvasSession } from '../../mcp/canvas-server'
import { mindMapForSession, type MindMapResolver, type MindMapSession } from '../../mcp/mind-map-server'
import type { SecretSource } from '../../integrations/auth/tokens'
import { integrationProxy, integrationRowFacts, sessionIntegrations, type IntegrationProxy, type SessionIntegration } from '../../integrations/proxy'
import type { IntegrationRowFacts } from '../../integrations/rows'
import { integrationStore } from '../../integrations/store'
import { privateFolder, reviewerSkill } from '../../projects/review-offer'
import { addProductWriteFolder, readProjectIntegrations, readProjectSettings } from '../../projects/settings'
import { projectStore, type ProjectStore } from '../../projects/store'
import { harnessScriptEnv } from '../../harness/script-env'
import { appSettingsStore } from '../../settings/store'
import { claudeHome, dataRoot, harnessHome } from '../../storage/paths'
import { assistDir } from '../../terminal-ai/options'
import { projectLayouts, type ProjectLayout } from '../../workflow/folder'
import { readMcpAllowlist, readProfileFolder, readSkillsAllowlist, type ProfileFolder, type ReadProfileOptions } from '../../workflow/profile'
import { claudeMcpServer, labelIntegrations, type ClaudeMcpServer } from './mcp'
import type { HooksListingStarter } from './harness-hooks'
import { inventoryServerNames, silentInput, type InventoryQueryStarter } from './mcp-inventory'
import { harnessCheckOptions, inventoryOptions, productGuard, sessionHarnessPlugin, sessionOptions, toolUseHooks, userExtensions, withBrowserServer, withMindMapServer, type ProductWrites } from './options'
import { projectLocalMcp } from './project-mcp'

/** The canvas of a Session (ticket 24); a failure leaves the Session without canvas tools rather than without a Session. */
async function canvasOrNull(canvas: CanvasResolver, request: QueryRequest): Promise<CanvasSession | null> {
  try {
    return await canvas({ cwd: request.cwd, resume: request.resume, ...(request.kind === undefined ? {} : { kind: request.kind }) })
  } catch (error) {
    console.warn(`[agent] no canvas tools for ${request.cwd}`, error)
    return null
  }
}

/** The Browser server of a Session (worfy-browser ticket 04); a failure leaves the Session without it rather than without a Session. */
async function browserOrNull(browser: BrowserResolver, request: QueryRequest): Promise<BrowserSession | null> {
  try {
    return await browser({ cwd: request.cwd, resume: request.resume, autopilot: request.unattended === true })
  } catch (error) {
    console.warn(`[agent] no Browser tools for ${request.cwd}`, error)
    return null
  }
}

/** The Mind map server of a Product Session (worfy-product-session ticket 04); a failure leaves the Session without it rather than without a Session. */
async function mindMapOrNull(mindMap: MindMapResolver, cwd: string, productFolder: string | null): Promise<MindMapSession | null> {
  try {
    return await mindMap({ cwd, productFolder })
  } catch (error) {
    console.warn(`[agent] no Mind map tools for ${cwd}`, error)
    return null
  }
}

/**
 * The Integrations a Session in the Project at `cwd` gets (worfy-integrations ticket 06); asked only with the canvas.
 * `rowFacts` — what the Session's rows read each time they are asked (ticket 09, integrations/rows.ts); absent: none.
 */
export type IntegrationsResolver = ((request: { cwd: string; unattended: boolean }) => Promise<readonly SessionIntegration[]>) & {
  rowFacts?: ((request: { cwd: string }) => IntegrationRowFacts | null) | undefined
}

/** Where the Integrations of a Session come from: its Project's settings, the Machine's store, the proxy, Claude Code's names. */
export interface ProjectIntegrationsDeps {
  /** The data folder of the Project holding `cwd`; null outside every Project. */
  dataDirOf: (cwd: string) => string | null
  store: Pick<SecretSource, 'get'>
  proxy: Pick<IntegrationProxy, 'sessionServer' | 'status'>
  /** The servers of Claude Code in the Project of `cwd` (the MCP inventory's last answer). */
  taken: (cwd: string) => readonly string[]
}

/** The Integrations of the Project's settings (readProjectIntegrations) through `deps` (sessionIntegrations). */
export function projectIntegrationsResolver(deps: ProjectIntegrationsDeps): IntegrationsResolver {
  const resolve = async ({ cwd, unattended }: { cwd: string; unattended: boolean }): Promise<readonly SessionIntegration[]> => {
    const dir = deps.dataDirOf(cwd)
    if (dir === null) return []
    return sessionIntegrations({ entries: readProjectIntegrations(dir), store: deps.store, proxy: deps.proxy, unattended, taken: deps.taken(cwd) })
  }
  const rowFacts = ({ cwd }: { cwd: string }): IntegrationRowFacts | null => {
    const dir = deps.dataDirOf(cwd)
    return dir === null ? null : integrationRowFacts({ dataDir: dir, store: deps.store, proxy: deps.proxy, taken: () => deps.taken(cwd) })
  }
  return Object.assign(resolve, { rowFacts })
}

/** The app's: the Project of the app's list, this Machine's store and proxy, the app's MCP inventory. */
function appResolver(): IntegrationsResolver {
  const projects = projectStore()
  return projectIntegrationsResolver({
    dataDirOf: (cwd) => {
      const project = projectForCwd(projects.list(), cwd)
      return project === undefined ? null : projects.dataDir(project.id)
    },
    store: integrationStore(),
    proxy: integrationProxy(),
    taken: inventoryServerNames,
  })
}

const appIntegrations: IntegrationsResolver = Object.assign((request: { cwd: string; unattended: boolean }) => appResolver()(request), {
  rowFacts: (request: { cwd: string }) => appResolver().rowFacts?.(request) ?? null,
})

/** The row facts of a Session's Integrations; a failure leaves the rows with their labels alone. */
function rowFactsOrNone(integrations: IntegrationsResolver, cwd: string): IntegrationRowFacts | undefined {
  try {
    return integrations.rowFacts?.({ cwd }) ?? undefined
  } catch {
    return undefined
  }
}

/** An Integration as the Session's options take it: its id, server name, label and SDK server. */
interface ClaudeIntegration {
  id: string
  name: string
  label: string
  server: ClaudeMcpServer
}

/** The Integrations of a Session as SDK servers; a failure leaves the Session without them rather than without a Session. */
async function integrationsOrNone(integrations: IntegrationsResolver, request: QueryRequest): Promise<ClaudeIntegration[]> {
  try {
    const found = await integrations({ cwd: request.cwd, unattended: request.unattended === true })
    return await Promise.all(found.map(async ({ id, name, label, server }) => ({ id, name, label, server: await claudeMcpServer(server) })))
  } catch (error) {
    console.warn(`[agent] no Integrations for ${request.cwd}: ${error instanceof Error ? error.name : 'an error'}`)
    return []
  }
}

/**
 * The MCP servers a Session in the Project at `cwd` may use (ADR-0021); never rejects. `env` is
 * the login shell environment the Session itself gets.
 */
export type McpAllowlistResolver = (cwd: string, env: Env) => Promise<readonly string[]>

/**
 * The list from the Profile of the Project the Session runs in, or the default list (profile.ts).
 * `bin/profile` runs with the login shell environment: from Finder worfy's own PATH has no node.
 */
const profileAllowlist: McpAllowlistResolver = async (cwd, env) => (await readMcpAllowlist({ root: cwd, claudeHome: claudeHome(), env })).servers

/**
 * The user's plugins and skills a Session in the Project at `cwd` gets (ADR-0084), or null for all
 * of them; never rejects.
 */
export type SkillsAllowlistResolver = (cwd: string, env: Env) => Promise<readonly string[] | null>

/** The Profile's `skills.allowed` (profile.ts), read like the MCP list. */
const profileSkills: SkillsAllowlistResolver = async (cwd, env) => (await readSkillsAllowlist({ root: cwd, claudeHome: claudeHome(), env })).names

/**
 * The private folder of the Project's own skills a Session in the Project at `cwd` gets as an extra
 * directory (worfy-human-review ticket 05, ADR-0102), or null for none.
 */
export type PrivateSkillsResolver = (cwd: string, env: Env) => Promise<string | null>

/**
 * The team reviewer's private folder in the Profile folder of the Project at `cwd`
 * (src/main/projects/review-offer.ts, the folder "Team reviewer" reads and deletes) when its skill,
 * `.claude/skills/human-review/SKILL.md`, is there; null without the skill or without a Profile folder.
 * `read`: the Profile folder from `bin/profile` by default (profile.ts, readProfileFolder).
 */
export async function privateSkillsFolder(cwd: string, env: Env, read: (options: ReadProfileOptions) => Promise<ProfileFolder> = readProfileFolder): Promise<string | null> {
  const { dir } = await read({ root: cwd, claudeHome: claudeHome(), env })
  if (dir === null) return null
  const folder = privateFolder(dir)
  return existsSync(reviewerSkill(folder)) ? folder : null
}

/** The private skills of a Session (ADR-0102); a failure leaves the Session without them rather than without a Session. */
async function privateSkillsOrNull(privateSkills: PrivateSkillsResolver, cwd: string, env: Env): Promise<string | null> {
  try {
    return await privateSkills(cwd, env)
  } catch (error) {
    console.warn(`[agent] no private skills for ${cwd}`, error)
    return null
  }
}

/**
 * The autocompact window a Session starts with, by whether it is a Project's Orchestrator; null
 * passes none. Never throws.
 */
export type AutoCompactWindowReader = (orchestrator: boolean) => number | null

/**
 * The window from the app settings of this Machine (src/main/settings/store.ts) and, for a window
 * not chosen there, from the user's <claudeHome>/settings.json.
 */
const appAutoCompactWindow: AutoCompactWindowReader = (orchestrator) => {
  try {
    return autoCompactWindowFor(appSettingsStore().get(), orchestrator, readUserAutoCompactWindow())
  } catch (error) {
    // The store answers the defaults for a file it cannot read; this is past that. The Session
    // still starts, with Claude Code's own window.
    console.warn('[agent] could not read the autocompact window, the Session starts with Claude Code\'s own', error)
    return null
  }
}

/**
 * The Product Session folder of the Project at `cwd` (src/shared/product/paths.ts), the one place a Product
 * Session writes files (worfy-product-session ticket 02); null when it cannot be told, and the Session then
 * writes no file. Never rejects.
 */
export type ProductFolderResolver = (cwd: string) => Promise<string | null>

/** Where the layout of a Project comes from: projectLayouts() of src/main/workflow/folder.ts, or a test's. */
export interface ProjectLayouts {
  get(root: string): Promise<ProjectLayout>
}

/**
 * The folder by the Project's layout (`bin/profile`: Full or Silent mode). A layout the Harness did not
 * answer is the Full-mode fallback, which may be wrong for a Silent-mode Project: no folder then.
 * `layouts`: the app's cache by default.
 */
export const layoutProductFolder = async (cwd: string, layouts: () => ProjectLayouts = projectLayouts): Promise<string | null> => {
  try {
    const layout = await layouts().get(cwd)
    return layout.failed ? null : productFolder(layout)
  } catch (error) {
    console.warn(`[agent] no Product Session folder for ${cwd}: the Session writes no file`, error)
    return null
  }
}

/**
 * The Project's list «Product Session may also write here» for a Product Session in `cwd` (worfy-polish
 * ticket 82); null when `cwd` is in no Project: nothing is listed and «Always allow» is not offered.
 */
export type ProductWriteListResolver = (cwd: string) => ProductWriteList | null

/**
 * The list in the settings of the Project of `projects` whose root holds `cwd`
 * (src/main/projects/settings.ts, in the Project's data folder), read from settings.json at each write
 * and added to by «Always allow in <folder>».
 */
export function productWriteListIn(projects: Pick<ProjectStore, 'list' | 'dataDir'>): ProductWriteListResolver {
  return (cwd) => {
    const project = projectForCwd(projects.list(), cwd)
    if (project === undefined) return null
    const dir = projects.dataDir(project.id)
    return {
      read: () => readProjectSettings(dir).productWriteFolders ?? [],
      add: (folder) => void addProductWriteFolder(dir, folder),
    }
  }
}

/** productWriteListIn over the app's Project list. */
export const projectProductWriteList: ProductWriteListResolver = (cwd) => productWriteListIn(projectStore())(cwd)

/**
 * The folders a Product Session never writes, asked or listed (worfy-polish ticket 82): worfy's data
 * folder — the one this run uses and those of both builds, `worfy` and `worfy-dev` (ADR-0023) — the
 * Claude home with the Harness in it — the one worfy reads and, when a test or an e2e run points
 * WORFY_CLAUDE_HOME elsewhere, the user's own ~/.claude too — and the Harness wherever
 * WORFY_HARNESS_HOME puts it.
 */
export function productClosedFolders(env: Readonly<Record<string, string | undefined>> = process.env): string[] {
  return [...new Set([dataRoot(env), dataRoot({}, 'packaged'), dataRoot({}, 'dev'), claudeHome(env), join(homedir(), '.claude'), harnessHome(env)])]
}

/** What a Product Session's guard needs for a write outside its folder (options.ts, ProductWrites). */
function productWritesFor(request: QueryRequest, list: ProductWriteListResolver): ProductWrites {
  let found: ProductWriteList | null
  try {
    found = list(request.cwd)
  } catch (error) {
    console.warn(`[agent] no list of folders a Product Session may also write for ${request.cwd}`, error)
    found = null
  }
  return { list: found, closed: productClosedFolders(), ask: request.askProductWrite }
}

/**
 * The PreToolUse hooks of a Product Session's query — the guard sdkQueryFactory gives Claude Code — for
 * the fake agent (WORFY_AGENT=fake), which runs them before it asks canUseTool, as Claude Code does: an
 * e2e run then meets the guard and its question. Undefined for any other Session.
 */
export async function productHooks(
  request: QueryRequest,
  productFolderOf: ProductFolderResolver = (cwd) => layoutProductFolder(cwd),
  list: ProductWriteListResolver = projectProductWriteList,
): Promise<NonNullable<Options['hooks']> | undefined> {
  if (request.kind !== 'product') return undefined
  const folder = await productFolderOf(request.cwd).catch(() => null)
  return toolUseHooks(undefined, productGuard(folder, request.cwd, process.platform, productWritesFor(request, list)))
}

/**
 * `hooks` run as Claude Code runs the PreToolUse hooks of a query, for the fake agent: each callback gets
 * the hook input Claude Code gives (`hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`, `cwd`), and
 * the first `permissionDecision` of `deny` or `allow` decides. Undefined without hooks.
 */
export function fakePreToolUse(hooks: NonNullable<Options['hooks']> | undefined): FakePreToolUse | undefined {
  const callbacks = hooks?.PreToolUse?.flatMap((matcher) => matcher.hooks) ?? []
  if (callbacks.length === 0) return undefined
  return async (call, signal) => {
    const input = { hook_event_name: 'PreToolUse', session_id: '', transcript_path: '', cwd: call.cwd, tool_name: call.toolName, tool_input: call.input, tool_use_id: call.toolUseId }
    for (const callback of callbacks) {
      const output = (await callback(input as Parameters<typeof callback>[0], call.toolUseId, { signal })) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }
      const decision = output.hookSpecificOutput?.permissionDecision
      if (decision === 'deny' || decision === 'allow') return { decision, reason: output.hookSpecificOutput?.permissionDecisionReason ?? null }
    }
    return { decision: null, reason: null }
  }
}

/**
 * The part of the Agent SDK a Session start uses: query(), which starts the Claude Code process with
 * the options sessionOptions() made.
 */
export interface AgentSdk {
  query(params: { prompt: QueryRequest['prompt']; options: object }): unknown
}

/** The Agent SDK itself, imported on the first Session start (Node keeps the module after that). */
const importSdk = (): Promise<AgentSdk> => import('@anthropic-ai/claude-agent-sdk')

export interface SdkQueryFactoryOptions {
  /** The autocompact window of a Session's role; the app settings of this Machine by default. */
  autoCompactWindow?: AutoCompactWindowReader
  /**
   * Where query() comes from; the Agent SDK by default. A test passes its own, so the SDK module is
   * never imported there and no Claude Code process can start.
   */
  loadSdk?: () => Promise<AgentSdk>
  /** The Browser server of a Session in a Project; browserForSession by default. */
  browser?: BrowserResolver
  /** The Profile's list of the user's plugins and skills; `skills.allowed` by default. */
  skills?: SkillsAllowlistResolver
  /** The Product Session folder of a Product Session's Project; by the Project's layout by default. */
  productFolder?: ProductFolderResolver
  /** The Mind map server of a Product Session; mindMapForSession by default. Never asked for another Session. */
  mindMap?: MindMapResolver
  /** The Project's private skills folder; the team reviewer's in the Profile folder by default. Never asked for an unattended Session. */
  privateSkills?: PrivateSkillsResolver
  /** The list «Product Session may also write here» of a Product Session's Project; its Project settings by default. Never asked for another Session. */
  productWriteList?: ProductWriteListResolver
  /** The Integrations of a Session in a Project; the Project's settings through this Machine's proxy by default. */
  integrations?: IntegrationsResolver
}

/**
 * Claude Code through the Agent SDK, with the user's login shell environment and the Project's
 * canvas. A Session in a Project (one the canvas attaches to) gets only the MCP servers its Profile
 * lists, and of the user's plugins and skills those its `skills.allowed` names, when it has one; a
 * Session outside every Project, or whose canvas failed, keeps the user's servers, plugins and skills
 * as they are.
 * Every Session gets the Harness copy of this build inline unless the old Harness is on the machine
 * (sessionHarnessPlugin, ADR-0049), and the autocompact window of its role (`autoCompactWindow`),
 * read when the options are built — after the environment and the canvas are in, so a change made
 * while they load still reaches this start. worfy starts the Claude Code process itself, as the SDK
 * would, and tells the Session of it (watchedSpawn, ADR-0064).
 */
export function sdkQueryFactory(
  canvas: CanvasResolver = canvasForSession,
  mcpAllowlist: McpAllowlistResolver = profileAllowlist,
  {
    autoCompactWindow = appAutoCompactWindow,
    loadSdk = importSdk,
    browser = browserForSession,
    skills = profileSkills,
    productFolder: productFolderOf = (cwd) => layoutProductFolder(cwd),
    mindMap = mindMapForSession,
    privateSkills = privateSkillsFolder,
    productWriteList = projectProductWriteList,
    integrations = appIntegrations,
  }: SdkQueryFactoryOptions = {},
): QueryFactory {
  return async (request) => {
    const product = request.kind === 'product'
    const [{ query }, environment, attached, folder] = await Promise.all([
      loadSdk(),
      agentEnv(),
      canvasOrNull(canvas, request),
      product ? productFolderOf(request.cwd).catch(() => null) : Promise.resolve(null),
    ])
    // The Browser goes with the canvas: a Session the canvas finds no Project for gets neither. An
    // unattended one (Autopilot) gets it in Autopilot mode: only the Browser profiles marked
    // «Available to Autopilot» exist for it (worfy-browser ticket 08, ADR-0078 item 10).
    const browsing = attached ? browserOrNull(browser, request) : Promise.resolve(null)
    // The Mind map goes with the canvas too, and only to a Product Session.
    const mapping = attached && product ? mindMapOrNull(mindMap, request.cwd, folder) : Promise.resolve(null)
    // The Project's private skills go with the canvas too, and only to a Session a person is at (ADR-0102).
    const privately = attached && request.unattended !== true ? privateSkillsOrNull(privateSkills, request.cwd, environment.env) : Promise.resolve(null)
    // The Integrations go with the canvas too (worfy-integrations ticket 06).
    const integrating = attached ? integrationsOrNone(integrations, request) : Promise.resolve([])
    const [listed, browserSession, skillsAllowlist, mindMapSession, privateSkillsDir, sessionIntegrated] = attached
      ? await Promise.all([mcpAllowlist(request.cwd, environment.env), browsing, skills(request.cwd, environment.env), mapping, privately, integrating])
      : [null, null, null, null, null, []]
    // worfy-browser joins the Profile's list only with the server it names: not when the Browser
    // server could not be made. worfy-mind-map likewise, whatever the list names.
    const withBrowser = listed !== null && browserSession !== null ? withBrowserServer(listed) : listed
    const allowlist = withBrowser !== null && mindMapSession !== null ? withMindMapServer(withBrowser) : withBrowser
    // The driver tells a server of the user outside this list as not allowed (worfy-mcp-live ticket 05).
    request.mcpListed?.(allowlist)
    // And checks system/init against the Harness it gave (worfy-harness-guarantees ticket 07).
    const harnessPlugin = sessionHarnessPlugin(currentHarness().kind)
    request.harnessGiven?.(harnessPlugin)
    const options = sessionOptions({
      cwd: request.cwd,
      env: environment.env,
      runtime: { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch },
      resume: request.resume,
      sessionId: request.sessionId,
      stderr: request.stderr,
      spawned: request.spawned,
      canvas: attached?.attachment,
      privateSkills: privateSkillsDir,
      browser: browserSession?.attachment,
      mindMap: mindMapSession?.attachment,
      integrations: sessionIntegrated.map(({ name, server }) => ({ name, server })),
      settings: request.settings,
      canUseTool: request.canUseTool,
      unattended: request.unattended,
      mcpAllowlist: allowlist,
      // An allowed remote server the inventory knows goes by its address (worfy-mcp-live ticket 12).
      mcpAddresses: request.mcpAddresses,
      // Turned off for this Session (worfy-mcp-live ticket 03): left out of the list, or denied by name without one.
      mcpOff: request.mcpOff,
      skillsAllowlist,
      // Read only with a list: without one nothing is turned off.
      userExtensions: skillsAllowlist !== null ? userExtensions(claudeHome(), request.cwd) : undefined,
      // Looked for at every Session start: worfy's own Harness inline unless the old one is on the machine (ADR-0049).
      harnessPlugin,
      autoCompactWindow: autoCompactWindow(request.orchestrator === true),
      // The Run's TMPDIR and git environment, and where the shell stands for each tool call (worfy-auto-approve ticket 04).
      environment: request.environment,
      // The Epic of an Orchestrator Autopilot started (worfy-continuity ticket 12): WORFY_EPIC and a line of the system prompt.
      epic: request.epic,
      // The file of the guard's refusals (worfy-harness-guarantees ticket 10): WORFY_GUARD_LOG.
      guardLog: request.guardLog,
      toolUse: request.toolUse,
      // A Product Session's limits (worfy-product-session ticket 02): the PreToolUse guard and its kind in the environment.
      // A write outside its folder is asked about (worfy-polish ticket 82): the Project's list, the closed folders, the person.
      ...(product ? { kind: 'product' as const, productFolder: folder, productWrites: productWritesFor(request, productWriteList) } : {}),
    })
    request.processEnv?.(options.env ?? environment.env)
    const handle = query({ prompt: request.prompt, options }) as QueryHandle
    const observed = attached ? attached.observe(handle) : handle
    const browsed = browserSession ? browserSession.observe(observed) : observed
    const mapped = mindMapSession ? mindMapSession.observe(browsed) : browsed
    // The rows of the Integrations' servers say so, with their labels (claudeMcpStatus), and — ticket 09 — what the
    // proxy finds of them and what the Project turned on since.
    labelIntegrations(mapped, sessionIntegrated, attached ? rowFactsOrNone(integrations, request.cwd) : undefined)
    return mapped
  }
}

/** `env` without its unset variables. */
const definedOnly = (env: Readonly<Record<string, string | undefined>>): Env => Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined))

/**
 * The fake agent's options under WORFY_AGENT=fake. WORFY_AGENT_MCP_ALLOWLIST=profile: the fake agent leaves
 * out the servers the Profile's list (read as a Session's is) does not name, as Claude Code's policy tier
 * does (worfy-mcp-live ticket 05); otherwise it lists every server its script names.
 */
function fakeOptionsFromEnv(env: NodeJS.ProcessEnv): FakeQueryOptions {
  const log = env.WORFY_AGENT_LOG
  return {
    scriptsDir: env.WORFY_AGENT_SCRIPTS ?? join(app.getAppPath(), 'test', 'fixtures', 'agent-scripts'),
    script: env.WORFY_AGENT_SCRIPT ?? 'turn',
    record: log ? (call) => appendFileSync(log, `${JSON.stringify(call)}\n`) : undefined,
    // WORFY_AGENT_REGISTRY=1: each fake Claude Code writes its entry to <WORFY_CLAUDE_HOME>/sessions, as the real one does.
    registryHome: env.WORFY_AGENT_REGISTRY === '1' ? env.WORFY_CLAUDE_HOME : undefined,
    // A Product Session's guard, which Claude Code would run before canUseTool (worfy-polish ticket 82).
    preToolUse: (request) => (request.kind === 'product' ? productHooks(request).then(fakePreToolUse) : undefined),
    ...(env.WORFY_AGENT_MCP_ALLOWLIST === 'profile' ? { mcpAllowlist: async (request: QueryRequest) => profileAllowlist(request.cwd, definedOnly(await harnessScriptEnv())) } : {}),
    // The Project's Integrations, through the app's proxy as a real Session gets them (worfy-integrations ticket 08).
    integrations: async (request) => {
      const found = await appIntegrations({ cwd: request.cwd, unattended: request.unattended === true })
      // A list the service refused leaves that server without tools, not the Session without its Integrations.
      const toolsOf = async (server: (typeof found)[number]['server']): Promise<string[]> => (await (server.listTools?.() ?? Promise.resolve(server.tools)).catch(() => [])).map((tool) => tool.name)
      return Promise.all(found.map(async ({ id, name, label, server }) => ({ id, name, label, tools: await toolsOf(server) })))
    },
    labelIntegrations: (query, servers, request) => labelIntegrations(query, servers, rowFactsOrNone(appIntegrations, request.cwd)),
  }
}

/** Claude Code through the Agent SDK (sdkQueryFactory), or the fake agent under WORFY_AGENT=fake. */
export function queryFactoryFromEnv(env: NodeJS.ProcessEnv = process.env): QueryFactory {
  if (env.WORFY_AGENT !== 'fake') return sdkQueryFactory()
  return fakeQueryFactory(fakeOptionsFromEnv(env))
}

/**
 * The query of the MCP inventory (worfy-mcp-live ticket 05, mcp-inventory.ts): Claude Code with the
 * user's settings as a Session reads them, but without the Profile's list, without worfy's own servers and
 * without a single message, so no model is called: its input never yields. It runs in `runDir`, outside
 * every Project, as the Limits probe does (limits.ts), so Claude Code registers no Session of the Project
 * and the Canvas gets no Session Node from it (ticket 14). The Project's folder `cwd` is its
 * projectConfigRoot, and the Project's record in .claude.json is read by worfy (project-mcp.ts). `loadSdk`:
 * the Agent SDK by default, a test's query() otherwise; `runDir`: <WORFY_DATA_DIR>/terminal-ai by default.
 */
export function sdkInventoryStarter(loadSdk: () => Promise<AgentSdk> = importSdk, runDir: () => string = () => assistDir(dataRoot())): InventoryQueryStarter {
  return async (cwd, prompt) => {
    const [{ query }, environment] = await Promise.all([loadSdk(), agentEnv()])
    const local = projectLocalMcp(cwd, environment.env)
    const at = runDir()
    mkdirSync(at, { recursive: true })
    const runtime = { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch }
    const options = inventoryOptions({ cwd: at, env: environment.env, runtime, projectConfigRoot: resolve(cwd), servers: local.servers, disabled: local.disabled })
    return query({ prompt, options }) as QueryHandle
  }
}

/**
 * The query that checks whether the Harness's hooks run (worfy-harness-guarantees ticket 07, harness-hooks.ts):
 * Claude Code with the Harness inline and the user's settings as a Session reads them, no MCP server and no
 * message, so no model is called (options.ts, harnessCheckOptions). Like the inventory's it runs in `runDir`,
 * outside every Project, with the Project's folder as its config root; its messages are read and dropped, so
 * nothing waits on them. `loadSdk`: the Agent SDK by default, a test's query() otherwise.
 */
export function sdkHooksListingStarter(loadSdk: () => Promise<AgentSdk> = importSdk, runDir: () => string = () => assistDir(dataRoot())): HooksListingStarter {
  return async ({ cwd, harnessPlugin }) => {
    const [{ query }, environment] = await Promise.all([loadSdk(), agentEnv()])
    const at = runDir()
    mkdirSync(at, { recursive: true })
    const runtime = { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch }
    const stop = new AbortController()
    const options = harnessCheckOptions({ cwd: at, env: environment.env, runtime, harnessPlugin, ...(cwd === undefined ? {} : { projectConfigRoot: resolve(cwd) }) })
    const handle = query({ prompt: silentInput(stop.signal), options }) as QueryHandle
    // Nothing to read: the messages of its start (SessionStart hooks) are dropped, so none waits on a reader.
    void (async () => {
      const messages = handle[Symbol.asyncIterator]()
      while (!(await messages.next()).done);
    })().catch(() => undefined)
    // getHooksListing() is in sdk.mjs 0.3.322, but its sdk.d.ts declares only the request and the answer.
    const listing = handle as unknown as { getHooksListing(): Promise<unknown> }
    return {
      getHooksListing: () => listing.getHooksListing(),
      close: () => {
        stop.abort()
        handle.close()
      },
    }
  }
}

/** The query of the MCP inventory: Claude Code through the Agent SDK, or the fake agent under WORFY_AGENT=fake. */
export function inventoryStarterFromEnv(env: NodeJS.ProcessEnv = process.env): InventoryQueryStarter {
  if (env.WORFY_AGENT !== 'fake') return sdkInventoryStarter()
  return fakeInventoryStarter(fakeOptionsFromEnv(env))
}
