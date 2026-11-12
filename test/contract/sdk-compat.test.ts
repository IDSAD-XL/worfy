// What ties worfy to the Agent SDK version it pins (@anthropic-ai/claude-agent-sdk in package.json):
//   - the captured SDK messages (test/fixtures/sdk-messages/) were captured with that SDK and its
//     Claude Code, as their manifest.json says — raising the SDK without a new capture is red;
//   - the fake agent (src/main/agent/fake-query.ts, scenarios in test/fixtures/agent-scripts/) plays
//     only message shapes the real SDK sent: kinds, key paths and JSON types of the captures
//     (scripts/sdk-compat.mjs), so contract tests on the fake agent do not pass on an invented form;
//   - the methods worfy calls on a query (QueryHandle) exist on the SDK's Query with a signature
//     worfy can call — checked by tsc (`pnpm typecheck`), not at run time.
// Never starts Claude Code or the SDK.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  McpServerStatus,
  Query,
  SDKControlReloadPluginsResponse,
  SDKAssistantMessage,
  SDKCompactBoundaryMessage,
  SDKRateLimitInfo,
  SDKResultSuccess,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import type { QueryHandle } from '../../src/main/agent/session'
import type { ClaudeUserMessage } from '../../src/main/agent/session/types'
import { mcpServerRowsOf } from '../../src/shared/vendors/claude/events'

const ROOT = join(import.meta.dirname, '..', '..')
const CAPTURED = join(ROOT, 'test', 'fixtures', 'sdk-messages')
const SCRIPTS = join(ROOT, 'test', 'fixtures', 'agent-scripts')
const COMPAT_SCRIPTS = join(ROOT, 'test', 'fixtures', 'sdk-compat', 'fake-scripts')
const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk'

interface Manifest {
  sdk: string
  claudeCode: string
  queryMethods: Record<string, string>
}
type Shape = Record<string, string[]>
interface SdkCompat {
  kindOf(message: unknown): string
  shapeOf(message: unknown): Shape
  shapesOf(messages: unknown[]): Record<string, Shape>
  readMessages(file: string): unknown[]
  manifestOf(sdkFolder: string): Manifest
  installedSdk(): string
}
const { kindOf, shapeOf, shapesOf, readMessages, manifestOf, installedSdk } = (await import(pathToFileURL(join(ROOT, 'scripts', 'sdk-compat.mjs')).href)) as SdkCompat

const manifest = JSON.parse(readFileSync(join(CAPTURED, 'manifest.json'), 'utf8')) as Manifest
const capturedFiles = readdirSync(CAPTURED)
  .filter((name) => name.endsWith('.jsonl'))
  .sort()
const captured = capturedFiles.flatMap((name) => readMessages(join(CAPTURED, name)).map((message) => ({ file: name, message })))
const capturedShapes = shapesOf(captured.map(({ message }) => message))

const RECAPTURE =
  'capture the SDK messages again for this SDK (scripts/spikes/sdk-probe.ts, and scripts/spikes/harness-plugin/probe.ts for plugin-*.jsonl — paid runs, only on the owner’s word, in the PR that raises the SDK; test/fixtures/sdk-messages/README.md) and write manifest.json with `node scripts/sdk-compat.mjs manifest`'

describe('the pinned SDK and its captured messages', () => {
  it('package.json pins exactly the SDK version the messages were captured with', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(pkg.dependencies[SDK_PACKAGE], RECAPTURE).toBe(manifest.sdk)
  })

  it('the installed SDK is that version, with the Claude Code and the Query methods of the manifest', () => {
    expect(manifestOf(installedSdk()), RECAPTURE).toEqual(manifest)
  })

  it('every captured system/init comes from the Claude Code of the manifest', () => {
    const inits = captured.filter(({ message }) => kindOf(message) === 'system/init')
    expect(inits.length).toBeGreaterThan(0)
    const versions = inits.map(({ file, message }) => ({ file, version: (message as { claude_code_version?: unknown }).claude_code_version }))
    expect(versions, RECAPTURE).toEqual(inits.map(({ file }) => ({ file, version: manifest.claudeCode })))
  })
})

/**
 * A shape the fake agent plays that no capture has, and why it may: the whole kind (no `path`), a
 * key path and everything under it, or one more JSON `type` at a path. Each names, through
 * `satisfies`, the declaration of the pinned SDK that allows it, so tsc fails when the SDK drops it.
 */
interface Exception {
  kind: string
  path?: string
  type?: string
  /** Only that key path itself, not what is under it. */
  exact?: true
  reason: string
}

const EXCEPTIONS: readonly Exception[] = [
  {
    kind: 'system/compact_boundary' satisfies `system/${SDKCompactBoundaryMessage['subtype']}`,
    reason: 'no captured session compacted its context; context.jsonl plays a compaction (worfy-polish 23)',
  },
  {
    kind: 'system/task_progress' satisfies `system/${SDKTaskProgressMessage['subtype']}`,
    reason: 'the captured background task (background-tasks.jsonl) finished before Claude Code reported progress',
  },
  {
    kind: 'system/task_started',
    path: 'subagent_type' satisfies keyof SDKTaskStartedMessage,
    reason: 'the captured tasks are Bash background tasks; a Subagent task names its type, and no capture ran a Subagent',
  },
  {
    kind: 'system/task_started',
    path: 'spawn_depth' satisfies keyof SDKTaskStartedMessage,
    reason: 'set on Subagent tasks; no capture ran a Subagent',
  },
  {
    kind: 'system/task_notification',
    path: 'usage' satisfies keyof SDKTaskNotificationMessage,
    reason: 'the captured notification is of a Bash background task, which reports no usage',
  },
  {
    kind: 'result/success',
    path: 'structured_output' satisfies keyof SDKResultSuccess,
    reason: 'set only when the query asks for an output format (Draft profile, profile-draft.jsonl); no capture asked for one',
  },
  {
    kind: 'assistant',
    path: 'parent_tool_use_id' satisfies keyof SDKAssistantMessage,
    type: typeof ('toolu_example' satisfies SDKAssistantMessage['parent_tool_use_id']),
    reason: 'the messages of a Subagent carry the tool use that started it; no capture ran a Subagent',
  },
  // The account of the 2026-11-10 capture (Claude Code 2.1.322) has no five-hour window, the
  // 2026-10-05 one (2.1.289) had it as { utilization, resetsAt }; the Limits scenarios keep playing
  // it for plans that have one (worfy-polish 100). Each key of that shape by itself, with its type.
  ...(
    [
      ['', 'object'],
      ['.utilization', 'number'],
      ['.resetsAt', 'number'],
    ] as const
  ).map(
    ([key, type]): Exception => ({
      kind: 'rate_limit_event',
      path: `rate_limit_info.unifiedWindows.${'five_hour' satisfies NonNullable<SDKRateLimitInfo['rateLimitType']>}${key}`,
      type,
      exact: true,
      reason: 'the five-hour window of the 2026-10-05 capture, which the 2026-11-10 capture has not got (worfy-polish 100)',
    }),
  ),
]

const covers = (exception: Exception, kind: string, path?: string, type?: string): boolean => {
  if (exception.kind !== kind) return false
  if (exception.path === undefined) return true
  if (path === undefined) return false
  const under = path === exception.path || (exception.exact !== true && (path.startsWith(`${exception.path}.`) || path.startsWith(`${exception.path}[`)))
  if (!under) return false
  return exception.type === undefined || exception.type === type
}

interface Played {
  /** `<scenario>:<line>`, or what played the message. */
  where: string
  message: unknown
}

/**
 * Each shape of the messages no capture has, one line each, with where it was played; and which
 * exceptions let a shape through.
 */
function inventedShapes(played: readonly Played[], captures: Record<string, Shape>, exceptions: readonly Exception[]) {
  const invented: string[] = []
  const used = new Set<Exception>()
  const excused = (kind: string, path?: string, type?: string): boolean => {
    const exception = exceptions.find((candidate) => covers(candidate, kind, path, type))
    if (exception !== undefined) used.add(exception)
    return exception !== undefined
  }
  for (const { where, message } of played) {
    const kind = kindOf(message)
    const known = captures[kind]
    if (known === undefined) {
      if (!excused(kind)) invented.push(`${where}: ${kind} — no captured message of this kind`)
      continue
    }
    for (const [path, types] of Object.entries(shapeOf(message))) {
      const knownTypes = known[path]
      if (knownTypes === undefined) {
        if (!types.every((type) => excused(kind, path, type))) invented.push(`${where}: ${kind} ${path} — no captured ${kind} has this key`)
        continue
      }
      for (const type of types) {
        if (!knownTypes.includes(type) && !excused(kind, path, type)) invented.push(`${where}: ${kind} ${path} is ${type}, captured: ${knownTypes.join('|')}`)
      }
    }
  }
  return { invented, used }
}

/** The SDK messages the fake scenarios play as they are written; directives (`{"fake": …}`) are not messages. */
function scriptedMessages(): Played[] {
  return readdirSync(SCRIPTS)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .flatMap((name) =>
      readFileSync(join(SCRIPTS, name), 'utf8')
        .split('\n')
        .flatMap((line, index) => {
          if (line.trim() === '') return []
          const value = JSON.parse(line) as Record<string, unknown>
          return 'fake' in value ? [] : [{ where: `${name}:${index + 1}`, message: value }]
        }),
    )
}

/**
 * The messages the fake agent makes itself: a `permission` line becomes an assistant tool_use and
 * a user tool_result, allowed (`ls`) and refused (`rm`). Played by the fake agent itself, so a
 * change of fake-query.ts is checked too.
 */
async function generatedMessages(): Promise<Played[]> {
  const query = await fakeQueryFactory({ scriptsDir: COMPAT_SCRIPTS, script: 'permission' })({
    prompt: (async function* (): AsyncGenerator<SDKUserMessage> {})(),
    cwd: ROOT,
    resume: undefined,
    stderr: () => {},
    settings: { model: null, effort: null, permissionMode: 'default' },
    canUseTool: (_tool, input) =>
      Promise.resolve(input.command === 'ls' ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user refused' }),
  })
  const played: Played[] = []
  for await (const message of query) played.push({ where: `fake-query.ts, permission line (${played.length + 1})`, message })
  query.close()
  return played
}

describe('the fake agent plays only shapes the real SDK sent', () => {
  it('every message of the fake scenarios has a kind, keys and types of the captured messages', () => {
    const played = scriptedMessages()
    expect(played.length).toBeGreaterThan(0)
    expect(inventedShapes(played, capturedShapes, EXCEPTIONS).invented).toEqual([])
  })

  it('so do the messages the fake agent makes for a permission line', async () => {
    const played = await generatedMessages()
    expect(played.map(({ message }) => kindOf(message))).toEqual(['assistant', 'user', 'assistant', 'user'])
    expect(inventedShapes(played, capturedShapes, EXCEPTIONS).invented).toEqual([])
  })

  it('every exception is still needed', async () => {
    const { used } = inventedShapes([...scriptedMessages(), ...(await generatedMessages())], capturedShapes, EXCEPTIONS)
    expect(EXCEPTIONS.filter((exception) => !used.has(exception))).toEqual([])
  })

  it('names the scenario and the key of a shape no capture has', () => {
    const [first] = scriptedMessages().filter(({ message }) => kindOf(message) === 'system/init')
    if (first === undefined) throw new Error('no scripted system/init')
    const invented = { ...(first.message as object), invented_key: 1, permissionMode: 2 }
    expect(inventedShapes([{ where: first.where, message: invented }], capturedShapes, EXCEPTIONS).invented).toEqual([
      `${first.where}: system/init permissionMode is number, captured: string`,
      `${first.where}: system/init invented_key — no captured system/init has this key`,
    ])
  })

  it('names a kind no capture has, unless an exception lets it through', () => {
    const message = { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 1 } }
    expect(inventedShapes([{ where: 'x.jsonl:1', message }], capturedShapes, []).invented).toEqual(['x.jsonl:1: system/compact_boundary — no captured message of this kind'])
    expect(inventedShapes([{ where: 'x.jsonl:1', message }], capturedShapes, EXCEPTIONS).invented).toEqual([])
  })
})

/** The methods of QueryHandle, at run time; tsc keeps the list whole. */
const HANDLE_METHODS = [
  'interrupt',
  'close',
  'accountInfo',
  'setModel',
  'setPermissionMode',
  'applyFlagSettings',
  'supportedModels',
  'supportedCommands',
  'getContextUsage',
  'mcpServerStatus',
  'reconnectMcpServer',
  'reloadPlugins',
] as const satisfies readonly (keyof QueryHandle)[]

type HandleMethod = Exclude<keyof QueryHandle, typeof Symbol.asyncIterator>
type Handle = Required<QueryHandle>
/** A query as far as QueryHandle reaches: one that lacks a method of it does not satisfy this. */
type QueryLike = Record<HandleMethod, (...args: never) => unknown>

/**
 * The methods of QueryHandle whose arguments, as worfy passes them, query Q does not take. Parameter
 * tuples are compared one way — unlike method parameters, which TypeScript compares both ways, so
 * a parameter the SDK narrowed would still fit a whole-method comparison.
 */
type ArgumentMismatch<Q extends QueryLike> = {
  [K in HandleMethod]: Parameters<Handle[K]> extends Parameters<Q[K]> ? never : K
}[HandleMethod]

/** The methods of QueryHandle whose result from query Q is not what worfy reads. */
type ResultMismatch<Q extends QueryLike> = {
  [K in HandleMethod]: ReturnType<Q[K]> extends ReturnType<Handle[K]> ? never : K
}[HandleMethod]

/** The SDK's Query with one method changed, as a new SDK version might have it. */
type QueryWith<K extends HandleMethod, F> = Omit<Query, K> & Record<K, F>

describe('the SDK Query against worfy’s QueryHandle', () => {
  it('has every method of QueryHandle, taking the arguments worfy passes and giving what worfy reads (tsc)', () => {
    // QueryLike fails when Query lost a method of QueryHandle, the two mismatches when one changed.
    expectTypeOf<ArgumentMismatch<Query>>().toBeNever()
    expectTypeOf<ResultMismatch<Query>>().toBeNever()
    // The whole query fits worfy's handle, the async iterator included. Required<>: the optional methods too.
    expectTypeOf<Pick<Query, keyof QueryHandle>>().toExtend<Handle>()
    expectTypeOf<(typeof HANDLE_METHODS)[number]>().toEqualTypeOf<HandleMethod>()
    // The manifest of the captured messages lists them as well.
    expect(HANDLE_METHODS.filter((name) => !Object.hasOwn(manifest.queryMethods, name))).toEqual([])
  })

  it('refuses a Query that narrowed a parameter, made one required, changed a result or lost a method (tsc)', () => {
    expectTypeOf<ArgumentMismatch<QueryWith<'setPermissionMode', (mode: 'default') => Promise<void>>>>().toEqualTypeOf<'setPermissionMode'>()
    expectTypeOf<ArgumentMismatch<QueryWith<'setModel', (model: string) => Promise<void>>>>().toEqualTypeOf<'setModel'>()
    expectTypeOf<ArgumentMismatch<QueryWith<'getContextUsage', (opts?: { detail?: 'full' }) => Promise<unknown>>>>().toEqualTypeOf<'getContextUsage'>()
    expectTypeOf<ResultMismatch<QueryWith<'supportedModels', () => Promise<string[]>>>>().toEqualTypeOf<'supportedModels'>()
    expectTypeOf<ArgumentMismatch<QueryWith<'reconnectMcpServer', (serverName: number) => Promise<void>>>>().toEqualTypeOf<'reconnectMcpServer'>()
    expectTypeOf<ResultMismatch<QueryWith<'reconnectMcpServer', (serverName: string) => Promise<string>>>>().toEqualTypeOf<'reconnectMcpServer'>()
    // @ts-expect-error a Query without getContextUsage is no QueryLike
    expectTypeOf<ArgumentMismatch<Omit<Query, 'getContextUsage'>>>().toBeNever()
    // @ts-expect-error a Query without mcpServerStatus is no QueryLike
    expectTypeOf<ArgumentMismatch<Omit<Query, 'mcpServerStatus'>>>().toBeNever()
  })
})

describe('the MCP calls of the SDK against what worfy reads of them (worfy-mcp-live ticket 02)', () => {
  it('mcpServerStatus() answers rows with the fields a row of worfy shows, of the types it reads them as (tsc)', () => {
    expectTypeOf<McpServerStatus['name']>().toEqualTypeOf<string>()
    // The statuses worfy knows (mcpServerRowsOf leaves out a row of any other): a new one fails here first.
    expectTypeOf<McpServerStatus['status']>().toEqualTypeOf<'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'>()
    expectTypeOf<McpServerStatus['error']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<McpServerStatus['source']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<NonNullable<McpServerStatus['tools']>>().toExtend<readonly unknown[]>()
    expectTypeOf<ReturnType<Query['mcpServerStatus']>>().toEqualTypeOf<Promise<McpServerStatus[]>>()
    expectTypeOf<Parameters<Query['reconnectMcpServer']>>().toEqualTypeOf<[serverName: string]>()
    expectTypeOf<ReturnType<Query['reconnectMcpServer']>>().toEqualTypeOf<Promise<void>>()
  })

  it('the manifest of the pinned SDK has both calls with these signatures', () => {
    expect(manifest.queryMethods['mcpServerStatus'], RECAPTURE).toBe('mcpServerStatus(): Promise<McpServerStatus[]>;')
    expect(manifest.queryMethods['reconnectMcpServer'], RECAPTURE).toBe('reconnectMcpServer(serverName: string): Promise<void>;')
  })

  it('every server of every recorded answer of the spike becomes a row: none is left out as unreadable', () => {
    const dir = join(ROOT, 'test', 'fixtures', 'mcp-live')
    const lists = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .flatMap((name) => {
        const value = JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown
        const record = value as { status_after?: unknown; answer?: { mcpServers?: unknown } }
        const found = [Array.isArray(value) ? value : null, record.status_after, record.answer?.mcpServers].filter((list): list is unknown[] => Array.isArray(list) && list.length > 0 && typeof list[0] === 'object' && list[0] !== null && 'status' in list[0])
        return found.map((list) => ({ name, list }))
      })
    expect(lists.length).toBeGreaterThan(10)
    for (const { name, list } of lists) expect(mcpServerRowsOf(list)?.length, name).toBe(list.length)
  })
})

describe('the call that takes in a server added while the query runs (worfy-mcp-live ticket 03)', () => {
  it('reloadPlugins() takes no argument worfy must pass and answers the servers as mcpServerStatus() does (tsc)', () => {
    // worfy calls it bare: no holdOnCacheImpact, no addPlugins (the spike's call, F:allowed-reload-plugins).
    expectTypeOf<[]>().toExtend<Parameters<Query['reloadPlugins']>>()
    expectTypeOf<ReturnType<Query['reloadPlugins']>>().toEqualTypeOf<Promise<SDKControlReloadPluginsResponse>>()
    expectTypeOf<SDKControlReloadPluginsResponse['mcpServers']>().toEqualTypeOf<McpServerStatus[]>()
  })

  it('the manifest of the pinned SDK has it with this signature', () => {
    expect(manifest.queryMethods['reloadPlugins'], RECAPTURE).toBe('reloadPlugins(options?: {holdOnCacheImpact?: boolean; addPlugins?: SdkPluginConfig[];}): Promise<SDKControlReloadPluginsResponse>;')
  })

  it('the recorded answer of the spike has its servers where worfy reads them, each a row', () => {
    const recorded = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'mcp-live', 'mcp-live-allowed-reload-plugins.json'), 'utf8')) as { answer: { mcpServers: unknown[] } }
    expect(mcpServerRowsOf(recorded.answer.mcpServers)?.map((row) => [row.name, row.status, row.source])).toEqual([
      ['example-notes', 'pending', 'user'],
      ['worfy-canvas', 'connected', 'worfy'],
    ])
  })
})

describe('the sign-in to an MCP server (worfy-mcp-live ticket 05)', () => {
  it('the installed SDK’s query has mcpAuthenticate(serverName, …), a control request mcp_authenticate, though sdk.d.ts does not name it', () => {
    // Undocumented: the Claude driver reads it off the query at run time (src/main/vendors/claude/mcp.ts) and
    // offers no Sign in without it. A SDK that drops or renames it turns this red before the button breaks.
    const code = readFileSync(join(installedSdk(), 'sdk.mjs'), 'utf8')
    expect(code).toMatch(/mcpAuthenticate\(\w+,\w+,\w+\)\{return\(await this\.request\(\{subtype:"mcp_authenticate",serverName:\w+/u)
    expect(readFileSync(join(installedSdk(), 'sdk.d.ts'), 'utf8')).not.toContain('mcpAuthenticate')
  })

  it('the recorded answer has what the driver reads of it: the page to open and whether Claude Code waits for the callback', () => {
    const recorded = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'mcp-live', 'mcp-live-oauth-authenticate.json'), 'utf8')) as { answer: Record<string, unknown> }
    // The scrub kept the page as its parts (origin, path, parameter names); the live answer has it as a string.
    expect(Object.keys(recorded.answer).sort()).toEqual(['authUrl', 'callbackExpected', 'callbackPort', 'redirectScheme', 'requiresUserAction', 'state'])
    expect(recorded.answer.callbackExpected).toBe(true)
  })
})

describe('the SDK user message against the one worfy writes', () => {
  it('a ClaudeUserMessage is an SDKUserMessage, image blocks of an attachment included (tsc)', () => {
    // QueryRequest.prompt is typed loosely while src/main/projects/connect.ts still hands it the
    // SDK's own type (worfy-multi-vendor ticket 16): this check holds what the Claude driver writes.
    expectTypeOf<ClaudeUserMessage>().toExtend<SDKUserMessage>()
  })
})
