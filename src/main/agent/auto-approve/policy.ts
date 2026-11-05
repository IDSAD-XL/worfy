// The approval policy of unattended Sessions (worfy-auto-approve ticket 03; the Epic spec, how it
// works, items 1 and 3–6, and security, items 2–3 and 5–9). `judge` is a pure function of a
// permission request and its context — the file system comes through the context — and answers one
// Decision: allow, deny with a hint the agent can follow, park for the owner, or hard-deny, which no
// mode and no answer lifts. The mode (Shadow or On) does not change the outcome: Shadow only records
// it (ticket 04).
//
// The order is fixed:
// 1. hard deny (spec, item 5): a target in a hard area (roots.ts), a program that changes the OS or app
//    settings, chmod / chown outside the roots, a force push, a push that deletes, pushes refs it does
//    not name or reaches the default branch or a branch of another worktree, a delete of the default
//    branch or of a branch of another worktree, running what was downloaded, sending a file from
//    outside the roots;
// 2. a question (AskUserQuestion, a Card's question) — deny with a hint (spec, item 6; Q8 (a));
// 3. a command the parser (shell.ts) cannot judge — deny with a hint;
// 4. deny with a hint where the agent can rewrite: a symbolic link on a path, git config, hooks or
//    attributes (spec, security, item 9), a whole root deleted, a command that writes and deletes
//    nothing (ticket 01, category bash-other);
// 5. allow when every target is inside the roots and an allow rule (ALLOW_RULES) passes every action;
// 6. else park (Q3 (c)): parsed, but only the owner can decide.
//
// Hints are constants of this module, in English, never a piece of the request (spec, security,
// item 8). Git facts come from ShellAction.git, never from the words of the command; the URL a
// remote name stands for is in the repository's git config, which is not read here, so a push is
// never allowed (at most parked).
import type { SessionInfo } from '../session/types'
import { analyze, REPOSITORY, UNKNOWN, type ShellAction } from './shell'
import { joinPath, normalizePath, repositoryTop, resolveTarget, rootsOf, type FileSystem, type Placement, type Roots, type TargetUse } from './roots'

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
  /** The mode of Auto-approval; the outcome is the same in both. */
  mode: 'shadow' | 'on'
  platform: NodeJS.Platform
  /** The folder a Bash command starts in. */
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
  /** The file system; the machine's when absent. */
  fs?: FileSystem
}

/** One action as the rules see it, with each of its targets placed. */
export interface Act {
  /** The program, or for a file tool the tool's name. */
  program: string
  /** Whether it is a file tool (Edit, Write, MultiEdit, NotebookEdit, fileChange). */
  fileTool: boolean
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

export const HINTS = {
  hard: 'worfy never approves this, in any mode: it touches a protected folder or setting (secrets, the OS, worfy or the Harness, another Session\'s work) or history on a remote. Do not retry it in another form; leave it to the owner. After X=$(mktemp -d) use && or || exit 1 before using X.',
  question: 'No one is here to answer (worfy Autopilot). Decide by the rules of the Project, or write the question into the owner questions of the Ticket and go on.',
  notJudged: 'worfy could not read this command, so it did not approve it. Rewrite it in plain steps: literal paths, no loops, conditions, functions or command substitution, no variables from outside the command; put a longer script into a file in your scratchpad and run the file.',
  symlink: 'A path of this request goes through a symbolic link, which worfy never approves, wherever it leads. Use the real path, inside the Ticket\'s worktree, the Project\'s .scratch, the Run\'s TMPDIR or your scratchpad.',
  gitFiles: 'worfy never approves writing git config, hooks or attributes (.git/config, .git/hooks, .git/info/attributes, .gitattributes): through them any git command runs a program. Leave this change to the owner.',
  wholeRoot: 'This deletes a whole root folder (a worktree, .scratch, TMPDIR or the scratchpad). Delete what is inside it, by literal paths.',
  readOnly: 'This command writes and deletes nothing, and the check that stopped it is Claude Code\'s own, which worfy cannot repeat. Follow the reason Claude Code gave, or rewrite the command with literal paths.',
  noTarget: 'worfy could not find what this request changes, so it did not approve it. Give the full path.',
  noHome: 'worfy does not know the home folder of this Session, so it approves nothing here.',
} as const

// Programs that change the settings of the OS or of apps; `defaults` only with a subcommand that writes.
const OS_SETTINGS = new Set(['sudo', 'su', 'doas', 'launchctl', 'security', 'pfctl', 'socketfilterfw', 'netsh', 'reg', 'crontab'])
const DEFAULTS_READS = new Set(['read', 'read-type', 'domains', 'find', 'help'])
const CHANGES_OWNER = new Set(['chmod', 'chown', 'chgrp'])

interface Prepared {
  roots: Roots
  win: boolean
  context: PolicyContext
}

export function judge(request: ApprovalRequest, context: PolicyContext): Decision {
  if (QUESTION_TOOLS.has(request.tool)) return deny('question', HINTS.question, [])
  // Without the home folder its secrets cannot be found: nothing is approved.
  if (homeOf(context) === null) return deny('no-home', HINTS.noHome, [])
  const prepared = prepare(context)
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
  if (hard !== null) return { outcome: 'hard-deny', rule: `hard:${hard}`, hint: HINTS.hard, targets }
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
  return { program: action.program, fileTool: false, git: action.git, network: action.network, targets }
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
    const fed = from !== null && (actions[from]?.network === true || carries.has(from))
    if (action.network || fed) carries.add(n)
    if (fed && (SHELLS.has(programName(action.program)) || action.writes.includes(UNKNOWN))) return 'run-download'
  }
  for (const [n, action] of actions.entries()) {
    const act = acts[n] as Act
    const name = programName(action.program)
    if (OS_SETTINGS.has(name)) return 'os-settings'
    // A program outside the parser's table may run the next word (env, nohup, xargs, timeout…).
    if (action.writes.includes(UNKNOWN) && action.args.some((word) => OS_SETTINGS.has(programName(word)))) return 'os-settings'
    if (name === 'defaults' && !DEFAULTS_READS.has(action.args[0] ?? '')) return 'os-settings'
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

function gitHard(action: ShellAction, prepared: Prepared): string | null {
  const facts = action.git
  if (facts === undefined) return null
  const { context, roots, win } = prepared
  const protectedBranch = (branch: string): boolean => branch === context.defaultBranch || branch === 'main'
  const ofRun = (path: string): boolean => context.worktrees.some((wt) => samePath(wt, path, win))
  const otherBranch = (branch: string): boolean => context.checkouts.some((checkout) => checkout.branch !== null && branchName(checkout.branch) === branch && !ofRun(checkout.path))
  if (facts.branchDelete !== undefined) {
    for (const branch of facts.branchDelete.branches.map(branchName)) {
      if (protectedBranch(branch)) return 'git-branch-delete-default'
      if (otherBranch(branch)) return 'git-other-branch'
    }
  }
  const push = facts.push
  if (push === undefined) return null
  if (push.force) return 'git-force-push'
  if (push.delete) return 'git-push-delete'
  // --all and --mirror push the default branch too; --tags and --follow-tags are not told apart from them.
  if (push.many) return 'git-push-many'
  const top = repositoryTop(action.cwd, roots)
  const current = top === null ? null : context.checkouts.find((checkout) => samePath(checkout.path, top, win))?.branch ?? null
  const destinations = push.refspecs.length === 0 ? [null] : push.refspecs.map((spec) => {
    const at = spec.indexOf(':')
    // `src:` with no destination pushes src to its own name.
    const destination = at < 0 ? spec : spec.slice(at + 1) === '' ? spec.slice(0, at) : spec.slice(at + 1)
    return destination === 'HEAD' || destination === '@' || destination === '' ? null : branchName(destination)
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

/** A component `.git` or `.gitattributes`: git config, hooks, attributes. */
function touchesGitFiles(path: string): boolean {
  return path.split(/[\\/]/).some((part) => {
    const name = part.toLowerCase()
    return name === '.git' || name === '.gitattributes'
  })
}

function hintOf(acts: Act[], actions: ShellAction[] | null, prepared: Prepared): Omit<Decision, 'targets'> | null {
  for (const act of acts) {
    for (const target of act.targets) if (target.placement.kind === 'symlink-on-path') return deny('symlink-on-path', HINTS.symlink)
  }
  for (const [n, act] of acts.entries()) {
    // cp names its sources by their last component in a folder it copies into.
    const copies = actions?.[n]?.program === 'cp'
    for (const target of act.targets) {
      if (target.marker === 'unknown' || target.marker === 'repository') continue
      if ((target.use !== 'read' || copies) && (touchesGitFiles(target.path) || touchesGitFiles(realOf(target.path, prepared)))) return deny('git-files', HINTS.gitFiles)
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
  const changes = acts.some((act) => act.git !== undefined || act.targets.some((target) => target.use !== 'read'))
  if (actions !== null && !changes && acts.every((act) => act.targets.every((target) => isInside(target.placement)))) return deny('read-only', HINTS.readOnly)
  return null
}

/** The real path of `path` when it exists, for the git file check; else `path`. */
function realOf(path: string, prepared: Prepared): string {
  const real = prepared.roots.fs.realpath(path)
  return real === null ? path : normalizePath(real, prepared.win) ?? path
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

function judgeFiles(tool: string, input: Record<string, unknown>, prepared: Prepared): Decision {
  const { context, roots, win } = prepared
  const paths: string[] = []
  if (tool === 'fileChange') {
    const changes = Array.isArray(input['changes']) ? input['changes'] : []
    for (const change of changes) if (isRecord(change) && typeof change['path'] === 'string') paths.push(change['path'])
    if (paths.length !== changes.length) return deny('not-judged', HINTS.noTarget, [])
  } else {
    const path = tool === 'NotebookEdit' ? input['notebook_path'] : input['file_path']
    if (typeof path === 'string') paths.push(path)
  }
  if (paths.length === 0 || paths.some((path) => path === '')) return deny('not-judged', HINTS.noTarget, [])
  const base = normalizePath(context.cwd, win)
  const absolute = paths.map((path) => normalizePath(path, win) ?? (base === null ? path : joinPath(base, path, win)))
  const act: Act = {
    program: tool,
    fileTool: true,
    git: undefined,
    network: false,
    targets: absolute.map((path) => ({ path, use: 'write' as const, marker: null, placement: resolveTarget(path, roots, 'write') })),
  }
  const targets = targetsOf([act])
  const hard = act.targets.find((target) => target.placement.kind === 'hard')
  if (hard !== undefined && hard.placement.kind === 'hard') return { outcome: 'hard-deny', rule: `hard:${hard.placement.category}`, hint: HINTS.hard, targets }
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
