// The owner's personal words in the SDK message captures (scripts/spikes/sdk-probe.ts and
// scripts/spikes/harness-plugin/probe.ts, worfy-polish 100). The words come from the deny list of the
// repository's personal-string guard (scripts/check-personal.mjs), kept only outside the repository
// (<HARNESS_HOME>/user/privacy.json). Without the list nothing is replaced, and `pnpm lint` still
// finds what is left. The words themselves are never printed.
//
// A name with a personal word in it — a skill or command name — becomes `skill-N` as a whole, numbered
// in the order seen, so not even its first letters are left; prose with one becomes `<personal text>`.
// `<personal>`, which an earlier version of this rule wrote, is taken as such a word too (--rescrub).
// In a list (skills, slash commands…) such entries move to its end: in a sorted list the place of an
// entry would tell its first letter.
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { personal } = require('../../harness/lib/privacy.cjs')

const words = personal(process.env.HARNESS_HOME ?? join(homedir(), '.claude', 'worfy-harness')).deny.map((w) => w.trim()).filter(Boolean)
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const alternatives = [...words.map(escape), '<personal>'].join('|')
// The whole name or word around a match: letters, digits and the joiners of skill and command names.
const TOKEN = new RegExp(`[\\w:.@-]*(?:${alternatives})[\\w:.@-]*`, 'gi')
const ALIAS = /^skill-(\d+)$/
const PROSE = '<personal text>'
const IS_ALIAS = /(^|[^\w-])skill-\d+(?![\w-])/

const aliases = new Map()
let next = 1

function alias(token) {
  const already = ALIAS.exec(token)
  if (already) {
    next = Math.max(next, Number(already[1]) + 1)
    return token
  }
  const key = token.toLowerCase()
  if (!aliases.has(key)) aliases.set(key, `skill-${next++}`)
  return aliases.get(key)
}

/**
 * `text` with every name that holds a personal word replaced by its `skill-N`. Prose (any text with
 * a space) that holds one — a skill's description — is replaced whole: its other words would still
 * say whose skill it is.
 */
export function scrubPersonal(text) {
  TOKEN.lastIndex = 0
  if (/\s/.test(text) && TOKEN.test(text)) return PROSE
  return text.replace(TOKEN, (token) => alias(token))
}

/** A list with the entries that carry a `skill-N` moved after the others, a closing `<N more>` kept last. */
export function personalLast(list) {
  const more = list.length > 0 && typeof list[list.length - 1] === 'string' && /^<\d+ more>$/.test(list[list.length - 1]) ? [list[list.length - 1]] : []
  const body = more.length > 0 ? list.slice(0, -1) : list
  const carries = (entry) => IS_ALIAS.test(typeof entry === 'string' ? entry : JSON.stringify(entry))
  return [...body.filter((entry) => !carries(entry)), ...body.filter(carries), ...more]
}
