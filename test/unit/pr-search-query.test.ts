// The search strings of the PR search (worfy-pr-review ticket 04; spec, implementation decisions 1): the user's text,
// `is:pr` always, the scope (This Project, the owners of its repositories, All of GitHub), `archived:false` and
// `sort:updated-desc` by default, split into several searches at GitHub's 256 characters, the warning before Enter,
// and the filter chips that write their qualifiers into the same field. Owners and repositories are made up.
import { describe, expect, it } from 'vitest'
import {
  PR_SEARCH_CHIPS,
  PR_SEARCH_MAX_CHARS,
  buildSearch,
  chipsOf,
  labelQualifier,
  searchWarnings,
  setChip,
  tokensOf,
} from '../../src/shared/pr-search/query'

const REPOS = ['demo-org/api', 'demo-org/web', 'dev-me/tools']

describe('buildSearch', () => {
  it('This Project: the text, is:pr, archived:false, sort:updated-desc and repo: of every repository', () => {
    expect(buildSearch({ text: 'retry author:dev-ana', scope: 'project', repos: REPOS })).toEqual({
      queries: ['retry author:dev-ana is:pr archived:false sort:updated-desc repo:demo-org/api repo:demo-org/web repo:dev-me/tools'],
      dropped: [],
      ownScope: false,
    })
  })

  it('the owners: org: of each owner of the repositories, once, whatever the case', () => {
    const built = buildSearch({ text: 'retry', scope: 'owners', repos: [...REPOS, 'Demo-Org/docs'] })
    expect(built.queries).toEqual(['retry is:pr archived:false sort:updated-desc org:demo-org org:dev-me'])
  })

  it('All of GitHub: no repo:, org: or user:', () => {
    expect(buildSearch({ text: 'review-requested:@me', scope: 'github', repos: REPOS }).queries).toEqual(['review-requested:@me is:pr archived:false sort:updated-desc'])
  })

  it('an empty text still searches pull requests of the scope', () => {
    expect(buildSearch({ text: '   ', scope: 'github', repos: [] }).queries).toEqual(['is:pr archived:false sort:updated-desc'])
  })

  it('is:pr always, once: the user\'s is:pr and type:pr go, is:issue and type:issue are dropped and named', () => {
    const built = buildSearch({ text: 'IS:PR is:issue type:Issue type:pr retry', scope: 'github', repos: [] })
    expect(built.queries).toEqual(['retry is:pr archived:false sort:updated-desc'])
    expect(built.dropped).toEqual(['is:issue', 'type:Issue'])
  })

  it('archived: and sort: of the user stay and replace the defaults', () => {
    expect(buildSearch({ text: 'archived:true sort:created-asc', scope: 'github', repos: [] }).queries).toEqual(['archived:true sort:created-asc is:pr'])
  })

  it('a repo:, org: or user: in the text is the scope: the scope adds nothing and says so', () => {
    const built = buildSearch({ text: 'repo:other-org/lib retry', scope: 'project', repos: REPOS })
    expect(built).toEqual({ queries: ['repo:other-org/lib retry is:pr archived:false sort:updated-desc'], dropped: [], ownScope: true })
    expect(buildSearch({ text: 'User:dev-ana', scope: 'owners', repos: REPOS }).ownScope).toBe(true)
  })

  it('a quoted label stays one word', () => {
    expect(buildSearch({ text: 'label:"needs review" retry', scope: 'github', repos: [] }).queries).toEqual(['label:"needs review" retry is:pr archived:false sort:updated-desc'])
  })

  it(`at ${PR_SEARCH_MAX_CHARS} characters and more, the repositories go into several searches, each under ${PR_SEARCH_MAX_CHARS}, none left out`, () => {
    const repos = Array.from({ length: 30 }, (_, n) => `demo-org/service-number-${String(n).padStart(2, '0')}`)
    const built = buildSearch({ text: 'retry', scope: 'project', repos })
    expect(built.queries.length).toBeGreaterThan(1)
    for (const query of built.queries) {
      expect(query.length).toBeLessThan(PR_SEARCH_MAX_CHARS)
      expect(query.startsWith('retry is:pr archived:false sort:updated-desc repo:')).toBe(true)
    }
    const named = built.queries.flatMap((query) => [...query.matchAll(/repo:(\S+)/gu)].map((match) => match[1]))
    expect(named).toEqual(repos)
  })

  it('just under the limit: one search', () => {
    const base = 'is:pr archived:false sort:updated-desc'
    // One repository whose search is exactly 255 characters long.
    const repo = `demo-org/${'x'.repeat(PR_SEARCH_MAX_CHARS - 1 - base.length - ' repo:demo-org/'.length)}`
    const built = buildSearch({ text: '', scope: 'project', repos: [repo] })
    expect(built.queries).toHaveLength(1)
    expect(built.queries[0]).toHaveLength(PR_SEARCH_MAX_CHARS - 1)
  })

  it('the owners split too', () => {
    const repos = Array.from({ length: 30 }, (_, n) => `owner-number-${String(n).padStart(2, '0')}-of-demo/api`)
    const built = buildSearch({ text: '', scope: 'owners', repos })
    expect(built.queries.length).toBeGreaterThan(1)
    expect(built.queries.flatMap((query) => [...query.matchAll(/org:(\S+)/gu)].map((match) => match[1]))).toEqual(repos.map((repo) => repo.split('/')[0]))
  })
})

describe('searchWarnings: before Enter', () => {
  it('nothing for an ordinary search', () => {
    expect(searchWarnings({ text: 'retry author:@me', scope: 'project', repos: REPOS })).toEqual([])
  })

  it(`a search longer than ${PR_SEARCH_MAX_CHARS} characters, with its length`, () => {
    const text = 'x'.repeat(250)
    expect(searchWarnings({ text, scope: 'github', repos: [] })).toEqual([{ kind: 'too-long', length: `${text} is:pr archived:false sort:updated-desc`.length }])
  })

  it('more than 5 AND/OR/NOT, counted only as whole upper-case words outside quotes', () => {
    expect(searchWarnings({ text: 'a OR b OR c AND d NOT e OR f', scope: 'github', repos: [] })).toEqual([])
    expect(searchWarnings({ text: 'a OR b OR c AND d NOT e OR f AND g', scope: 'github', repos: [] })).toEqual([{ kind: 'too-many-operators', count: 6 }])
    expect(searchWarnings({ text: 'or and not ORDER "OR OR OR OR OR OR"', scope: 'github', repos: [] })).toEqual([])
  })

  it('a split search of many repositories is not too long', () => {
    const repos = Array.from({ length: 30 }, (_, n) => `demo-org/service-${n}`)
    expect(searchWarnings({ text: 'retry', scope: 'project', repos })).toEqual([])
  })
})

describe('tokensOf', () => {
  it('splits on spaces, keeps quoted words together', () => {
    expect(tokensOf('  label:"needs review"  "two words" retry ')).toEqual(['label:"needs review"', '"two words"', 'retry'])
  })
})

describe('the filter chips (spec, implementation decisions 1)', () => {
  it('each chip and the qualifiers it writes', () => {
    expect(Object.fromEntries(PR_SEARCH_CHIPS.map((chip) => [chip.id, chip.options.map((option) => option.qualifier)]))).toEqual({
      state: ['is:open', 'is:closed', 'is:merged'],
      reviewRequested: ['review-requested:@me', 'user-review-requested:@me'],
      author: ['author:@me'],
      involves: ['involves:@me'],
      label: [],
      draft: ['draft:true', 'draft:false'],
      review: ['review:none', 'review:required', 'review:approved', 'review:changes_requested'],
      reviewedBy: ['reviewed-by:@me'],
      reviewInvolves: ['review-involves:@me'],
    })
  })

  it('chipsOf: the field is the one source of truth; a chip shows the qualifiers the field has', () => {
    expect(chipsOf('retry is:open author:dev-ana label:"needs review" label:bug draft:false review:approved reviewed-by:@me review-involves:@me user-review-requested:@me involves:@me')).toEqual({
      state: ['is:open'],
      reviewRequested: ['user-review-requested:@me'],
      author: ['author:dev-ana'],
      involves: ['involves:@me'],
      label: ['label:"needs review"', 'label:bug'],
      draft: ['draft:false'],
      review: ['review:approved'],
      reviewedBy: ['reviewed-by:@me'],
      reviewInvolves: ['review-involves:@me'],
    })
    expect(chipsOf('retry is:pr')).toEqual({})
  })

  it('setChip replaces the chip\'s qualifiers in the field and leaves the rest of the text as it was', () => {
    expect(setChip('retry is:open author:@me', 'state', ['is:merged'])).toBe('retry author:@me is:merged')
    expect(setChip('retry is:open author:@me', 'state', [])).toBe('retry author:@me')
    expect(setChip('retry', 'author', ['author:dev-ana'])).toBe('retry author:dev-ana')
    expect(setChip('review-requested:@me retry', 'reviewRequested', ['user-review-requested:@me'])).toBe('retry user-review-requested:@me')
    expect(setChip('label:bug retry', 'label', ['label:bug', labelQualifier('needs review')])).toBe('retry label:bug label:"needs review"')
  })

  it('labelQualifier quotes a label with a space and drops a quote it cannot carry', () => {
    expect(labelQualifier('bug')).toBe('label:bug')
    expect(labelQualifier('needs review')).toBe('label:"needs review"')
    expect(labelQualifier('say "hi"')).toBe('label:"say hi"')
  })
})
