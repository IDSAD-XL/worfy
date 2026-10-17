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
  Query,
  SDKAssistantMessage,
  SDKCompactBoundaryMessage,
  SDKResultSuccess,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import type { QueryHandle } from '../../src/main/agent/session'

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
  'capture the SDK messages again for this SDK (scripts/spikes/sdk-probe.ts — a paid run, only on the owner’s word, in the PR that raises the SDK) and write manifest.json with `node scripts/sdk-compat.mjs manifest`'

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
]

const covers = (exception: Exception, kind: string, path?: string, type?: string): boolean => {
  if (exception.kind !== kind) return false
  if (exception.path === undefined) return true
  if (path === undefined) return false
  const under = path === exception.path || path.startsWith(`${exception.path}.`) || path.startsWith(`${exception.path}[`)
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
        if (!excused(kind, path)) invented.push(`${where}: ${kind} ${path} — no captured ${kind} has this key`)
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
] as const satisfies readonly (keyof QueryHandle)[]

describe('the SDK Query against worfy’s QueryHandle', () => {
  it('has every method of QueryHandle with a signature worfy can call (tsc)', () => {
    // Pick<> fails when Query lost a method of QueryHandle; toExtend when one changed so that the
    // SDK's query no longer fits worfy's handle. Required<>: the optional methods too.
    expectTypeOf<Pick<Query, keyof QueryHandle>>().toExtend<Required<QueryHandle>>()
    expectTypeOf<(typeof HANDLE_METHODS)[number]>().toEqualTypeOf<Exclude<keyof QueryHandle, typeof Symbol.asyncIterator>>()
    // The manifest of the captured messages lists them as well.
    expect(HANDLE_METHODS.filter((name) => !Object.hasOwn(manifest.queryMethods, name))).toEqual([])
  })
})
