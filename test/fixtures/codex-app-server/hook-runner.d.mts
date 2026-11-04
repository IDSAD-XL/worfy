// Types of test/fixtures/codex-app-server/hook-runner.mjs for the tests that import it.
export declare const KNOWN_EVENTS: readonly string[]
export declare const PLAYED_EVENTS: readonly string[]

/** One hook handler of an installed plugin, as loadHooks gives it. */
export interface HookHandler {
  key: string
  event: string
  matcher: string | null
  match: (names: string[]) => boolean
  declared: { type: string; command?: string; commandWindows?: string; command_windows?: string; timeout?: number; async?: boolean; statusMessage?: string; additionalContextLimit?: number }
  displayOrder: number
  sourcePath: string
  pluginId: string
  pluginRoot: string
  pluginData: string
  state: { enabled?: boolean; trusted_hash?: string; trusted_content_hash?: string }
}

/** A hook run of the app-server protocol (v2 HookRunSummary). */
export interface HookRun {
  id: string
  eventName: string
  status: 'running' | 'completed' | 'failed' | 'blocked' | 'stopped'
  entries: { kind: string; text: string }[]
  [field: string]: unknown
}

export interface HookOutcome {
  status: HookRun['status']
  entries: { kind: string; text: string }[]
  block?: string
  stop?: string
  context?: string
}

export interface HookFields {
  sessionId: string
  turnId?: string
  agentId?: string
  agentType?: string
  transcriptPath?: string | null
  agentTranscriptPath?: string | null
  cwd: string
  model?: string
  permissionMode?: string
  toolName?: string
  toolInput?: unknown
  toolUseId?: string
  stopHookActive?: boolean
  lastAssistantMessage?: string | null
  source?: string
}

export declare function pluginFingerprint(root: string): string
/** The hash of a hook's declaration, as Codex's hook_hash computes it: what trusted_hash must equal. */
export declare function declarationHash(handler: Pick<HookHandler, 'event' | 'matcher' | 'declared'>): string
export declare function readCodexConfig(codexHome: string): { hooks: Map<string, Record<string, unknown>>; plugins: Map<string, Record<string, unknown>> }
export declare function approvePluginHooks(codexHome: string): string[]
/** The answer of `hooks/list` (HooksListResponse) for the plugins installed in `codexHome`. */
export declare function hooksList(codexHome: string | undefined, cwds?: readonly string[]): { data: { cwd: string; hooks: Record<string, unknown>[]; warnings: string[]; errors: { path: string; message: string }[] }[] }
export declare function installedPlugins(codexHome: string): { id: string; root: string; data: string }[]
export declare function loadHooks(codexHome: string, options?: { all?: boolean }): { handlers: HookHandler[]; warnings: string[] }
export declare function hookInput(event: string, fields: HookFields): Record<string, unknown>
export declare function matchNames(event: string, value: string): string[]
export declare function timeoutSec(event: string, declared: number | undefined): number
export declare function outcomeOf(event: string, result: { code: number | null; stdout: string; stderr: string; timedOut: boolean; seconds: number }): HookOutcome
export declare function runHooks(
  handlers: readonly HookHandler[],
  event: string,
  options: { input: Record<string, unknown>; matchValue: string; cwd: string; onStarted?: (run: HookRun) => void; onCompleted?: (run: HookRun) => void },
): Promise<{ block?: string; stop?: string; fragments: { hookRunId: string; text: string }[]; contexts: string[]; runs: HookRun[] }>
