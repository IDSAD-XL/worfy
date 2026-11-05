// The approval policy of unattended Sessions (worfy-auto-approve ticket 03; the Epic spec, how it
// works, items 1 and 3–6, and security, items 2–3 and 5–9). `judge` is a pure function of a
// permission request and its context — the file system comes through the context — and answers one
// Decision: allow, deny with a hint the agent can follow, park for the owner, or hard-deny, which no
// mode and no answer lifts. The mode (Shadow or On) does not change the outcome: Shadow only records
// it (ticket 04).
//
// The order is fixed:
// 1. a question (AskUserQuestion, a Card's question) — deny with a hint (spec, item 6; Q8 (a));
// 2. a command the parser (shell.ts) cannot judge, or a file tool path that is not absolute as given —
//    deny with a hint;
// 3. hard deny (spec, item 5): a target in a hard area (roots.ts), a program that changes the OS or app
//    settings, chmod / chown outside the roots, a force push, a push that deletes, pushes refs it does
//    not name or reaches the default branch or a branch of another worktree, a delete of the default
//    branch or of a branch of another worktree, a checkout of either, a commit on either, running what
//    was downloaded, sending a file from outside the roots;
// 4. without the home folder nothing else is approved (deny);
// 5. deny with a hint where the agent can rewrite: a symbolic link on a path or a moved root, a path
//    whose place cannot be told, git config, hooks, attributes or submodules (spec, security, item 9),
//    a copy that brings them along, a whole root deleted, a command that writes and deletes nothing
//    (ticket 01, category bash-other);
// 6. allow when every target is inside the roots and an allow rule (ALLOW_RULES) passes every action;
// 7. else park (Q3 (c)): parsed, but only the owner can decide.
//
// Hints are constants of this module, in English, never a piece of the request (spec, security,
// item 8). Git facts come from ShellAction.git, never from the words of the command; the URL a
// remote name stands for is in the repository's git config, which is not read here, so a push is
// never allowed (at most parked).
import type { SessionInfo } from '../session/types'
import { analyze, REPOSITORY, UNKNOWN, type ShellAction } from './shell'
import { copiedTree, isGitFileName, joinPath, normalizePath, realPathOf, repositoryTop, resolveTarget, rootsOf, type FileSystem, type Placement, type Roots, type TargetUse } from './roots'

export type Outcome = 'allow' | 'deny' | 'park' | 'hard-deny'

export interface Decision {
  outcome: Outcome
  /** The id of the rule that decided: an allow rule (several joined by `+`), a deny reason, `hard:<item>`. */
  rule: string
  /** What the agent reads with a deny: a constant of this module; null for the other outcomes. */
  hint: string | null
  /** The paths judged, normalized and in order, without repeats. */
  targets: string[]
}

/** A permission request: Claude Code's tool name and input, or Codex's `commandExecution` / `fileChange`. */
export interface ApprovalRequest {
  tool: string
  input: unknown
}

export interface PolicyContext {
  platform: NodeJS.Platform
  /** The folder a Bash command starts in: the Session's current shell folder (Claude Code keeps `cd` between calls). */
  cwd: string
  /** The environment of the Session's shell: HOME, TMPDIR, APPDATA, XDG_CONFIG_HOME. */
  env: Readonly<Record<string, string | undefined>>
  /** The worktrees of the Tickets of the current Wave. */
  worktrees: readonly string[]
  /** The Project's .scratch. */
  scratch: string | null
  /** The Run's folder for temporary files, the Session's TMPDIR. */
  runTemp: string | null
  /** The scratchpad of the Session. */
  scratchpad: string | null
  /** worfy's data folder (WORFY_DATA_DIR). */
  dataDir: string | null
  /** The Harness home. */
  harnessHome: string | null
  /** The Run's own Session (the Orchestrator's): its folder is not another Session's. */
  sessionId: string
  /** The live Sessions; the app's SessionRegistry. */
  sessions: { list(): ReadonlyArray<Pick<SessionInfo, 'sessionId' | 'cwd'>> }
  /** The Project's worktrees with their branches (`git worktree list`); null branch: detached. */
  checkouts: ReadonlyArray<{ path: string; branch: string | null }>
  /** The Project's default branch; `main` is protected as well. */
  defaultBranch: string
  /** The real path of each root recorded when the Run started (roots.ts, recordRoots), by the root's path. */
  recordedRoots: Readonly<Record<string, string>>
  /** The file system; the machine's when absent. */
  fs?: FileSystem
}

/** One action as the rules see it, with each of its targets placed. */
export interface Act {
  /** The program, or for a file tool the tool's name. */
  program: string
  /** Whether it is a file tool (Edit, Write, MultiEdit, NotebookEdit, fileChange). */
  fileTool: boolean
  /** The words after the program; none for a file tool. */
  args: readonly string[]
  git: ShellAction['git']
  network: boolean
  targets: Target[]
}

export interface Target {
  path: string
  use: TargetUse
  /** UNKNOWN: whatever the program does; REPOSITORY: the repository's own files; folder: where git works. */
  marker: 'unknown' | 'repository' | 'folder' | null
  placement: Placement
}

export interface AllowRule {
  id: string
  describe: string
  /** Whether the action, all of whose targets are inside the roots, is one the rule allows. */
  match(act: Act): boolean
}

const SHELLS = new Set(['sh', 'bash', 'zsh'])
// The programs of the parser's table whose targets say all they do.
const FILE_PROGRAMS = new Set(['rm', 'rmdir', 'mv', 'cp', 'mkdir', 'touch', 'tee', 'mktemp', 'cat', 'ls', 'head', 'tail', 'wc', 'echo', 'printf', 'true', 'false', ':', 'pwd', 'test', '[', 'cd', 'set', 'exit'])
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'fileChange'])
const QUESTION_TOOLS = new Set(['AskUserQuestion', 'card_ask'])
const COMMAND_TOOLS = new Set(['Bash', 'commandExecution'])

const placed = (act: Act): boolean => act.targets.every((target) => target.marker !== 'unknown')

/** The allow rules, in the order their ids are joined. Each has its tests in auto-approve-policy.test.ts. */
export const ALLOW_RULES: readonly AllowRule[] = [
  {
    id: 'files-inside-roots',
    describe: 'Deletes, writes and reads of the file programs (rm, mv, cp, mkdir, touch, tee, redirections…) inside the roots, without the network',
    match: (act) => !act.fileTool && FILE_PROGRAMS.has(act.program) && act.git === undefined && !act.network && placed(act),
  },
  {
    id: 'shell-script-inside-roots',
    describe: 'An sh / bash / zsh -c script, one line or many, whose every action another rule allows',
    match: (act) => !act.fileTool && SHELLS.has(act.program) && act.targets.length === 0,
  },
  {
    id: 'git-in-wave-worktree',
    describe: 'git in a worktree of the Wave, without push and without deleting a branch',
    match: (act) =>
      act.git !== undefined &&
      act.git.push === undefined &&
      act.git.branchDelete === undefined &&
      !fetchesFromElsewhere(act) &&
      placed(act) &&
      // The repository is a worktree of the Wave itself, not a repository inside another root.
      act.targets.every((target) => target.marker !== 'repository' || (target.placement.kind === 'is-root' && target.placement.root.kind === 'worktree')),
  },
  {
    id: 'edit-inside-roots',
    describe: 'Edit, Write, MultiEdit, NotebookEdit (Claude Code) and fileChange (Codex) inside the roots',
    match: (act) => act.fileTool && act.targets.length > 0 && placed(act),
  },
]

const NEVER = 'worfy never approves this, in any mode. Do not retry it in another form.'
const HARD_HOME = `${NEVER} It touches the user's secrets or settings in the home folder; leave it to the owner. If a path came from X=$(mktemp -d), put && or || exit 1 after it, so an empty X never reaches the home folder.`
const HARD_OTHERS = `${NEVER} It changes the work of another Session or worktree, or a branch checked out there or the default branch. Commit only on your Ticket's branch, in its worktree.`
const HARD_REMOTE = `${NEVER} It rewrites or deletes history on a remote, or pushes refs other than your Ticket's branch; leave pushing to the owner.`

/** The hint of each hard-deny rule, by its id after `hard:`. */
export const HARD_HINTS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(['claude-home', 'codex-home', 'ssh', 'gnupg', 'gh-config', 'git-config', 'npmrc', 'shell-rc', 'library', 'appdata'].map((id) => [id, HARD_HOME])),
  'worfy-data': `${NEVER} It changes worfy's own data or settings; leave it to the owner.`,
  'harness-home': `${NEVER} It changes the Harness; leave it to the owner.`,
  ...Object.fromEntries(['other-session', 'other-worktree', 'git-other-branch', 'git-branch-delete-default', 'git-checkout-default-branch', 'git-commit-default-branch', 'git-fetch-default-branch', 'git-ignore-other-worktrees', 'git-worktree-force'].map((id) => [id, HARD_OTHERS])),
  ...Object.fromEntries(['git-force-push', 'git-push-delete', 'git-push-many', 'git-push-default-branch'].map((id) => [id, HARD_REMOTE])),
  'os-settings': `${NEVER} It changes the settings of the OS or of an app; leave it to the owner.`,
  'chmod-outside': `${NEVER} It changes permissions or owners outside the Run's folders. Change them only inside the Ticket's worktree, .scratch, TMPDIR or your scratchpad.`,
  'run-download': `${NEVER} It runs what it downloads. Save the download to a file in your scratchpad and leave running it to the owner.`,
  'send-outside': `${NEVER} It sends a file from outside the Run's folders over the network; leave it to the owner.`,
}

export const HINTS = {
  question: 'No one is here to answer (worfy Autopilot). Decide by the rules of the Project, or write the question into the owner questions of the Ticket and go on.',
  notJudged: 'worfy could not read this command, so it did not approve it. Rewrite it in plain steps: literal paths, no loops, conditions, functions or command substitution, no variables from outside the command; put a longer script into a file in your scratchpad and run the file.',
  symlink: 'A path of this request goes through a symbolic link, which worfy never approves, wherever it leads. Use the real path, inside the Ticket\'s worktree, the Project\'s .scratch, the Run\'s TMPDIR or your scratchpad.',
  gitFiles: 'worfy never approves writing git config, hooks, attributes or submodules (.git/config, .git/hooks, .git/info/attributes, .gitattributes, .gitmodules), nor a copy that brings them along: through them any git command runs a program. Leave this change to the owner.',
  copyUnclear: 'worfy could not look through everything this copies or moves (a folder it cannot read, or more than 10,000 entries), so it did not approve it. Copy smaller folders, or the files by name.',
  wholeRoot: 'This deletes a whole root folder (a worktree, .scratch, TMPDIR or the scratchpad). Delete what is inside it, by literal paths.',
  readOnly: 'This command writes and deletes nothing, and the check that stopped it is Claude Code\'s own, which worfy cannot repeat. Follow the reason Claude Code gave, or rewrite the command with literal paths.',
  noTarget: 'worfy could not find what this request changes, so it did not approve it. Give the full absolute path, as it is: no ~, no relative path, no spaces around it, no \\\\ network or device path.',
  unclearPath: 'worfy could not tell where a path of this request leads (a .. after a folder that does not exist, or a Windows name with a trailing dot or space, a colon or a short ~1 form), so it did not approve it. Give the plain full path.',
  noHome: 'worfy does not know the home folder of this Session, so it approves nothing here.',
} as const

// Programs that change the settings of the OS or of apps; `defaults`, `schtasks` and `networksetup` only
// with a subcommand that writes.
const OS_SETTINGS = new Set(['sudo', 'su', 'doas', 'launchctl', 'security', 'pfctl', 'socketfilterfw', 'netsh', 'reg', 'crontab'])
const OS_SETTINGS_SOME = new Set(['defaults', 'schtasks', 'networksetup'])
const DEFAULTS_READS = new Set(['read', 'read-type', 'domains', 'find', 'help'])
const CHANGES_OWNER = new Set(['chmod', 'chown', 'chgrp'])

interface Prepared {
  roots: Roots
  win: boolean
  context: PolicyContext
}

export function judge(request: ApprovalRequest, context: PolicyContext): Decision {
  if (QUESTION_TOOLS.has(request.tool)) return deny('question', HINTS.question, [])
  const decision = judgeRequest(request, prepare(context))
  // Without the home folder its secrets cannot be found: nothing but a hard deny is decided.
  if (homeOf(context) === null && decision.outcome !== 'hard-deny') return deny('no-home', HINTS.noHome, [])
  return decision
}

function judgeRequest(request: ApprovalRequest, prepared: Prepared): Decision {
  const { context } = prepared
  const input = isRecord(request.input) ? request.input : {}
  if (COMMAND_TOOLS.has(request.tool)) {
    const command = input['command']
    const cwd = request.tool === 'commandExecution' && typeof input['cwd'] === 'string' && input['cwd'] !== '' ? input['cwd'] : context.cwd
    if (typeof command !== 'string' || command.trim() === '') return deny('not-judged', HINTS.notJudged, [])
    return judgeCommand(command, cwd, prepared)
  }
  if (FILE_TOOLS.has(request.tool)) return judgeFiles(request.tool, input, prepared)
  return { outcome: 'park', rule: 'unknown-tool', hint: null, targets: [] }
}

/** A hard-deny Decision of the rule `id` (a hard category or a rule of this module). */
function hardDeny(id: string, targets: string[]): Decision {
  return { outcome: 'hard-deny', rule: `hard:${id}`, hint: HARD_HINTS[id] ?? NEVER, targets }
}

function homeOf(context: PolicyContext): string | null {
  const home = context.env['HOME'] ?? (context.platform === 'win32' ? context.env['USERPROFILE'] : undefined)
  return home === undefined || normalizePath(home, context.platform === 'win32') === null ? null : home
}

function prepare(context: PolicyContext): Prepared {
  const win = context.platform === 'win32'
  const same = (a: string, b: string): boolean => {
    const x = normalizePath(a, win)
    const y = normalizePath(b, win)
    return x !== null && y !== null && (win ? x.toLowerCase() === y.toLowerCase() : x === y)
  }
  const own = context.sessions.list().find((session) => session.sessionId === context.sessionId)?.cwd ?? null
  const others = context.sessions.list().filter((session) => session.sessionId !== context.sessionId).map((session) => session.cwd)
  const otherWorktrees = context.checkouts.map((checkout) => checkout.path).filter((path) => !context.worktrees.some((wt) => same(wt, path)) && !(own !== null && same(own, path)))
  const roots = rootsOf({
    platform: context.platform,
    worktrees: context.worktrees,
    scratch: context.scratch,
    runTemp: context.runTemp,
    scratchpad: context.scratchpad,
    home: homeOf(context),
    xdgConfigHome: context.env['XDG_CONFIG_HOME'] ?? null,
    appData: win ? context.env['APPDATA'] ?? null : null,
    dataDir: context.dataDir,
    harnessHome: context.harnessHome,
    otherSessions: others,
    otherWorktrees,
    recorded: context.recordedRoots,
    ...(context.fs === undefined ? {} : { fs: context.fs }),
  })
  return { roots, win, context }
}

// --- Commands -------------------------------------------------------------------------------

function judgeCommand(command: string, cwd: string, prepared: Prepared): Decision {
  const { context } = prepared
  const analysis = analyze(command, { cwd, env: context.env, platform: context.platform })
  if (!analysis.judged) return deny('not-judged', HINTS.notJudged, [])
  const actions = analysis.actions
  const acts = actions.map((action) => actOf(action, prepared))
  const targets = targetsOf(acts)
  const hard = hardOfCommand(actions, acts, prepared)
  if (hard !== null) return hardDeny(hard, targets)
  const hinted = hintOf(acts, actions, prepared)
  if (hinted !== null) return { ...hinted, targets }
  return allowOrPark(acts, targets)
}

function actOf(action: ShellAction, prepared: Prepared): Act {
  const { roots, win } = prepared
  const targets: Target[] = []
  const add = (path: string, use: TargetUse): void => {
    if (path === UNKNOWN) {
      targets.push({ path, use, marker: 'unknown', placement: { kind: 'outside' } })
      return
    }
    if (path === REPOSITORY) {
      const top = repositoryTop(action.cwd, roots)
      const where = top ?? normalizePath(action.cwd, win) ?? action.cwd
      targets.push({ path: where, use, marker: 'repository', placement: top === null ? { kind: 'outside' } : resolveTarget(top, roots, use === 'delete' ? 'write' : use) })
      return
    }
    targets.push({ path: normalizePath(path, win) ?? path, use, marker: null, placement: resolveTarget(path, roots, use) })
  }
  for (const path of action.reads) add(path, 'read')
  for (const path of action.writes) add(path, 'write')
  for (const path of action.deletes) add(path, 'delete')
  // git works in its folder: a link on the way there is a link on every path it touches.
  if (action.git !== undefined) targets.push({ path: normalizePath(action.cwd, win) ?? action.cwd, use: 'read', marker: 'folder', placement: resolveTarget(action.cwd, roots, 'read') })
  return { program: action.program, fileTool: false, args: action.args, git: action.git, network: action.network, targets }
}

function targetsOf(acts: Act[]): string[] {
  return [...new Set(acts.flatMap((act) => act.targets.filter((target) => target.marker !== 'unknown').map((target) => target.path)))]
}

function programName(program: string): string {
  const base = program.split(/[\\/]/).at(-1) ?? program
  return base.toLowerCase().replace(/\.exe$/, '')
}

function hardOfCommand(actions: ShellAction[], acts: Act[], prepared: Prepared): string | null {
  for (const act of acts) {
    for (const target of act.targets) if (target.placement.kind === 'hard') return target.placement.category
  }
  // What was downloaded, read by a shell or by a program that may run it, directly or through a pipe.
  const carries = new Set<number>()
  for (const [n, action] of actions.entries()) {
    const from = action.stdinFrom
    const fed = from !== null && carries.has(from)
    if (action.network || fed) carries.add(n)
    if (fed && (SHELLS.has(programName(action.program)) || action.writes.includes(UNKNOWN))) return 'run-download'
  }
  for (const [n, action] of actions.entries()) {
    const act = acts[n] as Act
    const name = programName(action.program)
    if (OS_SETTINGS.has(name)) return 'os-settings'
    // A program outside the parser's table may run the next word (env, nohup, xargs, timeout…).
    if (action.writes.includes(UNKNOWN) && action.args.some((word) => OS_SETTINGS.has(programName(word)) || OS_SETTINGS_SOME.has(programName(word)))) return 'os-settings'
    if (name === 'defaults' && !DEFAULTS_READS.has(action.args[0] ?? '')) return 'os-settings'
    if (name === 'schtasks' && !/^[/-]query$/i.test(action.args[0] ?? '')) return 'os-settings'
    if (name === 'networksetup' && !/^-(list|get|print|help|version)/i.test(action.args[0] ?? '')) return 'os-settings'
    if (CHANGES_OWNER.has(name) && changesOwnerOutside(action, prepared)) return 'chmod-outside'
    if (action.network && act.targets.some((target) => target.use === 'read' && target.marker === null && !isInside(target.placement))) return 'send-outside'
    const git = gitHard(action, prepared)
    if (git !== null) return git
  }
  return null
}

const isInside = (placement: Placement): boolean => placement.kind === 'inside' || placement.kind === 'is-root'

/** chmod / chown / chgrp: every word that is no option may be a path (the mode or owner too); one outside the roots. */
function changesOwnerOutside(action: ShellAction, prepared: Prepared): boolean {
  const words = action.args.filter((word) => !word.startsWith('-'))
  if (words.length === 0) return true
  return words.some((word) => {
    const absolute = normalizePath(word, prepared.win) ?? joinPath(normalizePath(action.cwd, prepared.win) ?? action.cwd, word, prepared.win)
    return !isInside(resolveTarget(absolute, prepared.roots, 'write'))
  })
}

const branchName = (ref: string): string => ref.replace(/^refs\/heads\//, '')

/** The words after git's subcommand (the global options and `-C <folder>` skipped, as shell.ts does). */
function subcommandWords(args: readonly string[]): string[] {
  let i = 0
  while (i < args.length && (args[i] ?? '').startsWith('-')) i += args[i] === '-C' ? 2 : 1
  return args.slice(i + 1)
}

/**
 * The operands of `words`, with the values of the options in `valued` (`-b x`, `-bx`, `--onto x`) apart. After
 * `--` come paths (checkout), or for `pastDashes` more operands: git drops the `--` of switch, branch, rebase,
 * fetch, pull and worktree add (`git switch -- x` switches to x).
 */
function operandsOf(words: readonly string[], valued: { short: string; long: readonly string[] }, pastDashes: boolean): { operands: string[]; values: Map<string, string[]> } {
  const operands: string[] = []
  const values = new Map<string, string[]>()
  const add = (name: string, value: string): void => {
    values.set(name, [...(values.get(name) ?? []), value])
  }
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? ''
    if (word === '--') {
      if (pastDashes) operands.push(...words.slice(i + 1))
      break
    }
    if (word.startsWith('--')) {
      const [name = '', value] = word.slice(2).split(/=(.*)/s)
      if (valued.long.includes(name)) add(name, value ?? words[++i] ?? '')
      else if (value === undefined) add(name, '')
      continue
    }
    if (word.startsWith('-') && word !== '-') {
      // A cluster of short flags; a valued one takes the rest of the word or the next word.
      for (let k = 1; k < word.length; k++) {
        const letter = word[k] ?? ''
        if (!valued.short.includes(letter)) {
          add(letter, '')
          continue
        }
        add(letter, word.length > k + 1 ? word.slice(k + 1) : words[++i] ?? '')
        break
      }
      continue
    }
    operands.push(word)
  }
  return { operands, values }
}

/**
 * The branch a repository's worktree is on: read from its HEAD (`.git` a folder, or a file naming the
 * git folder); null when detached; undefined when it cannot be read.
 */
function currentBranch(top: string, roots: Roots, win: boolean, caseless: boolean): string | null | undefined {
  const dotGit = joinPath(top, '.git', win)
  const kind = roots.fs.lstat(dotGit)
  let gitDir: string | null = kind === 'dir' ? dotGit : null
  if (kind === 'file') {
    const named = /^gitdir:[ \t]*(.+?)[ \t\r]*$/m.exec(roots.fs.readFile(dotGit) ?? '')?.[1]
    if (named !== undefined) gitDir = normalizePath(named, win) ?? joinPath(top, named, win)
  }
  const headPath = gitDir === null ? null : joinPath(gitDir, 'HEAD', win)
  // A HEAD that is a link reads as its target's content (a SHA): the branch is not known.
  if (headPath === null || roots.fs.lstat(headPath) !== 'file') return undefined
  const head = roots.fs.readFile(headPath)
  if (head === null) return undefined
  const ref = /^ref:[ \t]*(\S+)\s*$/.exec(head)?.[1]
  // A ref outside refs/heads/ (in any case where loose refs are files without case) is no known branch.
  if (ref !== undefined) return (caseless ? /^refs\/heads\//i : /^refs\/heads\//).test(ref) ? ref.slice('refs/heads/'.length) : undefined
  return /^[0-9a-f]{40,64}\s*$/.test(head) ? null : undefined
}

// Subcommands that commit onto the current branch or move it.
const MOVES_CURRENT = new Set(['commit', 'merge', 'rebase', 'cherry-pick', 'revert', 'reset', 'am', 'pull'])
const CHECKOUT_VALUED = { short: 'bBcC', long: ['orphan', 'conflict', 'pathspec-from-file'] } as const
const WORKTREE_ADD_VALUED = { short: 'bB', long: ['reason', 'orphan'] } as const
const FETCH_VALUED = { short: 'jo', long: ['depth', 'deepen', 'shallow-since', 'shallow-exclude', 'jobs', 'negotiation-tip', 'server-option', 'refmap', 'recurse-submodules-default', 'upload-pack'] } as const
const REBASE_VALUED = { short: 'sX', long: ['onto', 'strategy', 'strategy-option', 'exec'] } as const

/** Where a fetch or pull refspec writes (`src:dst`, `+src:dst`); null when it writes no local ref. */
/** Where a fetch refspec stores what it fetches, as written; null when it stores nothing (`src`, `src:`). */
function fetchDestination(spec: string): string | null {
  const at = spec.indexOf(':')
  return at < 0 || spec.slice(at + 1) === '' ? null : spec.slice(at + 1)
}

/** The destinations of a fetch or pull: those of its refspecs and of its `--refmap` values. */
function fetchDestinations(words: readonly string[]): string[] {
  const { operands, values } = operandsOf(words, FETCH_VALUED, true)
  return [...operands.slice(1), ...(values.get('refmap') ?? [])].map(fetchDestination).filter((each): each is string => each !== null)
}

/** A remote-tracking ref: the one kind of destination a fetch may write. In any case: on Linux it is no branch either way. */
const isRemoteTracking = (ref: string): boolean => /^refs\/remotes\//i.test(ref)

/**
 * fetch / pull from what is no configured remote name (a URL, an scp-like `host:path`, a path), or into a
 * destination outside refs/remotes/: git expands `x`, `heads/x` and `refs/HEADS/x` to a branch.
 */
function fetchesFromElsewhere(act: Act): boolean {
  const sub = act.git?.subcommand
  if (sub !== 'fetch' && sub !== 'pull') return false
  const words = subcommandWords(act.args)
  const remote = operandsOf(words, FETCH_VALUED, true).operands[0]
  if (remote !== undefined && (/[:\\/]/.test(remote) || remote.startsWith('.') || remote.startsWith('~'))) return true
  return fetchDestinations(words).some((destination) => !isRemoteTracking(destination))
}

function gitHard(action: ShellAction, prepared: Prepared): string | null {
  const facts = action.git
  if (facts === undefined) return null
  const { context, roots, win } = prepared
  // Loose refs are files: on macOS and Windows `MAIN` is `main`.
  const caseless = win || context.platform === 'darwin'
  const sameBranch = (a: string, b: string): boolean => (caseless ? a.toLowerCase() === b.toLowerCase() : a === b)
  const protectedBranch = (branch: string): boolean => sameBranch(branch, context.defaultBranch) || sameBranch(branch, 'main')
  const ofRun = (path: string): boolean => context.worktrees.some((wt) => samePath(wt, path, win))
  const top = repositoryTop(action.cwd, roots)
  const elsewhere = (path: string): boolean => !ofRun(path) && !(top !== null && samePath(path, top, win))
  // The branch a fetch, pull or push destination names: git expands `heads/x` and `refs/heads/x` to x.
  const destinationBranch = (ref: string): string => ref.replace(caseless ? /^(refs\/)?heads\//i : /^(refs\/)?heads\//, '')
  const otherBranch = (branch: string): boolean => context.checkouts.some((checkout) => checkout.branch !== null && sameBranch(branchName(checkout.branch), branch) && elsewhere(checkout.path))
  // A name git cannot resolve here (`-`, `@{-1}`, a glob) may be the default branch.
  const unknownName = (branch: string): boolean => branch === '' || branch === '-' || branch.startsWith('@{') || /[*?]/.test(branch)
  const judgeBranch = (branch: string, defaultRule: string): string | null => {
    if (unknownName(branch) || protectedBranch(branch)) return defaultRule
    return otherBranch(branch) ? 'git-other-branch' : null
  }
  const firstOf = (branches: readonly string[], defaultRule: string): string | null => {
    for (const branch of branches) {
      const rule = judgeBranch(branchName(branch), defaultRule)
      if (rule !== null) return rule
    }
    return null
  }
  if (facts.branchDelete !== undefined) {
    const rule = firstOf(facts.branchDelete.branches, 'git-branch-delete-default')
    if (rule !== null) return rule
  }
  const words = subcommandWords(action.args)
  const sub = facts.subcommand ?? ''
  if (sub === 'checkout' || sub === 'switch') {
    // git refuses a branch checked out in another worktree unless told to ignore that.
    if (words.some((word) => word.length > 9 && '--ignore-other-worktrees'.startsWith(word))) return 'git-ignore-other-worktrees'
    const { operands, values } = operandsOf(words, CHECKOUT_VALUED, sub === 'switch')
    const created = ['b', 'B', 'c', 'C', 'orphan'].flatMap((name) => values.get(name) ?? [])
    // --track origin/x makes and checks out x.
    const tracked = values.has('t') || values.has('track') ? operands.map((word) => word.slice(word.indexOf('/') + 1)) : []
    // `checkout <tree> -- <paths>` restores files and `--detach` leaves every branch: neither switches one. With
    // nothing after `--`, checkout switches.
    const dashes = words.indexOf('--')
    const switches = !values.has('detach') && !(sub === 'checkout' && dashes >= 0 && dashes < words.length - 1)
    const rule = firstOf(created.length > 0 ? created : switches ? [...operands, ...tracked] : [], 'git-checkout-default-branch')
    if (rule !== null) return rule
  }
  if (sub === 'worktree' && words[0] === 'add') {
    const { operands, values } = operandsOf(words.slice(1), WORKTREE_ADD_VALUED, true)
    if (values.has('f') || values.has('force')) return 'git-worktree-force'
    const created = [...(values.get('b') ?? []), ...(values.get('B') ?? [])]
    // Without a branch given, git takes the one named after the folder.
    const named = operands[1] ?? (values.has('detach') ? undefined : (operands[0] ?? '').split(/[\\/]/).at(-1))
    const rule = firstOf(created.length > 0 ? created : named === undefined || values.has('detach') ? [] : [named], 'git-checkout-default-branch')
    if (rule !== null) return rule
  }
  if (sub === 'branch' && facts.branchDelete === undefined) {
    // `git branch -f x <commit>` moves x; any branch named here is judged.
    const rule = firstOf(operandsOf(words, { short: '', long: [] }, true).operands.slice(0, 1), 'git-checkout-default-branch')
    if (rule !== null) return rule
  }
  if (sub === 'fetch' || sub === 'pull') {
    const destinations = fetchDestinations(words).filter((each) => !isRemoteTracking(each)).map(destinationBranch)
    const rule = firstOf(destinations, 'git-fetch-default-branch')
    if (rule !== null) return rule
  }
  if (sub === 'rebase') {
    // `git rebase <upstream> <branch>` checks out <branch> first.
    const rule = firstOf(operandsOf(words, REBASE_VALUED, true).operands.slice(1, 2), 'git-commit-default-branch')
    if (rule !== null) return rule
  }
  if (top !== null && (MOVES_CURRENT.has(sub) || (sub === 'stash' && (words[0] === 'pop' || words[0] === 'apply')))) {
    const current = currentBranch(top, roots, win, caseless)
    if (current === undefined) return 'git-commit-default-branch'
    if (current !== null) {
      const rule = judgeBranch(current, 'git-commit-default-branch')
      if (rule !== null) return rule
    }
  }
  const push = facts.push
  if (push === undefined) return null
  if (push.force) return 'git-force-push'
  if (push.delete) return 'git-push-delete'
  // --all and --mirror push the default branch too; --tags and --follow-tags are not told apart from them.
  if (push.many) return 'git-push-many'
  const current = top === null ? null : context.checkouts.find((checkout) => samePath(checkout.path, top, win))?.branch ?? null
  const destinations = push.refspecs.length === 0 ? [null] : push.refspecs.map((spec) => {
    const at = spec.indexOf(':')
    // `src:` with no destination pushes src to its own name.
    const destination = at < 0 ? spec : spec.slice(at + 1) === '' ? spec.slice(0, at) : spec.slice(at + 1)
    return destination === 'HEAD' || destination === '@' || destination === '' ? null : destinationBranch(destination)
  })
  for (const destination of destinations) {
    // A push of the current branch whose name is not known may reach the default branch.
    const branch = destination ?? (current === null ? null : branchName(current))
    if (branch === null || /[*?]/.test(branch) || protectedBranch(branch)) return 'git-push-default-branch'
    if (otherBranch(branch)) return 'git-other-branch'
  }
  return null
}

function samePath(a: string, b: string, win: boolean): boolean {
  const x = normalizePath(a, win)
  const y = normalizePath(b, win)
  return x !== null && y !== null && (win ? x.toLowerCase() === y.toLowerCase() : x === y)
}

/** A component `.git`, `.gitattributes` or `.gitmodules`: git config, hooks, attributes, submodules. */
function touchesGitFiles(path: string): boolean {
  return path.split(/[\\/]/).some(isGitFileName)
}

function hintOf(acts: Act[], actions: ShellAction[] | null, prepared: Prepared): Omit<Decision, 'targets'> | null {
  for (const act of acts) {
    for (const target of act.targets) if (target.placement.kind === 'symlink-on-path') return deny('symlink-on-path', HINTS.symlink)
  }
  for (const act of acts) {
    for (const target of act.targets) if (target.placement.kind === 'not-judged') return deny('not-judged', HINTS.unclearPath)
  }
  for (const [n, act] of acts.entries()) {
    // cp names its sources by their last component in a folder it copies into.
    const copies = actions?.[n]?.program === 'cp'
    for (const target of act.targets) {
      if (target.marker === 'unknown' || target.marker === 'repository') continue
      if (target.use === 'read' && !copies) continue
      // The written form, and the system's (a Windows short name such as GIT~1 is `.git` on disk).
      const real = touchesGitFiles(target.path) ? target.path : realPathOf(target.path, prepared.roots)
      if (real !== null && touchesGitFiles(real)) return deny('git-files', HINTS.gitFiles)
    }
  }
  for (const act of acts) {
    // git clean removes what is inside its folder, not the folder.
    const clean = act.git?.subcommand === 'clean'
    for (const target of act.targets) {
      if (target.placement.kind !== 'is-root') continue
      if ((target.use === 'delete' && !clean) || (act.fileTool && target.use === 'write')) return deny('whole-root', HINTS.wholeRoot)
    }
  }
  for (const [n, act] of acts.entries()) {
    // A folder copied or moved brings along what is inside it: .gitattributes too.
    const program = actions?.[n]?.program
    if ((program !== 'cp' && program !== 'mv') || !act.targets.every((target) => isInside(target.placement))) continue
    const follows = program === 'cp' && copyFollowsLinks(act.args, prepared.context.platform)
    for (const target of act.targets) {
      if (target.use === 'write' || target.marker !== null) continue
      const tree = copiedTree(target.path, prepared.roots, follows)
      if (tree === 'git-files') return deny('git-files', HINTS.gitFiles)
      if (tree === 'unclear') return deny('copy-unclear', HINTS.copyUnclear)
    }
  }
  const changes = acts.some((act) => act.git !== undefined || act.targets.some((target) => target.use !== 'read'))
  if (actions !== null && !changes && acts.every((act) => act.targets.every((target) => isInside(target.placement)))) return deny('read-only', HINTS.readOnly)
  return null
}

/**
 * Whether cp follows the links inside what it copies: `-L` or `--dereference` (the parser takes no shorter
 * form), and on macOS `-r` too (BSD cp makes it `-RL`). Only options before `--` count. A later `-P` is not
 * looked at: following is assumed.
 */
function copyFollowsLinks(args: readonly string[], platform: NodeJS.Platform): boolean {
  const end = args.indexOf('--')
  return (end < 0 ? args : args.slice(0, end)).some((word) =>
    word === '--dereference' || (/^-[A-Za-z]+$/.test(word) && (word.includes('L') || (platform === 'darwin' && word.includes('r')))))
}

function allowOrPark(acts: Act[], targets: string[]): Decision {
  const inside = acts.every((act) => act.targets.every((target) => target.marker !== 'unknown' && isInside(target.placement)))
  if (inside) {
    const used: string[] = []
    const all = acts.every((act) => {
      const rule = ALLOW_RULES.find((each) => each.match(act))
      if (rule !== undefined && !used.includes(rule.id)) used.push(rule.id)
      return rule !== undefined
    })
    if (all && used.length > 0) {
      const ordered = ALLOW_RULES.map((rule) => rule.id).filter((id) => used.includes(id))
      return { outcome: 'allow', rule: ordered.join('+'), hint: null, targets }
    }
  }
  return { outcome: 'park', rule: 'outside-roots', hint: null, targets }
}

// --- File tools -----------------------------------------------------------------------------

/**
 * The path of a file tool as the tool opens it, still raw (`..` kept for resolveTarget); null when it is
 * not absolute as given: Claude Code trims spaces and expands `~`, which this does not repeat. Windows: a
 * path rooted without a drive (`\Users\x`, `/x`) is on the drive of `cwd`; `\\?\C:\x` is `C:\x`; any
 * other `\\` path (a share, a device) is null.
 */
function toolPath(path: string, cwd: string, win: boolean): string | null {
  if (path === '' || path !== path.trim()) return null
  if (!win) return path.startsWith('/') ? path : null
  const verbatim = /^\\\\\?\\([A-Za-z]:\\.*)$/s.exec(path)?.[1]
  if (verbatim !== undefined) return verbatim
  if (/^[\\/]{2}/.test(path)) return null
  if (/^[\\/]/.test(path)) {
    const drive = normalizePath(cwd, win)?.slice(0, 2)
    return drive === undefined ? null : `${drive}${path}`
  }
  return /^[A-Za-z]:[\\/]/.test(path) ? path : null
}

function judgeFiles(tool: string, input: Record<string, unknown>, prepared: Prepared): Decision {
  const { context, roots, win } = prepared
  const given: string[] = []
  if (tool === 'fileChange') {
    const changes = Array.isArray(input['changes']) ? input['changes'] : []
    for (const change of changes) if (isRecord(change) && typeof change['path'] === 'string') given.push(change['path'])
    if (given.length !== changes.length) return deny('not-judged', HINTS.noTarget, [])
  } else {
    const path = tool === 'NotebookEdit' ? input['notebook_path'] : input['file_path']
    if (typeof path === 'string') given.push(path)
  }
  const raw = given.map((path) => toolPath(path, context.cwd, win))
  if (raw.length === 0 || raw.some((path) => path === null || normalizePath(path, win) === null)) return deny('not-judged', HINTS.noTarget, [])
  const act: Act = {
    program: tool,
    fileTool: true,
    args: [],
    git: undefined,
    network: false,
    // The raw path is judged (a `..` after a link goes up from the link's target); the folded one is reported.
    targets: (raw as string[]).map((path) => ({ path: normalizePath(path, win) ?? path, use: 'write' as const, marker: null, placement: resolveTarget(path, roots, 'write') })),
  }
  const targets = targetsOf([act])
  const hard = act.targets.find((target) => target.placement.kind === 'hard')
  if (hard !== undefined && hard.placement.kind === 'hard') return hardDeny(hard.placement.category, targets)
  const hinted = hintOf([act], null, prepared)
  if (hinted !== null) return { ...hinted, targets }
  return allowOrPark([act], targets)
}

// --- Helpers --------------------------------------------------------------------------------

function deny(rule: string, hint: string): Omit<Decision, 'targets'>
function deny(rule: string, hint: string, targets: string[]): Decision
function deny(rule: string, hint: string, targets?: string[]): Decision | Omit<Decision, 'targets'> {
  return targets === undefined ? { outcome: 'deny', rule, hint } : { outcome: 'deny', rule, hint, targets }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
