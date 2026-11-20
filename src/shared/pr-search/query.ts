// The search strings of the PR search in the Pull requests tab (worfy-pr-review ticket 04; spec, implementation
// decisions 1). Pure: main sends what buildSearch returns (src/main/github/pr-search.ts), the view shows
// searchWarnings before Enter and writes the filter chips into the field with setChip (ticket 05).
//
// - The text of the user, then `is:pr` always (GitHub's search of issues returns issues too without it; the user's
//   `is:issue` and `type:issue` are dropped and named), `archived:false` unless the text has `archived:`, and
//   `sort:updated-desc` unless it has `sort:`.
// - The scope: This Project — `repo:` of each of its repositories; the owners of those repositories — `org:` of each
//   (GitHub matches `org:` for a user account as well as for an organization, checked 2026-11-20); All of GitHub —
//   nothing, what the Project's account sees. A `repo:`, `org:` or `user:` in the text is the scope itself: in GitHub's
//   ordinary search two `repo:` mean OR, so the scope's would widen the user's.
// - GitHub refuses (422) a search longer than 256 characters or with more than 5 AND/OR/NOT: the scope's qualifiers
//   go into several searches below 256 characters each, and searchWarnings names what is still too long.
// - The chips write their qualifiers into the field: the field is the one source of truth, a chip shows which of its
//   qualifiers the field holds.

/** Where a search looks (spec, owner's answer to Q1: three scopes, This Project by default). */
export const PR_SEARCH_SCOPES = ['project', 'owners', 'github'] as const
export type PrSearchScope = (typeof PR_SEARCH_SCOPES)[number]

/** What the scope menu calls each scope. */
export const PR_SEARCH_SCOPE_TITLES: Readonly<Record<PrSearchScope, string>> = {
  project: 'This Project',
  owners: 'Organizations of this Project',
  github: 'All of GitHub',
}

/** GitHub's longest search: a longer one is refused with 422. */
export const PR_SEARCH_MAX_CHARS = 256
/** GitHub's most AND/OR/NOT operators in one search. */
export const PR_SEARCH_MAX_OPERATORS = 5

export interface SearchInput {
  /** What the user typed into the field, the chips' qualifiers included. */
  text: string
  scope: PrSearchScope
  /** The Project's repositories on GitHub, `owner/name` (remoteRepos of src/main/github/inbox.ts). */
  repos: readonly string[]
}

export interface BuiltSearch {
  /** The search strings to send, one result list: several only when the scope's qualifiers do not fit in one. */
  queries: string[]
  /** The words of the text that were left out, as typed: `is:issue`, `type:issue`. */
  dropped: string[]
  /** The text names a `repo:`, `org:` or `user:` itself, so the scope added none. */
  ownScope: boolean
}

export type SearchWarning = { kind: 'too-long'; length: number } | { kind: 'too-many-operators'; count: number }

/** The words of a search: split on white space, a quoted part ("needs review", label:"needs review") kept whole. */
export function tokensOf(text: string): string[] {
  return text.match(/(?:[^\s"]+|"[^"]*"?)+/gu) ?? []
}

/** The qualifier key of a word, lower case (`is`, `repo`, `label`); null for a free word or an operator. */
function keyOf(token: string): string | null {
  const match = /^-?([a-z][a-z-]*):/iu.exec(token)
  return match ? match[1]!.toLowerCase() : null
}

const lower = (token: string): string => token.toLowerCase()
const IS_PR = new Set(['is:pr', 'type:pr'])
const IS_ISSUE = new Set(['is:issue', 'type:issue'])
const SCOPE_KEYS = new Set(['repo', 'org', 'user'])
const OPERATORS = new Set(['AND', 'OR', 'NOT'])

/** The user's words without `is:pr` and `is:issue` of either spelling, and the fixed qualifiers worfy adds. */
function baseOf(text: string): { words: string[]; dropped: string[]; ownScope: boolean } {
  const tokens = tokensOf(text)
  const dropped = tokens.filter((token) => IS_ISSUE.has(lower(token)))
  const kept = tokens.filter((token) => !IS_PR.has(lower(token)) && !IS_ISSUE.has(lower(token)))
  const keys = new Set(kept.map(keyOf))
  const words = [...kept, 'is:pr', ...(keys.has('archived') ? [] : ['archived:false']), ...(keys.has('sort') ? [] : ['sort:updated-desc'])]
  return { words, dropped, ownScope: [...keys].some((key) => key !== null && SCOPE_KEYS.has(key)) }
}

/** The scope's qualifiers: `repo:` of each repository, or `org:` of each owner once; none for All of GitHub. */
function scopeOf(scope: PrSearchScope, repos: readonly string[]): string[] {
  if (scope === 'github') return []
  const seen = new Set<string>()
  const qualifiers: string[] = []
  for (const repo of repos) {
    const value = scope === 'project' ? repo : (repo.split('/')[0] ?? '')
    if (value === '' || seen.has(value.toLowerCase())) continue
    seen.add(value.toLowerCase())
    qualifiers.push(`${scope === 'project' ? 'repo' : 'org'}:${value}`)
  }
  return qualifiers
}

/** The search strings of `input`: the scope's qualifiers spread over as few searches below 256 characters as they fit in. */
export function buildSearch(input: SearchInput): BuiltSearch {
  const { words, dropped, ownScope } = baseOf(input.text)
  const base = words.join(' ')
  const scope = ownScope ? [] : scopeOf(input.scope, input.repos)
  if (scope.length === 0) return { queries: [base], dropped, ownScope }
  const queries: string[] = []
  let current = base
  let filled = false
  for (const qualifier of scope) {
    const longer = `${current} ${qualifier}`
    if (filled && longer.length >= PR_SEARCH_MAX_CHARS) {
      queries.push(current)
      current = `${base} ${qualifier}`
    } else current = longer
    filled = true
  }
  queries.push(current)
  return { queries, dropped, ownScope }
}

/** What GitHub would refuse, for the field before Enter: a search over 256 characters, more than 5 operators. */
export function searchWarnings(input: SearchInput): SearchWarning[] {
  const warnings: SearchWarning[] = []
  const longest = Math.max(...buildSearch(input).queries.map((query) => query.length))
  if (longest > PR_SEARCH_MAX_CHARS) warnings.push({ kind: 'too-long', length: longest })
  const count = tokensOf(input.text).filter((token) => OPERATORS.has(token)).length
  if (count > PR_SEARCH_MAX_OPERATORS) warnings.push({ kind: 'too-many-operators', count })
  return warnings
}

// ── the filter chips ─────────────────────────────────────────────────────────

export const PR_SEARCH_CHIP_IDS = ['state', 'reviewRequested', 'author', 'involves', 'label', 'draft', 'review', 'reviewedBy', 'reviewInvolves'] as const
export type PrSearchChip = (typeof PR_SEARCH_CHIP_IDS)[number]

export interface PrSearchChipDefinition {
  id: PrSearchChip
  /** The chip's title in the view. */
  label: string
  /** The menu of the chip: the qualifiers it writes. Author takes any login and Label any label besides. */
  options: readonly { label: string; qualifier: string }[]
  /** Whether a word of the field is one of this chip's qualifiers. */
  owns: (token: string) => boolean
}

const exactly =
  (...qualifiers: string[]) =>
  (token: string): boolean =>
    qualifiers.includes(lower(token))
const withKey =
  (...keys: string[]) =>
  (token: string): boolean =>
    !token.startsWith('-') && keys.includes(keyOf(token) ?? '')

/** The chips of the spec (implementation decisions 1), in the order of the view's filter row. */
export const PR_SEARCH_CHIPS: readonly PrSearchChipDefinition[] = [
  {
    id: 'state',
    label: 'State',
    options: [
      { label: 'Open', qualifier: 'is:open' },
      { label: 'Closed', qualifier: 'is:closed' },
      { label: 'Merged', qualifier: 'is:merged' },
    ],
    owns: exactly('is:open', 'is:closed', 'is:merged'),
  },
  {
    id: 'reviewRequested',
    label: 'Review requested',
    options: [
      { label: 'From me or my team', qualifier: 'review-requested:@me' },
      { label: 'From me only', qualifier: 'user-review-requested:@me' },
    ],
    owns: withKey('review-requested', 'user-review-requested'),
  },
  { id: 'author', label: 'Author', options: [{ label: 'Me', qualifier: 'author:@me' }], owns: withKey('author') },
  { id: 'involves', label: 'Involves me', options: [{ label: 'Involves me', qualifier: 'involves:@me' }], owns: withKey('involves') },
  { id: 'label', label: 'Label', options: [], owns: withKey('label') },
  {
    id: 'draft',
    label: 'Draft',
    options: [
      { label: 'Draft', qualifier: 'draft:true' },
      { label: 'Ready for review', qualifier: 'draft:false' },
    ],
    owns: withKey('draft'),
  },
  {
    id: 'review',
    label: 'Review status',
    options: [
      { label: 'No reviews', qualifier: 'review:none' },
      { label: 'Review required', qualifier: 'review:required' },
      { label: 'Approved', qualifier: 'review:approved' },
      { label: 'Changes requested', qualifier: 'review:changes_requested' },
    ],
    owns: withKey('review'),
  },
  { id: 'reviewedBy', label: 'Reviewed by me', options: [{ label: 'Reviewed by me', qualifier: 'reviewed-by:@me' }], owns: withKey('reviewed-by') },
  { id: 'reviewInvolves', label: 'Asked or reviewed', options: [{ label: 'Asked or reviewed', qualifier: 'review-involves:@me' }], owns: withKey('review-involves') },
]

const chipOf = (id: PrSearchChip): PrSearchChipDefinition => PR_SEARCH_CHIPS.find((chip) => chip.id === id)!

/** The qualifiers of each chip the field holds, in the order of the field; a chip with none is absent. */
export function chipsOf(text: string): Partial<Record<PrSearchChip, string[]>> {
  const found: Partial<Record<PrSearchChip, string[]>> = {}
  for (const token of tokensOf(text)) {
    const chip = PR_SEARCH_CHIPS.find((each) => each.owns(token))
    if (chip !== undefined) (found[chip.id] ??= []).push(token)
  }
  return found
}

/** The field with the chip's qualifiers replaced by `qualifiers`, at its end; none clears the chip. */
export function setChip(text: string, id: PrSearchChip, qualifiers: readonly string[]): string {
  const chip = chipOf(id)
  return [...tokensOf(text).filter((token) => !chip.owns(token)), ...qualifiers].join(' ')
}

/** The qualifier of a label: quoted when it has a space; GitHub's search has no escape for a quote, so it goes. */
export function labelQualifier(name: string): string {
  const clean = name.replaceAll('"', '').trim()
  return /\s/u.test(clean) ? `label:"${clean}"` : `label:${clean}`
}
