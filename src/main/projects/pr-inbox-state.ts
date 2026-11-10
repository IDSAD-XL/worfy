// What the user has seen of the PR inbox of a Project (worfy-pr-inbox ticket 02): `<Project data folder>/pr-inbox.json`,
// next to settings.json (src/main/projects/settings.ts), in worfy's own data folder (ADR-0005, amended by ADR-0105).
// Per PR (`owner/name#N`): when the user last looked, the head commit then, and the id of the last comment then.
// Never a text: the words of colleagues stay in main's memory only and are read again after a restart.
//
// Also the Project's switch of the inbox, the `prInbox` field of settings.json: read here without the rest of the
// settings, so a file this build cannot parse in full still says whether the inbox is on.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { readJsonFile, writeJsonFile } from '../storage/json-file'
import { settingsPath } from './settings'

export const PR_INBOX_FILE = 'pr-inbox.json'

export const seenPullSchema = z.object({
  seenAt: z.iso.datetime(),
  /** The head commit when the user looked; null when GitHub gave none. */
  seenHeadOid: z.string().nullable(),
  /** GitHub's node id of the newest comment the user had seen; null when the PR had none. */
  lastSeenCommentId: z.string().nullable(),
})
export type SeenPull = z.infer<typeof seenPullSchema>

export const prInboxStateSchema = z.object({
  /** By `owner/name#N`. */
  pulls: z.record(z.string(), seenPullSchema),
})
export type PrInboxState = z.infer<typeof prInboxStateSchema>

export function prInboxStatePath(projectDataDir: string): string {
  return join(projectDataDir, PR_INBOX_FILE)
}

/** The saved state; empty when there is none yet (an unreadable file is set aside by readJsonFile). */
export function readPrInboxState(projectDataDir: string): PrInboxState {
  return readJsonFile(prInboxStatePath(projectDataDir), prInboxStateSchema) ?? { pulls: {} }
}

/** Records that the user has seen the PR `key` (`owner/name#N`); the other PRs keep theirs. */
export function writeSeenPull(projectDataDir: string, key: string, seen: SeenPull): PrInboxState {
  const state = readPrInboxState(projectDataDir)
  const next = { pulls: { ...state.pulls, [key]: seen } }
  writeJsonFile(prInboxStatePath(projectDataDir), prInboxStateSchema, next)
  return next
}

/**
 * Whether the Project's settings let the PR inbox read GitHub: only `"prInbox": false` turns it off (spec decision
 * Q10 — on by default). A missing or unreadable settings.json reads as on, and nothing is moved or rewritten here.
 */
export function prInboxSetting(projectDataDir: string): boolean {
  let saved: unknown
  try {
    saved = JSON.parse(readFileSync(settingsPath(projectDataDir), 'utf8'))
  } catch {
    return true
  }
  return !(typeof saved === 'object' && saved !== null && (saved as { prInbox?: unknown }).prInbox === false)
}
