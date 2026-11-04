#!/usr/bin/env node
// How many permission requests unattended Sessions refused, and of what kind (worfy-auto-approve
// ticket 01). Run `node scripts/refusal-census.mjs --help`.
//
// Sources, read only:
//   - the Autopilot Journals, `<data>/autopilot/*.jsonl` (src/main/autopilot/journal.ts): a
//     `refused-dialog` line per refusal, with the tool and Claude Code's reason, never the command;
//   - the Claude Code transcripts, `<config>/projects/**/*.jsonl`: the refusal is a `tool_result`
//     whose text starts with UNATTENDED_DENIED_MESSAGE (src/main/vendors/claude/session.ts), and the
//     `tool_use` of the same id holds the command. A refusal is counted once by that id.
//
// The data is personal: commands, paths, Session ids, machine names. So the report holds numbers by
// category and nothing else. `--patterns` adds templates of the commands, in which only known
// command names, plain flags and shell operators survive (`rm -rf <var>/<glob>`); `--draft` adds
// how a rough draft of the Approval policy would have answered, as numbers. The script writes
// nothing: the report goes to stdout, and no file is opened for writing.
import { Buffer } from 'node:buffer'
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** The first words of the text a model reads when an unattended Session refused a call (session.ts). */
export const REFUSAL_TEXT = 'This Session runs unattended (worfy Autopilot)'
/** What follows the refusal text when Claude Code gave a reason (unattendedDeniedMessage). */
const REASON_HEAD = '\nrefused because: '
const REASON_TAIL = '; follow the reason above'
/** The day the agent rule "remove by a literal path, a script goes to a file" came in. */
export const RULE_DATE = '2026-10-20'

/** The categories of a refusal, in the order of the table of the spec. */
export const CATEGORIES = ['rm-after-cd-glob', 'rm-var-target', 'multiline-c-script', 'bash-other', 'ask-user-question', 'edit-write', 'mcp-tool', 'unknown-tool']
export const OUTCOMES = ['allow', 'deny', 'park', 'hard-deny']
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const HELP = `usage: node scripts/refusal-census.mjs [options]

Counts the permission requests unattended Sessions refused (worfy Autopilot), by category, from
the Autopilot Journals and the Claude Code transcripts. Prints numbers only: no command, path or id.
Reads only.

  --transcripts <folder>  Claude Code transcripts, read with every folder under it. Default:
                          <config>/projects, <config> being CLAUDE_CONFIG_DIR or ~/.claude.
  --journals <folder>     Autopilot Journals. Default: <data>/autopilot, <data> being WORFY_DATA_DIR
                          or the data folder of the installed worfy (~/Library/Application
                          Support/worfy on macOS, %APPDATA%\\worfy on Windows).
  --rule-date <day>       the day before/after counts split at, YYYY-MM-DD (UTC). Default ${RULE_DATE}.
  --patterns              add a template of each refused command per category.
  --draft                 add how a draft of the Approval policy would have answered each refusal.
  --json                  print the report as JSON.
  --help                  this text.

Exit code: 0 the report is printed; 1 neither source was found; 2 a wrong option, or a folder given
on the command line is not a folder.`

// ---------------------------------------------------------------------------------------------------
// The command line.

/** Options from the command line, or `{ error }`. */
export function parseArgs(args) {
  const options = { transcripts: null, journals: null, ruleDate: RULE_DATE, patterns: false, draft: false, json: false, help: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--patterns') options.patterns = true
    else if (arg === '--draft') options.draft = true
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--transcripts' || arg === '--journals' || arg === '--rule-date') {
      const value = args[++i]
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` }
      if (arg === '--rule-date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return { error: '--rule-date takes YYYY-MM-DD' }
        options.ruleDate = value
      } else options[arg.slice(2)] = value
    } else return { error: `unknown option: ${arg}` }
  }
  return options
}

/** The Journal folder of the installed worfy (src/main/storage/paths.ts, dataRoot, kind "stable"). */
export function defaultJournals(env, home, platform) {
  if (env.WORFY_DATA_DIR) return join(env.WORFY_DATA_DIR, 'autopilot')
  if (platform === 'win32') {
    const appData = env.APPDATA !== undefined && /^[A-Za-z]:[\\/]/.test(env.APPDATA) ? env.APPDATA : win32.join(home, 'AppData', 'Roaming')
    return win32.join(appData, 'worfy', 'autopilot')
  }
  return join(home, 'Library', 'Application Support', 'worfy', 'autopilot')
}

/** The transcript folder of Claude Code. */
export function defaultTranscripts(env, home) {
  return join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'projects')
}

const defaultDeps = () => ({
  env: process.env,
  home: homedir(),
  platform: process.platform,
  out: (text) => process.stdout.write(text),
  err: (line) => process.stderr.write(`${line}\n`),
})

/** The whole run: the exit code. Messages name options, never the folders given. */
export async function refusalCensus(args, deps = defaultDeps()) {
  const options = parseArgs(args)
  if ('error' in options) {
    deps.err(`refusal-census: ${options.error} (see --help)`)
    return 2
  }
  if (options.help) {
    deps.out(`${HELP}\n`)
    return 0
  }
  for (const name of ['transcripts', 'journals']) {
    if (options[name] !== null && !isFolder(options[name])) {
      deps.err(`refusal-census: --${name}: not a folder`)
      return 2
    }
  }
  const transcriptsDir = options.transcripts ?? defaultTranscripts(deps.env, deps.home)
  const journalsDir = options.journals ?? defaultJournals(deps.env, deps.home, deps.platform)
  const ruleAt = Date.parse(`${options.ruleDate}T00:00:00.000Z`)
  const journals = isFolder(journalsDir) ? journalCensus(journalsDir, ruleAt) : { found: false }
  const transcripts = isFolder(transcriptsDir) ? transcriptCensus(transcriptsDir, ruleAt, options, deps.home) : { found: false }
  if (!journals.found && !transcripts.found) {
    deps.err('refusal-census: found neither the Journal folder nor the transcript folder (see --help)')
    return 1
  }
  const report = { rule: options.ruleDate, journals, transcripts }
  deps.out(options.json ? `${JSON.stringify(report, null, 2)}\n` : text(report))
  return 0
}

// ---------------------------------------------------------------------------------------------------
// Journals.

function journalCensus(dir, ruleAt) {
  const result = {
    found: true,
    runs: 0,
    runsBeforeRule: 0,
    runsAfterRule: 0,
    refusedLines: 0,
    unreadableLines: 0,
    byDialog: {},
    byTool: {},
    withReason: 0,
    byReason: {},
    runsWithRefusal: { beforeRule: 0, afterRule: 0 },
  }
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.jsonl')) continue
    let raw
    try {
      raw = readFileSync(join(dir, name), 'utf8')
    } catch {
      continue
    }
    let started = null
    let first = null
    let refused = 0
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      const event = parse(line)
      if (event === null) {
        result.unreadableLines++
        continue
      }
      const at = typeof event.at === 'string' ? Date.parse(event.at) : Number.NaN
      if (first === null && !Number.isNaN(at)) first = at
      if (event.kind === 'run-started' && started === null && !Number.isNaN(at)) started = at
      if (event.kind !== 'refused-dialog') continue
      refused++
      result.refusedLines++
      const what = typeof event.what === 'string' ? event.what : ''
      const space = what.indexOf(' ')
      const dialog = space < 0 ? what : what.slice(0, space)
      const known = dialog === 'permission_request' || dialog === 'card_ask'
      add(result.byDialog, known ? dialog : 'other')
      if (dialog === 'permission_request') add(result.byTool, toolLabel(what.slice(space + 1)))
      if (typeof event.reason === 'string' && event.reason !== '') {
        result.withReason++
        add(result.byReason, cleanReason(event.reason))
      }
    }
    const runAt = started ?? first ?? Date.parse(name.slice(0, 10))
    if (Number.isNaN(runAt)) continue
    result.runs++
    const before = runAt < ruleAt
    if (before) result.runsBeforeRule++
    else result.runsAfterRule++
    if (refused > 0) result.runsWithRefusal[before ? 'beforeRule' : 'afterRule']++
  }
  return result
}

// ---------------------------------------------------------------------------------------------------
// Transcripts.

function transcriptCensus(dir, ruleAt, options, home) {
  const result = {
    found: true,
    files: 0,
    filesWithRefusal: 0,
    unreadableLines: 0,
    refusals: 0,
    days: 0,
    byCategory: Object.fromEntries(CATEGORIES.map((category) => [category, 0])),
    byCategoryAfterRule: Object.fromEntries(CATEGORIES.map((category) => [category, 0])),
    byCategoryFromSubagent: Object.fromEntries(CATEGORIES.map((category) => [category, 0])),
    byReason: {},
    byDay: {},
    beforeRule: 0,
    afterRule: 0,
  }
  if (options.patterns) result.patterns = {}
  if (options.draft) {
    result.draft = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0]))
    result.draftByCategory = {}
    result.draftWhy = {}
  }
  const seen = new Set()
  const needle = Buffer.from(REFUSAL_TEXT)
  for (const file of jsonlFiles(dir)) {
    result.files++
    let buffer
    try {
      buffer = readFileSync(file)
    } catch {
      continue
    }
    if (!buffer.includes(needle)) continue
    const lines = []
    for (const line of buffer.toString('utf8').split('\n')) {
      if (line.trim() === '') continue
      const value = parse(line)
      if (value === null) result.unreadableLines++
      else lines.push(value)
    }
    const uses = new Map()
    for (const line of lines) for (const block of blocks(line)) if (block?.type === 'tool_use' && typeof block.id === 'string') uses.set(block.id, block)
    let found = false
    lines.forEach((line, index) => {
      for (const block of blocks(line)) {
        if (block?.type !== 'tool_result') continue
        const body = resultText(block.content)
        if (!body.startsWith(REFUSAL_TEXT)) continue
        const key = typeof block.tool_use_id === 'string' ? block.tool_use_id : `${file}:${index}`
        if (seen.has(key)) continue
        seen.add(key)
        found = true
        const use = uses.get(block.tool_use_id)
        const tool = typeof use?.name === 'string' ? use.name : null
        const input = use?.input ?? null
        const category = classify(tool, input)
        result.refusals++
        result.byCategory[category]++
        // A Subagent's line carries its agentId; its transcript lies in <session>/subagents/.
        if (typeof line.agentId === 'string' || /[\\/]subagents[\\/]/.test(file)) result.byCategoryFromSubagent[category]++
        add(result.byReason, reasonOf(body))
        const at = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : Number.NaN
        if (!Number.isNaN(at)) {
          add(result.byDay, new Date(at).toISOString().slice(0, 10))
          if (at < ruleAt) result.beforeRule++
          else {
            result.afterRule++
            result.byCategoryAfterRule[category]++
          }
        }
        if (options.patterns) add((result.patterns[category] ??= {}), pattern(tool, input))
        if (options.draft) {
          const { outcome, why } = draftVerdict({ tool, input, cwd: typeof line.cwd === 'string' ? line.cwd : null }, home)
          result.draft[outcome]++
          add((result.draftByCategory[category] ??= {}), outcome)
          add(result.draftWhy, `${outcome}: ${why}`)
        }
      }
    })
    if (found) result.filesWithRefusal++
  }
  result.days = Object.keys(result.byDay).length
  result.byDay = Object.fromEntries(Object.entries(result.byDay).sort(([a], [b]) => a.localeCompare(b)))
  return result
}

const blocks = (line) => (Array.isArray(line?.message?.content) ? line.message.content : [])

function resultText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('')
  return ''
}

/** Claude Code's reason in a refusal text, cleaned; "(none)" without one. */
function reasonOf(body) {
  const head = body.indexOf(REASON_HEAD)
  if (head < 0) return '(none)'
  const rest = body.slice(head + REASON_HEAD.length)
  const tail = rest.lastIndexOf(REASON_TAIL)
  return cleanReason(tail < 0 ? rest : rest.slice(0, tail))
}

function* jsonlFiles(dir) {
  let names
  try {
    names = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* jsonlFiles(path)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield path
  }
}

// ---------------------------------------------------------------------------------------------------
// Cleaning: what of a reason, a tool name or a command may be printed.

/** Claude Code's reason with code, quoted text, paths, variables and ids replaced; at most 120 units. */
export function cleanReason(reason) {
  const cleaned = reason
    .replace(/`[^`]*`/g, '<code>')
    .replace(/"[^"]*"|'[^']*'/g, '<quoted>')
    .replace(/(^|[\s(=:,])(?:[A-Za-z]:[\\/]|~|\.{1,2}[\\/]|[\\/])\S*/g, '$1<path>')
    .replace(/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g, '<var>')
    .replace(/\b(?=[0-9a-f-]*\d)[0-9a-f]{8,}(?:-[0-9a-f]+)*\b/gi, '<id>')
    .replace(/\s+/g, ' ')
    .trim()
  return clip(cleaned, 120)
}

/** A tool name that may be printed: built-in names as they are, MCP tools as one label. */
function toolLabel(name) {
  if (name.startsWith('mcp__')) return 'mcp tool'
  return /^[A-Z][A-Za-z]+$/.test(name) ? name : '<tool>'
}

const clip = (value, max) => (value.length <= max ? value : `${value.slice(0, max - 1)}…`)

// ---------------------------------------------------------------------------------------------------
// The shell: a small lexer, enough to sort and template a command; not a shell parser (Ticket 02).
//
// A word keeps `text`, its value with the quotes taken off and `$NAME` left as written, and
// `shape`, the same with markers: VAR+name+VAR for a variable, SUBST+n+SUBST for a command
// substitution (its text in `substs[n]`), GLOB+char for an unquoted `*` or `?`.

const VAR = '\u0001'
const SUBST = '\u0002'
const GLOB = '\u0003'
const OPERATORS = ['&&', '||', ';;', ';', '|', '&', '\n', '(', ')']

/** Segments of a command: `{ sep, words }`, sep being the operator before it ('' for the first). */
export function lex(command) {
  const segments = []
  let words = []
  let sep = ''
  let word = null
  const substs = []
  const start = () => (word ??= { text: '', shape: '', substs })
  // A here-document: the word after `<<` is its delimiter, and its body (the lines after the
  // current one, up to the delimiter) is text, not commands. The body is skipped.
  let delimiterNext = false
  const delimiters = []
  const end = () => {
    if (word !== null) {
      words.push(word)
      if (delimiterNext) delimiters.push(word.text)
    }
    delimiterNext = false
    word = null
  }
  const skipBodies = () => {
    // command[i] is the newline that ends the line of the `<<`
    while (delimiters.length > 0) {
      const delimiter = delimiters.shift()
      let next = command.indexOf('\n', i + 1)
      while (next >= 0 || i + 1 < command.length) {
        const stop = next < 0 ? command.length : next
        const line = command.slice(i + 1, stop)
        i = stop
        if (line.trim() === delimiter || next < 0) break
        next = command.indexOf('\n', i + 1)
      }
    }
  }
  // A blank line keeps the operator before it: `a &&` and `b` on the next line are joined by &&.
  const cut = (op) => {
    end()
    if (words.length > 0) {
      segments.push({ sep, words })
      words = []
      sep = op
    } else if (op !== '\n' && segments.length > 0) sep = op
  }
  const literal = (char) => {
    start()
    word.text += char
    word.shape += char
  }
  let i = 0
  const dollar = () => {
    // command[i] is '$'
    const next = command[i + 1]
    if (next === '(') {
      const close = balanced(command, i + 1, '(', ')')
      const inner = command.slice(i + 2, close)
      start()
      word.text += command.slice(i, close + 1)
      word.shape += `${SUBST}${substs.push(inner) - 1}${SUBST}`
      i = close + 1
      return
    }
    if (next === '{') {
      const close = command.indexOf('}', i + 2)
      const stop = close < 0 ? command.length : close
      const name = command.slice(i + 2, stop).replace(/[^A-Za-z0-9_].*$/s, '')
      start()
      word.text += command.slice(i, stop + 1)
      word.shape += `${VAR}${name}${VAR}`
      i = stop + 1
      return
    }
    const match = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(command.slice(i + 1))
    if (match === null) {
      literal('$')
      i++
      return
    }
    start()
    word.text += `$${match[0]}`
    word.shape += `${VAR}${match[0]}${VAR}`
    i += 1 + match[0].length
  }
  const backtick = () => {
    let close = command.indexOf('`', i + 1)
    if (close < 0) close = command.length
    start()
    word.text += command.slice(i, close + 1)
    word.shape += `${SUBST}${substs.push(command.slice(i + 1, close)) - 1}${SUBST}`
    i = close + 1
  }
  while (i < command.length) {
    const char = command[i]
    if (char === '\\') {
      if (command[i + 1] === '\n') i += 2
      else {
        literal(command[i + 1] ?? '')
        i += 2
      }
      continue
    }
    if (char === "'") {
      const close = command.indexOf("'", i + 1)
      const stop = close < 0 ? command.length : close
      start()
      word.text += command.slice(i + 1, stop)
      word.shape += command.slice(i + 1, stop)
      i = stop + 1
      continue
    }
    if (char === '"') {
      start()
      i++
      while (i < command.length && command[i] !== '"') {
        const inner = command[i]
        if (inner === '\\' && '$`"\\\n'.includes(command[i + 1] ?? '')) {
          if (command[i + 1] !== '\n') literal(command[i + 1])
          i += 2
        } else if (inner === '$') dollar()
        else if (inner === '`') backtick()
        else {
          literal(inner)
          i++
        }
      }
      i++
      continue
    }
    if (char === '$') {
      dollar()
      continue
    }
    if (char === '`') {
      backtick()
      continue
    }
    if (char === '#' && word === null) {
      while (i < command.length && command[i] !== '\n') i++
      continue
    }
    if (char === ' ' || char === '\t') {
      end()
      i++
      continue
    }
    if (char === '>' || char === '<' || (char === '&' && command[i + 1] === '>')) {
      if (word !== null && /^\d+$/.test(word.text)) word = null
      else end()
      let op = char === '&' ? '&>' : char
      i += op.length
      if (command[i] === char && char === '<') {
        op += '<'
        i++
        if (command[i] === '<') {
          op += '<'
          i++
        } else {
          if (command[i] === '-') {
            op += '-'
            i++
          }
          delimiterNext = true
        }
      } else if (command[i] === '>') {
        op += '>'
        i++
      }
      if (command[i] === '&') {
        const digits = /^&\d*-?/.exec(command.slice(i))[0]
        op += digits
        i += digits.length
      }
      words.push({ text: op, shape: op, substs, redirect: true })
      while (command[i] === ' ' || command[i] === '\t') i++
      continue
    }
    const op = OPERATORS.find((candidate) => command.startsWith(candidate, i))
    if (op !== undefined) {
      if (op === '\n') {
        end()
        skipBodies()
      }
      cut(op)
      i += op.length
      continue
    }
    if (char === '*' || char === '?') {
      start()
      word.text += char
      word.shape += `${GLOB}${char}`
      i++
      continue
    }
    literal(char)
    i++
  }
  cut('')
  return segments
}

/** The index of the bracket that closes the one at `open`, or the end of the text. */
function balanced(text, open, left, right) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === left) depth++
    else if (text[i] === right && --depth === 0) return i
  }
  return text.length
}

const KEYWORDS = new Set(['for', 'in', 'do', 'done', 'if', 'then', 'elif', 'else', 'fi', 'while', 'until', 'case', 'esac', '{', '}', '!', 'time'])
const LEADING_KEYWORDS = new Set(['do', 'then', 'elif', 'else', '{', '!', 'time'])
const isAssignment = (word) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word.shape)
const isLiteral = (word) => ![VAR, SUBST, GLOB].some((marker) => word.shape.includes(marker))
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
const isScriptFlag = (word) => isLiteral(word) && /^-[A-Za-z]*c[A-Za-z]*$/.test(word.text)
const baseName = (text) => text.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '')

/** Where the command word of a segment is: after leading keywords and assignments; -1 if none. */
function commandIndex(words) {
  let i = 0
  while (i < words.length && isLiteral(words[i]) && LEADING_KEYWORDS.has(words[i].text)) i++
  while (i < words.length && isAssignment(words[i])) i++
  return i < words.length ? i : -1
}

const commandName = (words) => {
  const at = commandIndex(words)
  return at < 0 || !isLiteral(words[at]) ? null : baseName(words[at].text)
}

/** The script of `sh -c <script>` in a segment, as a word, or null. */
function scriptWord(words) {
  const at = commandIndex(words)
  if (at < 0 || !SHELLS.has(commandName(words) ?? '')) return null
  for (let i = at + 1; i < words.length; i++) if (isScriptFlag(words[i])) return words[i + 1] ?? null
  return null
}

const isFlag = (word) => isLiteral(word) && word.text.startsWith('-') && word.text !== '-'

/** The category of a refused call. */
export function classify(tool, input) {
  if (tool === null) return 'unknown-tool'
  if (tool === 'Bash') return bashCategory(typeof input?.command === 'string' ? input.command : '')
  if (tool === 'AskUserQuestion') return 'ask-user-question'
  if (EDIT_TOOLS.has(tool)) return 'edit-write'
  if (tool.startsWith('mcp__')) return 'mcp-tool'
  return 'unknown-tool'
}

function bashCategory(command) {
  const segments = lex(command)
  if (segments.some(({ words }) => scriptWord(words)?.text.includes('\n'))) return 'multiline-c-script'
  let cd = false
  let cdGlob = false
  let varTarget = false
  for (const { words } of segments) {
    const name = commandName(words)
    if (name === 'cd') cd = true
    if (name !== 'rm') continue
    for (const word of words.slice(commandIndex(words) + 1)) {
      if (isFlag(word) || word.redirect) continue
      if (cd && word.shape.includes(GLOB)) cdGlob = true
      if (word.shape.includes(VAR)) varTarget = true
    }
  }
  if (cdGlob) return 'rm-after-cd-glob'
  if (varTarget) return 'rm-var-target'
  return 'bash-other'
}

const KNOWN_COMMANDS = new Set(
  'rm rmdir cd mv cp mkdir touch ln ls cat find xargs git gh pnpm npm npx node sh bash zsh echo printf grep rg sed awk head tail mktemp chmod chown tar curl wget test [ export trap wait sleep kill pkill env set unset sudo defaults launchctl security open python python3 jq sort uniq wc diff cmp tee true false exit return source eval . read basename dirname realpath pwd which command type'.split(' '),
)
const WITH_SUBCOMMANDS = new Set(['git', 'gh', 'pnpm', 'npm'])
const SUBCOMMANDS = new Set(
  'push pull commit add rm mv worktree branch checkout switch reset clean status diff log fetch merge rebase stash tag show rev-parse clone remote config pr run install test exec api issue list remove prune restore'.split(' '),
)
const PLAIN_FLAG = /^--?[A-Za-z][A-Za-z0-9-]{0,24}$/
const SEPARATORS = { '&&': ' && ', '||': ' || ', '|': ' | ', '&': ' & ', ';': '; ', ';;': '; ', '\n': '; ', '(': ' ( ', ')': ' ) ', '': '' }

/** A template of a refused call that names no path, value or id: `rm -rf <var>/<glob>`. */
export function pattern(tool, input) {
  if (tool === null) return '(no tool_use)'
  if (tool !== 'Bash') return toolLabel(tool)
  const command = typeof input?.command === 'string' ? input.command : ''
  let out = ''
  for (const { sep, words } of lex(command)) {
    out += SEPARATORS[sep] ?? ' '
    out += segmentPattern(words)
  }
  return clip(out.replace(/^[;&|( ]+/, '').trim(), 160)
}

function segmentPattern(words) {
  const at = commandIndex(words)
  const name = commandName(words)
  const script = scriptWord(words)
  return words
    .map((word, index) => {
      if (word === script) return `<script: ${word.text.split('\n').length} lines>`
      if (word.redirect) return word.text
      if (index === at) return name !== null && (KNOWN_COMMANDS.has(name) || KEYWORDS.has(name)) ? name : '<cmd>'
      if (at < 0 || index < at) return isAssignment(word) ? `<var>=${placeholder(word.shape.slice(word.shape.indexOf('=') + 1))}` : word.text
      if (name === 'for' && isLiteral(word) && word.text === 'in') return 'in'
      if (isLiteral(word) && PLAIN_FLAG.test(word.text)) return word.text
      if (isLiteral(word) && WITH_SUBCOMMANDS.has(name ?? '') && SUBCOMMANDS.has(word.text)) return word.text
      return placeholder(word.shape)
    })
    .join(' ')
}

/** A word shape as placeholders: `<arg>`, `<path>`, `<var>`, `<glob>`, `<subst>`, joined by '/'. */
function placeholder(shape) {
  const kind = (part) => (part.includes(SUBST) ? '<subst>' : part.includes(VAR) ? '<var>' : part.includes(GLOB) ? '<glob>' : null)
  if (!shape.includes('/')) return kind(shape) ?? (shape.startsWith('~') ? '<path>' : '<arg>')
  const parts = []
  for (const part of shape.split('/')) {
    const marked = kind(part)
    if (marked !== null) parts.push(marked)
    else if (parts.at(-1) !== '<path>') parts.push('<path>')
  }
  return parts.join('/')
}

// ---------------------------------------------------------------------------------------------------
// The draft policy: a rough sketch of Ticket 03's Approval policy, to count what the past refusals
// would have got. Roots: the worktrees of the repository of the Session's cwd
// (`<repo>/.claude/worktrees/<name>`), its `.scratch`, Claude Code's scratchpad (`/tmp/claude-…`) and
// the run's temporary folder `mktemp -d` would give. Inside a root, not the root itself: allow. A
// target that cannot be read (an unknown variable, a substitution, a loop): deny, with a hint the
// agent can follow. Outside the roots: park. The secrets of the home folder and the settings of the
// system: hard-deny. Questions: deny. Symlinks are not checked: the files may be gone.

const RUN_TMP = '/@run-tmp'
const PROTECTED = ['.claude', '.codex', '.ssh', '.gnupg', '.config/gh', '.gitconfig', '.npmrc', '.zshrc', '.zprofile', '.bashrc', '.bash_profile', '.profile', 'Library', 'AppData']
const SYSTEM_COMMANDS = new Set(['sudo', 'doas', 'defaults', 'launchctl', 'security', 'crontab', 'pfctl', 'socketfilterfw', 'netsh', 'reg'])
const CONTROL = new Set(['for', 'while', 'until', 'if', 'case', 'select', 'function', 'eval', 'source', '.'])
/** zsh built-ins that change how the rest of the script reads (spec, "How it works", item 2). */
const ZSH_BUILTINS = new Set(['zmodload', 'autoload', 'setopt', 'unsetopt', 'emulate', 'typeset', 'zstyle', 'zparseopts'])
const RANK = { allow: 0, park: 1, deny: 2, 'hard-deny': 3 }
/** The harder of two verdicts `{ outcome, why }`; on a tie the first. Either may be null (nothing judged). */
const worst = (a, b) => (a === null ? b : b === null ? a : RANK[b.outcome] > RANK[a.outcome] ? b : a)
const verdict = (outcome, why) => ({ outcome, why })

/** What the draft policy would have answered: allow, deny, park or hard-deny. */
export function draftOutcome(refusal, home) {
  return draftVerdict(refusal, home).outcome
}

/** The draft answer with why: `{ outcome, why }`, why being one of a few fixed labels. */
export function draftVerdict({ tool, input, cwd }, home) {
  if (tool === null) return verdict('park', 'no tool_use')
  if (tool === 'AskUserQuestion') return verdict('deny', 'question')
  const windows = /^[A-Za-z]:[\\/]/.test(cwd ?? '') || /^[A-Za-z]:[\\/]/.test(home)
  const norm = (path) => normalize(path, windows)
  const context = { home: norm(home), cwd: cwd === null ? null : norm(cwd), norm }
  if (EDIT_TOOLS.has(tool)) {
    const file = input?.file_path ?? input?.notebook_path
    if (typeof file !== 'string' || context.cwd === null) return verdict('deny', 'no input')
    return judgePath(resolvePath(context.cwd, norm(file)), context)
  }
  if (tool !== 'Bash') return verdict('park', 'tool without a rule')
  if (typeof input?.command !== 'string' || context.cwd === null) return verdict('deny', 'no input')
  const state = { cwd: context.cwd, vars: new Map([['HOME', context.home]]), tmp: 0 }
  return judgeScript(input.command, state, context) ?? verdict('deny', 'nothing to judge')
}

/** The verdict of a script, or null when nothing in it writes or removes. */
function judgeScript(command, state, context) {
  let result = null
  for (const { words } of lex(command)) {
    result = worst(result, judgeSegment(words, state, context))
    if (result?.outcome === 'hard-deny') break
  }
  return result
}

const UNREADABLE = verdict('deny', 'unknown variable or substitution')

function judgeSegment(words, state, context) {
  if (words.every((word) => isLiteral(word) && KEYWORDS.has(word.text))) return null
  const at = commandIndex(words)
  for (const word of words.slice(0, at < 0 ? words.length : at)) {
    if (!isAssignment(word)) continue
    const [name] = word.text.split('=', 1)
    state.vars.set(name, assignedValue(word, state))
  }
  if (at < 0) return null
  const first = words[at]
  if (!isLiteral(first)) return UNREADABLE
  const name = baseName(first.text)
  if (CONTROL.has(name)) return verdict('deny', 'loop, condition or eval')
  if (SYSTEM_COMMANDS.has(name)) return verdict('hard-deny', 'system command')
  if (ZSH_BUILTINS.has(name)) return verdict('deny', 'zsh built-in')
  const args = words.slice(at + 1)
  if (args.some((word) => word.redirect && word.text.startsWith('<<'))) return verdict('deny', 'here-document')
  let result = null
  const judge = (word) => {
    const target = expand(word, state, context)
    result = worst(result, target === null ? UNREADABLE : judgePath(target.path, context))
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i].redirect && /^&?>>?$/.test(args[i].text) && args[i + 1] !== undefined) {
      if (args[i + 1].text !== '/dev/null') judge(args[i + 1])
      args.splice(i, 2)
      i--
    }
  }
  const operands = args.filter((word) => !isFlag(word) && !word.redirect)
  if (name === 'cd') {
    const target = operands[0] === undefined ? { path: context.home, glob: false } : expand(operands[0], state, context)
    if (target === null || target.glob) return UNREADABLE
    state.cwd = target.path
    return result
  }
  if (SHELLS.has(name)) {
    const script = scriptWord(words)
    if (script === null) return result
    if (!isLiteral(script)) return UNREADABLE
    return worst(result, judgeScript(script.text, { ...state, vars: new Map(state.vars) }, context))
  }
  if (name === 'trap') {
    // `trap '<script>' EXIT`: the script runs later, in this shell, with these variables.
    if (operands[0] === undefined) return result
    if (!isLiteral(operands[0])) return UNREADABLE
    return worst(result, judgeScript(operands[0].text, { ...state, vars: new Map(state.vars) }, context))
  }
  if (name === 'git') return operands.some((word) => word.text === 'push') ? worst(result, verdict('park', 'git push')) : result
  if (['rm', 'rmdir', 'mkdir', 'touch', 'unlink', 'mv'].includes(name)) for (const word of operands) judge(word)
  else if (['cp', 'ln'].includes(name) && operands.length > 0) judge(operands.at(-1))
  return result
}

/** The value an assignment gives: a literal, a new folder of the run for `$(mktemp -d)`, or null. */
function assignedValue(word, state) {
  const value = word.shape.slice(word.shape.indexOf('=') + 1)
  const subst = new RegExp(`^${SUBST}(\\d+)${SUBST}$`).exec(value)
  if (subst !== null) return /^\s*mktemp\s+-d\b[^|;&]*$/.test(word.substs[Number(subst[1])]) ? `${RUN_TMP}/tmp.${++state.tmp}` : null
  return expandShape(value, state)
}

/** A word's text with known variables put in; null when a variable is unknown or a command runs. */
function expandShape(shape, state) {
  if (shape.includes(SUBST)) return null
  let unknown = false
  const text = shape.replace(new RegExp(`${VAR}([^${VAR}]*)${VAR}`, 'g'), (_, name) => {
    const value = state.vars.get(name)
    if (value === undefined || value === null) unknown = true
    return value ?? ''
  })
  return unknown ? null : text
}

/** The absolute target of a word: `{ path, glob }`, glob meaning "what is inside path"; null if unreadable. */
function expand(word, state, context) {
  const parts = word.shape.split('/')
  const globAt = parts.findIndex((part) => part.includes(GLOB))
  if (globAt >= 0 && globAt !== parts.length - 1) return null
  const shape = globAt < 0 ? word.shape : parts.slice(0, -1).join('/') || (word.shape.startsWith('/') ? '/' : '.')
  let text = expandShape(shape, state)
  if (text === null) return null
  if (text === '~' || text.startsWith('~/')) text = context.home + text.slice(1)
  return { path: resolvePath(state.cwd, context.norm(text)), glob: globAt >= 0 }
}

/** A path with `/` only; on Windows lower case, `C:\x` and Git Bash `/c/x` both `c:/x`. */
function normalize(path, windows) {
  if (!windows) return path
  const slashed = path.replace(/\\/g, '/')
  const drive = /^\/([A-Za-z])(\/|$)/.exec(slashed)
  return (drive === null ? slashed : `${drive[1]}:/${slashed.slice(3)}`).toLowerCase()
}

/** `path` against `base`, with `.` and `..` folded; both normalized. */
function resolvePath(base, path) {
  const absolute = path.startsWith('/') || /^[a-z]:\//i.test(path)
  const full = absolute ? path : `${base}/${path}`
  const root = /^[a-z]:\//i.test(full) ? full.slice(0, 3) : '/'
  const parts = []
  for (const part of full.slice(root.length).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return root + parts.join('/')
}

const within = (path, folder) => path === folder || path.startsWith(folder.endsWith('/') ? folder : `${folder}/`)

/**
 * The verdict for one target. For `rm -rf path/*` the target is `path`: removing what is inside a
 * root is removing the root, so both are denied.
 */
function judgePath(path, context) {
  const home = context.home
  if (within(home, path) || PROTECTED.some((name) => within(path, `${home}/${context.norm(name)}`))) return verdict('hard-deny', 'home folder or its secrets')
  const root = rootOf(path, context)
  if (root === null) return verdict('park', 'outside the roots')
  return path === root ? verdict('deny', 'a whole root') : verdict('allow', 'inside a root')
}

/** The root a path lies in, or null. */
function rootOf(path, context) {
  const roots = [RUN_TMP]
  const scratchpad = /^(?:\/private)?\/tmp\/claude-[^/]+/.exec(path)
  if (scratchpad !== null) roots.push(scratchpad[0])
  if (context.cwd !== null) {
    const repo = context.cwd.split('/.claude/worktrees/')[0]
    roots.push(`${repo}/.scratch`)
    const tree = new RegExp(`^${escape(`${repo}/.claude/worktrees/`)}[^/]+`).exec(path)
    if (tree !== null) roots.push(tree[0])
  }
  return roots.find((root) => within(path, root)) ?? null
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---------------------------------------------------------------------------------------------------
// The text report.

function text(report) {
  const lines = [`refusal census (rule ${report.rule})`, '']
  const table = (title, counts) => {
    const entries = Object.entries(counts ?? {})
    if (entries.length === 0) return
    lines.push(`  ${title}:`)
    const width = Math.max(...entries.map(([key]) => key.length))
    for (const [key, value] of entries) lines.push(`    ${key.padEnd(width)}  ${value}`)
  }
  const { journals: j, transcripts: t } = report
  if (!j.found) lines.push('journals: folder not found')
  else {
    lines.push(`journals: ${j.runs} runs (${j.runsBeforeRule} before the rule, ${j.runsAfterRule} after), ${j.refusedLines} refused-dialog lines, ${j.unreadableLines} unreadable lines`)
    lines.push(`  runs with a refusal: ${j.runsWithRefusal.beforeRule} before the rule, ${j.runsWithRefusal.afterRule} after; lines with a reason: ${j.withReason}`)
    table('by dialog', j.byDialog)
    table('by tool', j.byTool)
    table('by reason', j.byReason)
  }
  lines.push('')
  if (!t.found) lines.push('transcripts: folder not found')
  else {
    lines.push(`transcripts: ${t.files} read, ${t.filesWithRefusal} with a refusal, ${t.unreadableLines} unreadable lines`)
    lines.push(`  refusals: ${t.refusals} on ${t.days} days (${t.beforeRule} before the rule, ${t.afterRule} after)`)
    table('by category', t.byCategory)
    table('by category, after the rule', t.byCategoryAfterRule)
    table('by category, asked by a Subagent', t.byCategoryFromSubagent)
    table('by reason', t.byReason)
    table('by day', t.byDay)
    if (t.patterns) for (const category of CATEGORIES) table(`patterns of ${category}`, t.patterns[category])
    if (t.draft) {
      table('draft policy', t.draft)
      for (const category of CATEGORIES) table(`draft policy, ${category}`, t.draftByCategory[category])
      table('draft policy, why', t.draftWhy)
    }
  }
  return `${lines.join('\n')}\n`
}

// ---------------------------------------------------------------------------------------------------

function parse(line) {
  try {
    const value = JSON.parse(line)
    return value !== null && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

function add(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1
}

function isFolder(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function runAsScript() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (runAsScript()) process.exitCode = await refusalCensus(process.argv.slice(2))
