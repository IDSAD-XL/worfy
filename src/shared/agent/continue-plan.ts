// The plan of a retry after a temporary API error (worfy-retry ticket 03): how long to pause before
// each retry, when to stop retrying, which actions of the failed turn reached outside the Session,
// and the text the Orchestrator gets instead of its original message.
//
// Pure: no timers, no clock, no randomness of its own. The caller passes the attempt number and a
// random number, keeps the count of attempts and resets it after a turn that ends without an error
// (worfy-retry tickets 04 and 06).
//
// The rule for external actions (spec, Q9 (a)) is safe by default:
// - The turn is never sent again: the retry is a new message that asks the model to continue, and
//   it names what the turn already did outside the Session, so the model checks before it repeats.
// - An action that has a `tool_use` but no `tool_result` (the turn broke off while a push or a merge
//   was running) may or may not have happened: no retry (`in-flight`).
// - Local is what this module knows to be local; everything else may reach outside. A tool not in
//   LOCAL_TOOLS is external; an MCP tool of a server other than worfy's is external; a worfy MCP tool
//   must be classified here before it builds (WORFY_CANVAS_TOOLS, WORFY_BROWSER_TOOLS). A shell command
//   is external when it writes through git, gh, an HTTP client, ssh or a package registry, local when
//   every part of it is a known local program, and unclassified otherwise: an unclassified command
//   without a result refuses the retry like an external one, and with a result it keeps the text from
//   saying that nothing reached outside.
// Only the turn's own calls count (`parentToolUseId` null). A call inside a Subagent belongs to the
// Subagent: when the Agent call itself has its result, the Subagent goes on (or ended) on its own,
// and continuing the Orchestrator's turn does not repeat it; when it has none, the Agent call is the
// action in flight.
//
// The text names an action by worfy's own summary — program, subcommand and a short target such as
// a branch or a PR number — never by text the model wrote (a commit message, an Agent's description):
// the continuation is a message in the user's place, and the model's own words must not come back
// to it as instructions.
import { BROWSER_SERVER_NAME, type BrowserToolName } from '../browser/tools'
import { CANVAS_SERVER_NAME, type CanvasToolName } from '../canvas/tools'
import type { AgentEvent } from './events'
import type { TransientError, TurnFailure } from './turn-failure'

/**
 * The pause before each retry, by attempt (spec, Q3 (a)): 1, 5, 15, 30, 60 minutes, about 1 h 50 min
 * in all — an outage of the API is usually shorter than two hours, and a night run that gave up after
 * 20 minutes loses the night. Each pause is spread by JITTER so that several Sessions refused at once
 * do not come back at the same second.
 */
export const RETRY_DELAYS_MS: readonly number[] = [1, 5, 15, 30, 60].map((minutes) => minutes * 60_000)
/** Retries in a row before the caller gives up (`cap`); a turn that ends without an error resets the count. */
export const MAX_RETRIES = RETRY_DELAYS_MS.length
/** The spread of a pause: ±20 % of it. */
export const JITTER = 0.2

/**
 * The pause before retry `attempt` (1…MAX_RETRIES), spread by `random` in [0, 1): 0 gives the pause
 * less 20 %, 0.5 the pause itself, a number near 1 the pause plus 20 %.
 */
export function retryDelay(attempt: number, random: number): number {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_RETRIES) throw new RangeError(`retry attempt ${attempt} is not 1…${MAX_RETRIES}`)
  if (!(random >= 0 && random < 1)) throw new RangeError(`random ${random} is not in [0, 1)`)
  const base = RETRY_DELAYS_MS[attempt - 1] as number
  return Math.round(base * (1 - JITTER + 2 * JITTER * random))
}

/** One call of a turn that changed, or may have changed, something outside the Session. */
export interface ExternalAction {
  toolUseId: string
  /** The tool's name: `Bash`, `Agent`, `mcp__worfy-canvas__create_card`, … */
  tool: string
  /** worfy's own short summary of the call: `git push origin main`, `gh pr merge 12`, `Agent`. */
  description: string
  /** The call has its `tool_result`: it ran (successfully or not). False: it may or may not have run. */
  done: boolean
  /** True: the call is known to reach outside. False: a shell command worfy could not classify; it may. */
  known: boolean
}

/** Tools that run a command line: Claude Code's Bash and PowerShell (on Windows), Codex's `commandExecution`. */
const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell', 'commandExecution'])
/** Tools that start work which goes on outside the turn: a Subagent (`Agent`; `Task` before 2.1.222), a workflow script. */
const AGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task', 'Workflow'])
/** A message to another agent. */
const SEND_TOOL = 'SendMessage'
/**
 * Tools that act only on this machine or only read: files, search, the task list, reading the web,
 * questions to the person. Every tool not here (and not a shell, an Agent or an MCP tool) is external.
 */
const LOCAL_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'NotebookRead',
  'Glob',
  'Grep',
  'LS',
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'BashOutput',
  'WebFetch',
  'WebSearch',
  'ToolSearch',
  'Skill',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  // Codex's file edit.
  'fileChange',
])

/** Which tools of worfy's canvas MCP server change something (src/main/mcp/canvas-server.ts). */
const WORFY_CANVAS_TOOLS: Record<CanvasToolName, boolean> = {
  list_nodes: false,
  create_card: true,
  create_note: true,
  update_node: true,
  move_node: true,
  resize_node: true,
  hide_node: true,
  link_card: true,
  autopilot_start: true,
}
/** Which tools of worfy's Browser MCP server change something (src/main/mcp/browser-server.ts). */
const WORFY_BROWSER_TOOLS: Record<BrowserToolName, boolean> = {
  browser_list: false,
  browser_open: true,
  browser_navigate: true,
  browser_click: true,
  browser_type: true,
  browser_screenshot: false,
  browser_read: false,
  browser_console: false,
  browser_network: false,
}
const WORFY_MCP_TOOLS: ReadonlyMap<string, Readonly<Record<string, boolean>>> = new Map<string, Readonly<Record<string, boolean>>>([
  [CANVAS_SERVER_NAME, WORFY_CANVAS_TOOLS],
  [BROWSER_SERVER_NAME, WORFY_BROWSER_TOOLS],
])

/**
 * git subcommands that make a commit, move a branch or reach the remote: the ticket's list (commit,
 * push, merge, rebase, reset, tag) and the ones that make a commit or a merge the same way.
 */
const GIT_EXTERNAL: ReadonlySet<string> = new Set(['commit', 'push', 'merge', 'rebase', 'reset', 'tag', 'pull', 'cherry-pick', 'revert', 'am'])
/** git subcommands whose summary keeps their targets (a remote, a branch, a commit); the others carry a message. */
const GIT_TARGETED: ReadonlySet<string> = new Set(['push', 'merge', 'rebase', 'reset', 'pull', 'cherry-pick', 'revert'])
/**
 * git subcommands that only read, or only stage files in this repository (`add`): nothing leaves the
 * machine and no branch moves. Every subcommand that is neither here, nor in GIT_EXTERNAL, nor a read
 * form of GIT_READ_FORMS — `switch -C`, `branch -f`, `update-ref`, `send-email`, `svn dcommit`, an
 * alias — is unclassified.
 */
const GIT_READ: ReadonlySet<string> = new Set([
  'status', 'diff', 'log', 'show', 'fetch', 'ls-files', 'ls-tree', 'ls-remote', 'rev-parse', 'rev-list', 'describe',
  'blame', 'annotate', 'grep', 'shortlog', 'cat-file', 'show-ref', 'for-each-ref', 'name-rev', 'merge-base', 'diff-tree',
  'diff-index', 'diff-files', 'whatchanged', 'check-ignore', 'check-attr', 'var', 'count-objects', 'help', 'version',
  'range-diff', 'cherry', 'show-branch', 'verify-commit', 'verify-tag', 'add',
])
/** The words of a git command that are not options. */
const positionals = (args: readonly string[]): string[] => args.filter((arg) => !arg.startsWith('-'))
/** Options of `git branch` and `git tag` that list rather than create. */
const GIT_LIST_OPTIONS = /^(?:-l|--list|--contains|--no-contains|--merged|--no-merged|--points-at|-n\d*)(?:=|$)/
const GIT_BRANCH_WRITE = /^-[a-zA-Z]*[dDmMcCfut][a-zA-Z]*$|^--(?:delete|move|copy|force|set-upstream-to|unset-upstream|edit-description|track|create-reflog)(?:=|$)/
const GIT_TAG_WRITE = /^-[a-zA-Z]*[asufdmFe][a-zA-Z]*$|^--(?:annotate|sign|local-user|force|delete|message|file|edit|create-reflog)(?:=|$)/
/** git subcommands that change something in some forms and only read in others: the read forms. */
const GIT_READ_FORMS: Readonly<Record<string, (args: readonly string[]) => boolean>> = {
  branch: (args) => !args.some((arg) => GIT_BRANCH_WRITE.test(arg)) && (positionals(args).length === 0 || args.some((arg) => GIT_LIST_OPTIONS.test(arg))),
  config: (args) => {
    if (args.some((arg) => /^(?:--(?:unset|unset-all|add|replace-all|edit|rename-section|remove-section)|-e)$/.test(arg))) return false
    const [first, ...more] = positionals(args)
    // `git config get` and `git config list` (git 2.46) read; `set`, `unset`, … write.
    if (first === 'get' || first === 'list') return true
    return args.some((arg) => /^(?:--get|--get-all|--get-regexp|--get-urlmatch|--list|-l)$/.test(arg)) || (first !== undefined && more.length === 0)
  },
  remote: (args) => {
    const [first] = positionals(args)
    return first === undefined || first === 'show' || first === 'get-url'
  },
  worktree: (args) => positionals(args)[0] === 'list',
  stash: (args) => ['list', 'show'].includes(positionals(args)[0] ?? ''),
  reflog: (args) => !['expire', 'delete'].includes(positionals(args)[0] ?? ''),
}
/** git options before the subcommand that take the next word as their value (`git -C <path> push`). */
const GIT_VALUE_OPTIONS: ReadonlySet<string> = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env'])
/** gh commands that only read or act on this machine; every other `gh <group> <verb>` counts as external. */
const GH_READ_GROUPS: ReadonlySet<string> = new Set(['search', 'status', 'browse', 'help', 'version', 'completion'])
const GH_READ_VERBS: ReadonlySet<string> = new Set(['view', 'list', 'status', 'checks', 'diff', 'checkout', 'watch', 'download'])
/** `gh api` options that send a body: without -X, gh then sends a POST. */
const GH_API_BODY = /^(?:-[fF]|--field|--raw-field|--input)(?:=|$)|^-[fF]./
/** `gh api` options that take the next word as their value, so it is not the endpoint. */
const GH_API_VALUE_OPTIONS: ReadonlySet<string> = new Set(['-X', '--method', '-f', '-F', '--field', '--raw-field', '--input', '-H', '--header', '-q', '--jq', '-t', '--template', '--hostname', '-p', '--preview', '--cache'])
/** HTTP methods that only read. */
const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD'])
/**
 * curl's options as this module reads them. A short option takes a value when its letter is in
 * CURL_SHORT_VALUE (`-X POST`, `-XPOST`, `-sX POST`, `-sdx`); an option in neither list, or `-K` (a
 * config file of more options), makes the command unclassified.
 */
const CURL_SHORT_FLAGS: ReadonlySet<string> = new Set([...'fsSLvIiGkNnqO#0123456'])
const CURL_SHORT_VALUE: ReadonlySet<string> = new Set([...'XdFToHAuebcwmxrCYyzEKU'])
const CURL_LONG_FLAGS: ReadonlySet<string> = new Set([
  '--silent', '--show-error', '--fail', '--fail-with-body', '--location', '--location-trusted', '--verbose', '--include',
  '--head', '--get', '--insecure', '--compressed', '--http1.1', '--http2', '--progress-bar', '--globoff',
  '--no-progress-meter', '--remote-name', '--no-buffer', '--ipv4', '--ipv6', '--no-keepalive',
])
const CURL_LONG_VALUE: ReadonlySet<string> = new Set([
  '--request', '--data', '--data-raw', '--data-binary', '--data-urlencode', '--data-ascii', '--json', '--form',
  '--form-string', '--upload-file', '--config', '--output', '--output-dir', '--header', '--user-agent', '--user',
  '--referer', '--cookie', '--cookie-jar', '--write-out', '--max-time', '--connect-timeout', '--retry', '--retry-delay',
  '--retry-max-time', '--proxy', '--url', '--cacert', '--cert', '--key', '--resolve', '--limit-rate', '--oauth2-bearer',
  '--range',
])
/** curl options (by their long name or letter) that send a body: curl then sends POST, or PUT for an upload. */
const CURL_BODY: ReadonlySet<string> = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode', '--data-ascii', '--json', '-F', '--form', '--form-string'])
const WGET_BODY = /^--(?:post-data|post-file|body-data|body-file)(?:=|$)/
/** PowerShell's HTTP cmdlets and their aliases. */
const PS_HTTP: ReadonlySet<string> = new Set(['invoke-webrequest', 'invoke-restmethod', 'iwr', 'irm'])
/** Programs that always reach another machine. */
const REMOTE_SHELLS: ReadonlySet<string> = new Set(['ssh', 'scp', 'sftp'])
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(['npm', 'pnpm', 'yarn', 'bun'])
/** Package manager commands that change a registry. */
const PM_EXTERNAL: ReadonlySet<string> = new Set(['publish', 'unpublish', 'deprecate', 'dist-tag', 'owner'])
/** Package manager commands that act only here (`install` reads the registry and writes node_modules). */
const PM_LOCAL: ReadonlySet<string> = new Set(['install', 'i', 'ci', 'list', 'ls', 'why', 'outdated'])
/** Package manager commands that run a script or a tool named by the next word. */
const PM_RUNNERS: ReadonlySet<string> = new Set(['run', 'exec', 'dlx', 'x'])
/** Scripts and tools of a package that only check or build here; `test:e2e` counts by its part before the colon. */
const LOCAL_SCRIPTS: ReadonlySet<string> = new Set(['test', 't', 'lint', 'typecheck', 'build', 'format', 'check', 'vitest', 'tsc', 'eslint', 'prettier', 'playwright'])
/** Shells whose `-c` (PowerShell: `-Command`) string is a command line of its own. */
const SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash', 'pwsh', 'powershell'])
/** Programs that run the command after their own options: `env A=1 cmd`, `timeout 10 cmd`, `nohup cmd`. */
const PREFIXES: ReadonlySet<string> = new Set(['env', 'time', 'nice', 'nohup', 'command', 'builtin', 'timeout'])
/** Shell keywords: the command after them is the one that runs; a loop header alone runs nothing. */
const KEYWORDS: ReadonlySet<string> = new Set(['if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'do', 'done', 'esac', '!', '{', '}'])
/** Headers that run nothing themselves: `for f in a b`, `case $x in a` (a `$(…)` in them is a command of its own). */
const HEADERS: ReadonlySet<string> = new Set(['for', 'select', 'case'])
/**
 * Programs that act only on this machine, whatever their arguments. gh, wget and rsync are here too:
 * their writes are told apart first (externalCommand), and what is left of them only reads. git, curl
 * and PowerShell's HTTP cmdlets are not: they are local only in the forms their own reading finds
 * local (gitVerdict, curlVerdict, psHttpVerdict). find, node, python and awk are local unless they run
 * a command or code of their own (isLocal).
 */
const LOCAL_PROGRAMS: ReadonlySet<string> = new Set([
  'gh', 'wget', 'rsync',
  'cd', 'pwd', 'ls', 'cat', 'head', 'tail', 'less', 'grep', 'egrep', 'rg', 'find', 'fd', 'wc', 'sort', 'uniq', 'cut', 'tr',
  'sed', 'awk', 'jq', 'diff', 'cmp', 'comm', 'echo', 'printf', 'true', 'false', 'test', '[', '[[', 'export', 'set', 'unset',
  'sleep', 'date', 'which', 'type', 'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'touch', 'ln', 'chmod', 'stat', 'du', 'df', 'file',
  'basename', 'dirname', 'realpath', 'readlink', 'tee', 'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'shasum', 'ps', 'pgrep',
  'uname', 'whoami', 'seq', 'wait', 'exit', 'node', 'python', 'python3', 'tsc', 'vitest', 'eslint', 'prettier',
  'get-content', 'get-childitem', 'select-string', 'set-location', 'write-output', 'write-host', 'test-path', 'get-item',
  'select-object', 'where-object', 'foreach-object', 'sort-object', 'measure-object', 'out-null',
])

/** A target word kept in a summary: a branch, a remote, a PR number, an endpoint — one short word, no prose. */
const SAFE_WORD = /^[\w./#:@+?&=%~-]{1,80}$/
/** Longest summary kept of an action. */
const DESCRIPTION_MAX = 160

/** The external and unclassified calls of a turn, given its events, in the order they were called. */
export function externalActions(events: readonly AgentEvent[]): ExternalAction[] {
  const results = new Set<string>()
  for (const event of events) if (event.type === 'tool_result') results.add(event.toolUseId)
  const actions: ExternalAction[] = []
  const seen = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool_use' || event.parentToolUseId !== null || seen.has(event.id)) continue
    seen.add(event.id)
    const found = classifyCall(event.name, event.input)
    if (found !== null) actions.push({ toolUseId: event.id, tool: event.name, description: shorten(found.description), done: results.has(event.id), known: found.known })
  }
  return actions
}

interface Found {
  description: string
  known: boolean
}

/** What the call may have done outside the Session, or null when it is local. */
function classifyCall(tool: string, input: unknown): Found | null {
  const fields = record(input)
  if (SHELL_TOOLS.has(tool)) {
    const verdict = classifyLine(commandText(fields.command))
    if (fields.run_in_background === true) return { description: `background task: ${verdict.all.join('; ')}`, known: true }
    if (verdict.external.length > 0) return { description: verdict.external.join('; '), known: true }
    return verdict.unclassified.length > 0 ? { description: verdict.unclassified.join('; '), known: false } : null
  }
  if (AGENT_TOOLS.has(tool)) {
    const kind = safe(fields.subagent_type) ?? safe(fields.name)
    return { description: kind === null ? tool : `${tool} (${kind})`, known: true }
  }
  if (tool === SEND_TOOL) {
    const to = safe(fields.to)
    return { description: to === null ? 'SendMessage' : `SendMessage to ${to}`, known: true }
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (mcp !== null) {
    const known = WORFY_MCP_TOOLS.get(mcp[1] as string)
    // An MCP tool worfy does not know may change anything: read the safe way.
    return known !== undefined && known[mcp[2] as string] === false ? null : { description: safe(tool) ?? 'an MCP tool', known: true }
  }
  if (LOCAL_TOOLS.has(tool)) return null
  return { description: safe(tool) ?? 'a tool', known: true }
}

interface LineVerdict {
  /** Summaries of the simple commands that write outside. */
  external: string[]
  /** Summaries of the simple commands that are neither known local nor known external. */
  unclassified: string[]
  /** Summaries of every simple command. */
  all: string[]
}

/** How the simple commands of a command line read: external, unclassified or local. */
function classifyLine(line: string): LineVerdict {
  const verdict: LineVerdict = { external: [], unclassified: [], all: [] }
  for (const words of shellSegments(line)) {
    const external = externalCommand(words)
    if (external !== null) {
      verdict.external.push(...external)
      verdict.all.push(...external)
      continue
    }
    const summary = commandSummary(words)
    verdict.all.push(summary)
    if (!isLocal(words)) verdict.unclassified.push(summary)
  }
  return verdict
}

/**
 * The summaries of what a simple command writes outside, or null when it writes nothing known. A
 * program anywhere in the command counts (`xargs git push`, `find … -exec curl -d …`), and so does a
 * quoted command inside it (`bash -c 'git push'`, `ssh host "cd x && git push"`): a false «external»
 * is safer than a miss.
 */
function externalCommand(words: readonly string[]): string[] | null {
  for (let i = 0; i < words.length; i++) {
    const summary = externalAt(words, i)
    if (summary !== null) return [summary]
  }
  const nested: string[] = []
  // The quotes are gone from the word, so each level is shorter than the one above it.
  for (const word of words) if (/\s/.test(word)) nested.push(...classifyLine(word).external)
  return nested.length > 0 ? nested : null
}

/** The summary of the external command that starts at `words[i]`, or null. */
function externalAt(words: readonly string[], i: number): string | null {
  const program = programName(words[i] as string)
  const args = words.slice(i + 1)
  if (program === 'git') return externalOf(gitVerdict(args))
  if (program === 'gh') return ghExternal(args)
  if (program === 'curl') return externalOf(curlVerdict(args))
  if (program === 'wget') return httpExternal('wget', args, WGET_BODY, ['--method'], 'POST')
  if (PS_HTTP.has(program)) return externalOf(psHttpVerdict(program, args))
  if (REMOTE_SHELLS.has(program)) return program
  if (program === 'rsync') return args.some((arg) => /^[^-/\\][^\s/\\]*:/.test(arg) && !/^[A-Za-z]:[\\/]/.test(arg)) ? 'rsync' : null
  if (PACKAGE_MANAGERS.has(program)) {
    // `yarn npm publish` (Yarn 2 and later) as well as `npm publish`.
    const subs = args.filter((arg) => !arg.startsWith('-')).slice(0, 2)
    const [first, second] = subs
    if (first !== undefined && PM_EXTERNAL.has(first)) return `${program} ${first}`
    return first === 'npm' && second !== undefined && PM_EXTERNAL.has(second) ? `${program} npm ${second}` : null
  }
  if (program === 'docker' || program === 'podman') {
    const sub = args.find((arg) => !arg.startsWith('-'))
    return sub === 'push' ? withTargets(`${program} push`, args.slice(args.indexOf(sub) + 1), 1, false) : null
  }
  return null
}

/** `git`, `/usr/bin/git`, `git.exe`, `Invoke-WebRequest` → `git`, …, `invoke-webrequest`. */
function programName(word: string): string {
  const name = word.split(/[\\/]/).pop() ?? word
  return name.toLowerCase().replace(/\.exe$/, '')
}

/** How a program's own reading of its arguments came out: it writes outside, it is local, or it cannot tell. */
type Verdict = { kind: 'external'; summary: string } | { kind: 'local' } | { kind: 'unclear' }
const LOCAL: Verdict = { kind: 'local' }
const UNCLEAR: Verdict = { kind: 'unclear' }
const externalOf = (verdict: Verdict): string | null => (verdict.kind === 'external' ? verdict.summary : null)

function gitVerdict(args: readonly string[]): Verdict {
  let i = 0
  while (i < args.length && (args[i] as string).startsWith('-')) i += GIT_VALUE_OPTIONS.has(args[i] as string) ? 2 : 1
  const subcommand = args[i]
  const rest = args.slice(i + 1)
  // `git` alone, `git --version`.
  if (subcommand === undefined) return LOCAL
  if (subcommand === 'tag' && !rest.some((arg) => GIT_TAG_WRITE.test(arg)) && (positionals(rest).length === 0 || rest.some((arg) => GIT_LIST_OPTIONS.test(arg)))) return LOCAL
  if (GIT_EXTERNAL.has(subcommand)) return { kind: 'external', summary: GIT_TARGETED.has(subcommand) ? withTargets(`git ${subcommand}`, rest, 2, true) : `git ${subcommand}` }
  if (GIT_READ.has(subcommand) || GIT_READ_FORMS[subcommand]?.(rest) === true) return LOCAL
  return UNCLEAR
}

/** curl: external with a method that writes, or with a body or an upload; unclear with an option it does not read. */
function curlVerdict(args: readonly string[]): Verdict {
  let method: string | null = null
  let body = false
  let upload = false
  let get = false
  const urls: string[] = []
  // What an option with its value means; false when the command cannot be read.
  const take = (name: string, value: string | undefined): boolean => {
    if (value === undefined || name === '-K' || name === '--config') return false
    if (name === '-X' || name === '--request') method = value
    else if (CURL_BODY.has(name)) body = true
    else if (name === '-T' || name === '--upload-file') upload = true
    else if (name === '--url') urls.push(value)
    return true
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const name = eq === -1 ? arg : arg.slice(0, eq)
      if (CURL_LONG_FLAGS.has(name)) get ||= name === '--get'
      else if (!CURL_LONG_VALUE.has(name) || !take(name, eq === -1 ? args[++i] : arg.slice(eq + 1))) return UNCLEAR
    } else if (arg.startsWith('-')) {
      for (let j = 1; j < arg.length; j++) {
        const letter = arg[j] as string
        if (CURL_SHORT_FLAGS.has(letter)) {
          get ||= letter === 'G'
          continue
        }
        // The rest of the word is the value (`-XPOST`, `-sdx`), else the next word.
        if (!CURL_SHORT_VALUE.has(letter) || !take(`-${letter}`, j + 1 < arg.length ? arg.slice(j + 1) : args[++i])) return UNCLEAR
        break
      }
    } else urls.push(arg)
  }
  // `-I` (HEAD) reads like GET, so it needs no method of its own.
  const sent: string = method ?? (upload ? 'PUT' : body && !get ? 'POST' : 'GET')
  if (READ_METHODS.has(sent.toUpperCase())) return LOCAL
  return { kind: 'external', summary: withTargets(`curl ${safe(sent.toUpperCase()) ?? '…'}`, urls.filter((url) => /^https?:\/\//.test(url)).slice(0, 1), 1, false) }
}

function ghExternal(args: readonly string[]): string | null {
  const at = args.findIndex((word) => !word.startsWith('-'))
  const group = args[at]
  if (group === 'api') return ghApiExternal(args.slice(at + 1))
  // `gh` alone or `gh --version`: no group.
  if (group === undefined || GH_READ_GROUPS.has(group)) return null
  const rest = args.slice(at + 1)
  const verbAt = rest.findIndex((word) => !word.startsWith('-'))
  const verb = rest[verbAt]
  // `gh pr` alone prints help.
  if (verb === undefined || GH_READ_VERBS.has(verb)) return null
  return withTargets(`gh ${safe(group) ?? '…'} ${safe(verb) ?? '…'}`, rest.slice(verbAt + 1), 1, false)
}

/** `gh api`: external with a method that writes, or with a body and no method (gh then sends POST). */
function ghApiExternal(args: readonly string[]): string | null {
  let method: string | null = null
  let body = false
  let endpoint: string | null = null
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (arg === '-X' || arg === '--method') method = args[i + 1] ?? ''
    else if (arg.startsWith('--method=')) method = arg.slice('--method='.length)
    else if (arg.startsWith('-X')) method = arg.slice(2)
    if (GH_API_BODY.test(arg)) body = true
    if (GH_API_VALUE_OPTIONS.has(arg)) i++
    else if (!arg.startsWith('-')) endpoint ??= arg
  }
  const writes = method === null ? body : !READ_METHODS.has(method.toUpperCase())
  if (!writes) return null
  return withTargets(`gh api ${method === null ? 'POST' : (safe(method.toUpperCase()) ?? '…')}`, endpoint === null ? [] : [endpoint], 1, false)
}

/** curl and wget: external with a method that writes, or with a body (they then send `bodyMethod`). */
function httpExternal(program: string, args: readonly string[], bodyOption: RegExp, methodOptions: readonly string[], bodyMethod: string): string | null {
  let method: string | null = null
  let body = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    const option = methodOptions.find((name) => arg === name || arg.startsWith(`${name}=`) || (name.length === 2 && arg.startsWith(name)))
    if (option !== undefined) method = arg === option ? (args[++i] ?? '') : arg.slice(arg.startsWith(`${option}=`) ? option.length + 1 : option.length)
    else if (bodyOption.test(arg)) body = true
  }
  const sent = method ?? (body ? bodyMethod : 'GET')
  if (READ_METHODS.has(sent.toUpperCase())) return null
  return withTargets(`${program} ${safe(sent.toUpperCase()) ?? '…'}`, args.filter((arg) => /^https?:\/\//.test(arg)).slice(0, 1), 1, false)
}

/** Whether `name` (lower case, without the dash) names the parameter `full`: PowerShell takes any prefix of at least `min` letters. */
const psParameter = (name: string, full: string, min: number): boolean => name.length >= min && full.startsWith(name)

/**
 * PowerShell's Invoke-WebRequest and Invoke-RestMethod: external with a `-Method` that writes, or with
 * `-Body`, `-InFile` or `-Form`; local only when read as GET or HEAD. Parameters are read in any case,
 * by any unambiguous prefix (`-Meth`) and in the colon form (`-Method:Post`); splatting (`@params`) or a
 * method in a variable is unclear.
 */
function psHttpVerdict(program: string, args: readonly string[]): Verdict {
  let method: string | undefined | null = null
  let body = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (arg.startsWith('@')) return UNCLEAR
    if (!arg.startsWith('-')) continue
    const colon = arg.indexOf(':')
    const name = (colon === -1 ? arg.slice(1) : arg.slice(1, colon)).toLowerCase()
    const inline = colon === -1 ? undefined : arg.slice(colon + 1)
    if (psParameter(name, 'method', 2)) method = inline ?? args[++i]
    else if (psParameter(name, 'body', 1) || psParameter(name, 'infile', 2) || psParameter(name, 'form', 3)) {
      body = true
      if (inline === undefined) i++
    }
  }
  if (method === undefined || method?.startsWith('$') === true) return UNCLEAR
  // `Default` is PowerShell's name for GET.
  const sent = (method ?? (body ? 'POST' : 'GET')).toUpperCase().replace(/^DEFAULT$/, 'GET')
  if (READ_METHODS.has(sent)) return LOCAL
  return { kind: 'external', summary: withTargets(`${program} ${safe(sent) ?? '…'}`, args.filter((arg) => /^https?:\/\//.test(arg)).slice(0, 1), 1, false) }
}

/** Whether every program a simple command runs is known to act only here. */
function isLocal(words: readonly string[]): boolean {
  let k = 0
  while (k < words.length && /^[A-Za-z_]\w*=/.test(words[k] as string)) k++
  if (k === words.length) return true
  const program = programName(words[k] as string)
  const rest = words.slice(k + 1)
  if (HEADERS.has(program)) return true
  if (KEYWORDS.has(program)) return isLocal(rest)
  if (SHELLS.has(program)) {
    // `-c`, `-lc` (Codex runs `bash -lc '…'`), PowerShell's `-Command`.
    const at = rest.findIndex((arg) => /^-[a-z]*c$/.test(arg) || arg.toLowerCase() === '-command')
    const script = at === -1 ? undefined : rest[at + 1]
    if (script === undefined) return false
    const inner = classifyLine(script)
    return inner.external.length === 0 && inner.unclassified.length === 0
  }
  if (PREFIXES.has(program)) {
    let j = 0
    while (j < rest.length && /^(?:-|[A-Za-z_]\w*=|\d+(?:\.\d+)?[smhd]?$)/.test(rest[j] as string)) j++
    return isLocal(rest.slice(j))
  }
  if (PACKAGE_MANAGERS.has(program)) return localPackageCommand(rest)
  if (program === 'npx') return isLocalScript(rest.find((arg) => !arg.startsWith('-')))
  if (program === 'git') return gitVerdict(rest).kind === 'local'
  if (program === 'curl') return curlVerdict(rest).kind === 'local'
  if (PS_HTTP.has(program)) return psHttpVerdict(program, rest).kind === 'local'
  if (program === 'find') return findCommands(rest).every((command) => isLocal(command))
  // Code given on the command line runs whatever it likes: `node -e`, `python -c`, awk's `system(` and pipes.
  if (program === 'node') return !rest.some((arg) => /^-[a-zA-Z]*[ep]$|^--(?:eval|print)(?:=|$)/.test(arg))
  if (program === 'python' || program === 'python3') return !rest.some((arg) => /^-[a-zA-Z]*c$/.test(arg))
  if (program === 'awk') return !rest.some((arg) => /system\s*\(|\|/.test(arg))
  return LOCAL_PROGRAMS.has(program)
}

/** The commands of find's `-exec`, `-execdir`, `-ok` and `-okdir`, each up to its `;` or `+`. */
function findCommands(args: readonly string[]): string[][] {
  const commands: string[][] = []
  for (let i = 0; i < args.length; i++) {
    if (!/^-(?:exec|execdir|ok|okdir)$/.test(args[i] as string)) continue
    const end = args.findIndex((arg, at) => at > i && (arg === ';' || arg === '+'))
    commands.push(args.slice(i + 1, end === -1 ? args.length : end))
    i = end === -1 ? args.length : end
  }
  return commands
}

function localPackageCommand(args: readonly string[]): boolean {
  const at = args.findIndex((arg) => !arg.startsWith('-'))
  const sub = args[at]
  if (sub === undefined) return false
  if (PM_LOCAL.has(sub)) return true
  if (PM_RUNNERS.has(sub)) return isLocalScript(args.slice(at + 1).find((arg) => !arg.startsWith('-')))
  return isLocalScript(sub)
}

function isLocalScript(name: string | undefined): boolean {
  return name !== undefined && LOCAL_SCRIPTS.has(name.split(':')[0] as string)
}

/** A simple command in a few words: its program and its first argument, when that is a short word. */
function commandSummary(words: readonly string[]): string {
  let k = 0
  while (k < words.length - 1 && /^[A-Za-z_]\w*=/.test(words[k] as string)) k++
  const program = safe(programName(words[k] ?? '')) ?? 'a command'
  return withTargets(program, words.slice(k + 1), 1, true)
}

/**
 * `head` and up to `count` of the first arguments, while they are short words. `skipOptions`: options
 * between them are passed over (git's options take no value); otherwise the first option ends the
 * targets, so the value of `-t <title>` is never taken for one.
 */
function withTargets(head: string, args: readonly string[], count: number, skipOptions: boolean): string {
  const targets: string[] = []
  for (const arg of args) {
    if (targets.length === count) break
    if (arg.startsWith('-') && skipOptions) continue
    // A query string is the model's text: a URL is kept up to its `?`.
    const target = arg.split('?')[0] as string
    if (arg.startsWith('-') || !SAFE_WORD.test(target)) break
    targets.push(target)
  }
  return [head, ...targets].join(' ')
}

/** A short word of the model's input (an Agent type, a recipient), or null when it is anything else. */
function safe(value: unknown): string | null {
  return typeof value === 'string' && SAFE_WORD.test(value) ? value : null
}

/**
 * The simple commands of a command line, each as its words with quotes removed. Splits at `;`,
 * `&`, `|` and newlines; a part in `$(…)`, `(…)` or backticks is a command of its own, and the command
 * around it goes on after it. A redirection (`>file`, `2>&1`, `<<EOF`) ends a word, and its target is not a word.
 * Not a shell: enough to find a program and its arguments.
 */
function shellSegments(line: string): string[][] {
  const segments: string[][] = []
  let words: string[] = []
  let word = ''
  let inWord = false
  /** The word was quoted, wholly or in part. */
  let quoted = false
  let target = false
  /** The next target is the delimiter of a here-document (`<<EOF`). */
  let delimiterNext = false
  /** Delimiters of quoted here-documents (`<<'EOF'`) whose lines start after the next newline. */
  const heredocs: string[] = []
  const endWord = (): void => {
    if (inWord && !target) words.push(word)
    if (inWord && target) {
      // Only a quoted delimiter keeps the shell from expanding `$(…)` in the lines: those are read as commands.
      if (delimiterNext && quoted) heredocs.push(word)
      target = false
      delimiterNext = false
    }
    word = ''
    inWord = false
    quoted = false
  }
  const endSegment = (): void => {
    endWord()
    target = false
    if (words.length > 0) segments.push(words)
    words = []
  }
  // The outer command's words while a `$(…)`, `(…)` or backtick part is read; the outer command goes on after it.
  const outer: string[][] = []
  let inBackticks = false
  const open = (): void => {
    endWord()
    outer.push(words)
    words = []
  }
  const close = (): void => {
    endSegment()
    words = outer.pop() ?? []
  }
  for (let i = 0; i < line.length; i++) {
    const char = line[i] as string
    if (char === "'" || char === '"') {
      const closing = line.indexOf(char, i + 1)
      const end = closing === -1 ? line.length : closing
      word += line.slice(i + 1, end)
      inWord = true
      quoted = true
      i = end
    } else if (char === '\\' && line[i + 1] === '\n') i++
    else if (char === '\\' && i + 1 < line.length) {
      // A backslash before a newline joins the lines; before any other character it makes it literal.
      word += line[++i]
      inWord = true
      quoted = true
    } else if (char === '>' || char === '<' || (char === '&' && line[i + 1] === '>')) {
      // A file descriptor right before the operator (`2>`) is part of it.
      if (inWord && /^\d+$/.test(word)) {
        word = ''
        inWord = false
      } else endWord()
      // `&>`: the `>` is read on the next step, as an operator of its own.
      const from = i
      while (line[i + 1] === line[i] || line[i + 1] === '|') i++
      // `<<` and `<<-` start a here-document; `<<<` is a string.
      delimiterNext = char === '<' && i - from === 1
      if (delimiterNext && line[i + 1] === '-') i++
      if (line[i + 1] === '(') {
        // `<(…)`, `>(…)`: a process substitution is a command of its own, and the target of a `>` before it.
        target = false
        delimiterNext = false
      } else if (line[i + 1] === '&') {
        // `>&2`, `2>&1`: a descriptor, not a file.
        i++
        while (/[\d-]/.test(line[i + 1] ?? '')) i++
      } else target = true
    } else if (char === ' ' || char === '\t') endWord()
    else if (char === '(') open()
    else if (char === ')') close()
    else if (char === '`') {
      if (inBackticks) close()
      else open()
      inBackticks = !inBackticks
    } else if (char === '\n') {
      endSegment()
      i = afterHeredocs(line, i, heredocs.splice(0))
    } else if (';&|\r'.includes(char)) endSegment()
    else {
      word += char
      inWord = true
    }
  }
  endSegment()
  // A `$(` or `(` left open: the outer commands are commands too.
  for (const rest of outer.reverse()) if (rest.length > 0) segments.push(rest)
  return segments
}

/** Where the lines of the here-documents that start after the newline at `i` end: the newline after the last delimiter's line. */
function afterHeredocs(line: string, i: number, delimiters: readonly string[]): number {
  let at = i
  for (const delimiter of delimiters) {
    while (at < line.length) {
      const next = line.indexOf('\n', at + 1)
      const end = next === -1 ? line.length : next
      const text = line.slice(at + 1, end).replace(/\r$/, '').replace(/^\t+/, '')
      at = end
      if (text === delimiter) break
    }
  }
  return at
}

function record(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
}

/** A command as one line: a string, or the argv array some Vendors give. */
function commandText(value: unknown): string {
  if (Array.isArray(value)) return value.filter((part): part is string => typeof part === 'string').join(' ')
  return typeof value === 'string' ? value : ''
}

function shorten(description: string): string {
  return description.length > DESCRIPTION_MAX ? `${description.slice(0, DESCRIPTION_MAX - 1)}…` : description
}

export type RefusedReason = 'not-transient' | 'in-flight' | 'cap'

export type RetryDecision =
  | { kind: 'retry'; attempt: number; of: number; delayMs: number }
  /** `inFlight`: the calls without a result, for the line «not retried: … may or may not have run». */
  | { kind: 'refused'; reason: RefusedReason; inFlight: ExternalAction[] }

export interface RetryInput {
  failure: TurnFailure
  /** The retry this would be, 1 for the first after a turn that ended well. */
  attempt: number
  actions: readonly ExternalAction[]
  /** A random number in [0, 1) for the jitter of the pause. */
  random: number
}

/**
 * Whether to continue after the failed turn, and after what pause. Refused, in this order: a failure
 * that is not temporary; an external or unclassified call without a result (it may or may not have
 * run, so the human looks first, whatever the count); the retries used up.
 */
export function retryDecision({ failure, attempt, actions, random }: RetryInput): RetryDecision {
  if (failure.kind !== 'transient') return { kind: 'refused', reason: 'not-transient', inFlight: [] }
  const inFlight = actions.filter((action) => !action.done)
  if (inFlight.length > 0) return { kind: 'refused', reason: 'in-flight', inFlight }
  if (attempt > MAX_RETRIES) return { kind: 'refused', reason: 'cap', inFlight: [] }
  return { kind: 'retry', attempt, of: MAX_RETRIES, delayMs: retryDelay(attempt, random) }
}

/** The temporary error in the words of the continuation text. */
const ERROR_WORDS: Record<TransientError, string> = {
  'api-500': 'API error 500',
  'api-502': 'API error 502',
  'api-503': 'API error 503',
  'api-504': 'API error 504',
  overloaded: 'the API was overloaded',
  connection: 'the connection to the API was lost',
  timeout: 'the request to the API timed out',
  stream: 'the response stream broke off',
}

const NO_ACTION_SENTENCE = 'worfy saw no action of that turn that changes something outside this Session.'
const CHECK_SENTENCE =
  'Before you repeat any action that changes something outside this Session (commit, push, PR, merge, an Agent), check whether it already happened — git log, gh pr view, the task list — and do not do it twice.'

export interface RetryTextInput {
  attempt: number
  of: number
  error: TransientError
  /** The turn's calls from externalActions; only those that ran (done) are named. */
  actions: readonly ExternalAction[]
}

/**
 * The message the Orchestrator gets instead of its original one (spec, the section on the retry after an API
 * error, item 3). It never carries the turn's original text, a person's message or the Wave command: the Session
 * keeps the turn's history, and the model continues from it. The actions are worfy's summaries, not the
 * model's words (see the top of this file).
 */
export function retryText({ attempt, of, error, actions }: RetryTextInput): string {
  const ran = actions.filter((action) => action.done && action.known)
  const unclear = actions.filter((action) => action.done && !action.known)
  // Each summary in backticks, so it reads as a name rather than a sentence (it holds no backtick: SAFE_WORD).
  const list = (items: readonly ExternalAction[]): string => items.map((action) => `- \`${action.description}\``).join('\n')
  const lines = [`The previous turn ended with a temporary API error (${ERROR_WORDS[error]}) before it finished (retry ${attempt} of ${of}). Continue from where you stopped.`]
  if (ran.length > 0) lines.push(`These actions of that turn already ran (worfy's summary of the calls):\n${list(ran)}`)
  if (unclear.length > 0) lines.push(`worfy could not tell whether these commands of that turn changed something outside this Session:\n${list(unclear)}`)
  if (ran.length === 0 && unclear.length === 0) lines.push(NO_ACTION_SENTENCE)
  lines.push(CHECK_SENTENCE)
  return lines.join('\n')
}
