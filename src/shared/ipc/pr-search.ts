// The `prSearch` domain (worfy-pr-review ticket 04): the search of pull requests in the Pull requests tab, the reading
// of one PR of its results that is not in the PR inbox, and the saved searches of a Project. Main searches with gh as
// the Project's account (src/main/github/pr-search.ts) and never writes to GitHub (ADR-0105, amended 2026-11-20: a
// search and a PR the user opens from it may name any repository that account sees).
//
// A Linked machine searches through the Project machine with read-only access too (ADR-0066: a search changes no state
// of the Project); saving and forgetting a search write `pr-searches.json` in the Project's data folder (ADR-0005), so
// they are `write`.
import { z } from 'zod'
import { PR_SEARCH_SCOPES } from '../pr-search/query'
import { invokeChannel } from './channels'
import { prInboxRowSchema } from './pr-inbox'

export const prSearchScopeSchema = z.enum(PR_SEARCH_SCOPES)

/** What a notice above the results is about (spec, implementation decisions 10). */
export const PR_SEARCH_NOTICE_KINDS = [
  /** `is:issue` of the text was left out: the search finds pull requests only. */
  'issue-dropped',
  /** The text names its own `repo:`, `org:` or `user:`: the scope adds none. */
  'own-scope',
  /** More than GitHub's 1,000 results: only the first 1,000 can be shown. */
  'first-1000',
  /** GitHub timed out on part of the search and gave the rest. */
  'incomplete',
  /** Organizations behind SAML single sign-on the token is not authorized for: their results are hidden. */
  'sso-partial',
  /** The organization is behind SAML single sign-on the token is not authorized for; `url` authorizes it. */
  'sso',
  /** A repository the Project's account cannot see (404). */
  'not-visible',
  /** GitHub could not parse the search (422): its own words. */
  'invalid',
  /** GitHub refused gh's sign-in (401, no token). */
  'sign-in',
  /** The account's rate limit is low: the search waits until `pausedUntil`. */
  'rate-limit',
  /** Any other failure: gh's words. */
  'failed',
] as const
export const prSearchNoticeSchema = z.object({
  kind: z.enum(PR_SEARCH_NOTICE_KINDS),
  text: z.string(),
  /** A link the notice offers: the authorization of single sign-on. */
  url: z.string().nullable(),
})
export type PrSearchNotice = z.infer<typeof prSearchNoticeSchema>

/** A row of the results: the row of the PR inbox, and whether it came from the inbox (Mark seen applies to it only). */
export const prSearchRowSchema = prInboxRowSchema.extend({ inInbox: z.boolean() })
export type PrSearchRow = z.infer<typeof prSearchRowSchema>

export const prSearchRateSchema = z.object({ limit: z.number(), remaining: z.number(), resetAt: z.string() })

export const prSearchResultSchema = z.object({
  /** The search strings sent to GitHub: several when This Project's repositories do not fit in one. */
  queries: z.array(z.string()),
  rows: z.array(prSearchRowSchema),
  /** GitHub's count of every result of the search, beyond the page. */
  issueCount: z.number().int().nonnegative(),
  /** The next page ("Load more"), to send back as it is; null when there is none. */
  cursor: z.string().nullable(),
  /** The login the search ran as; null when no answer came. */
  viewer: z.string().nullable(),
  /** The GraphQL rate limit of the account after the search; null when no answer gave it. */
  rate: prSearchRateSchema.nullable(),
  /** The search waits for GitHub's rate limit until then (ISO); null when it does not. */
  pausedUntil: z.string().nullable(),
  /** When GitHub answered this search (ISO): the view says "Searched 3 min ago". */
  searchedAt: z.string(),
  /** The same search less than 60 s ago answered from main's memory, without a call. */
  fromMemory: z.boolean(),
  notices: z.array(prSearchNoticeSchema),
})
export type PrSearchResult = z.infer<typeof prSearchResultSchema>

const projectInput = z.object({ projectId: z.string().min(1) })
const repoSchema = z.string().regex(/^[^/\s]+\/[^/\s]+$/u)

/** A search, on Enter: the text of the field, the scope, and the cursor of the page before for "Load more". */
export const prSearchRun = invokeChannel(
  'prSearch.run',
  projectInput.extend({ text: z.string().max(4096), scope: prSearchScopeSchema, cursor: z.string().max(4096).nullish() }),
  prSearchResultSchema,
  'project',
  'read',
)

export const prSearchPullSchema = z.object({
  /** The PR's row; null when it could not be read (`notices` say why). */
  row: prSearchRowSchema.nullable(),
  /** When main read it from GitHub (ISO); null for a row of the inbox or none. */
  readAt: z.string().nullable(),
  notices: z.array(prSearchNoticeSchema),
})
export type PrSearchPull = z.infer<typeof prSearchPullSchema>

/**
 * One PR of the results: the inbox's row when the inbox has it, else main's memory when GitHub's `updatedAt` is the
 * one the results gave, else a read. `refresh` reads it again (Refresh, the window's focus after 60 s).
 */
export const prSearchPull = invokeChannel(
  'prSearch.pull',
  projectInput.extend({ repo: repoSchema, number: z.number().int().positive(), updatedAt: z.string().nullish(), refresh: z.boolean().optional() }),
  prSearchPullSchema,
  'project',
  'read',
)

export const PR_SEARCH_NAME_MAX = 80

export const savedSearchSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(PR_SEARCH_NAME_MAX),
  /** The text of the field. */
  query: z.string().max(4096),
  scope: prSearchScopeSchema,
  /** One of the two searches every Project has; it cannot be forgotten. */
  builtIn: z.boolean(),
})
export type SavedSearch = z.infer<typeof savedSearchSchema>

export const savedSearchesSchema = z.object({ searches: z.array(savedSearchSchema) })

/** The Project's saved searches: the two built-in ones first, then the user's in the order saved. */
export const prSearchSaved = invokeChannel('prSearch.saved', projectInput, savedSearchesSchema, 'project', 'read')

/** Saves the search under `name`; a search of the same name is replaced. At most 20 besides the built-in ones. */
export const prSearchSave = invokeChannel(
  'prSearch.save',
  projectInput.extend({ name: z.string().trim().min(1).max(PR_SEARCH_NAME_MAX), query: z.string().max(4096), scope: prSearchScopeSchema }),
  savedSearchesSchema,
  'project',
  'write',
)

/** Forgets a saved search of the user; a built-in one is refused. */
export const prSearchForget = invokeChannel('prSearch.forget', projectInput.extend({ id: z.string().min(1) }), savedSearchesSchema, 'project', 'write')

declare module './channels' {
  interface IpcContract {
    'prSearch.run': typeof prSearchRun
    'prSearch.pull': typeof prSearchPull
    'prSearch.saved': typeof prSearchSaved
    'prSearch.save': typeof prSearchSave
    'prSearch.forget': typeof prSearchForget
  }
}
