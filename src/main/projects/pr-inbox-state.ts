// What the user has seen of the PR inbox of a Project (worfy-pr-inbox ticket 02): `<Project data folder>/pr-inbox.json`,
// next to settings.json (src/main/projects/settings.ts), in worfy's own data folder (ADR-0005, amended by ADR-0105).
// Per PR (`owner/name#N`): when the user last looked, the head commit then, and the id of the last comment then.
// Never a text: the words of colleagues stay in main's memory only and are read again after a restart.
// Also, per GitHub account, the cursor of the notifications trigger (worfy-pr-inbox ticket 08): the `Last-Modified`
// of the last GET /notifications that answered 200, sent back as `If-Modified-Since`.
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

export const notificationsCursorSchema = z.object({
  /** GitHub's `Last-Modified` header as it came (an HTTP date). */
  lastModified: z.string().min(1),
})
export type NotificationsCursor = z.infer<typeof notificationsCursorSchema>

export const prInboxStateSchema = z.object({
  /** By `owner/name#N`. */
  pulls: z.record(z.string(), seenPullSchema),
  /** By GitHub account, '' for gh's own; absent in a file written before ticket 08. */
  notifications: z.record(z.string(), notificationsCursorSchema).optional(),
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
  const next = { ...state, pulls: { ...state.pulls, [key]: seen } }
  writeJsonFile(prInboxStatePath(projectDataDir), prInboxStateSchema, next)
  return next
}

/** The `Last-Modified` the notifications trigger last got for `account` ('' — gh's own); null before the first 200. */
export function readNotificationsCursor(projectDataDir: string, account: string): string | null {
  return readPrInboxState(projectDataDir).notifications?.[account]?.lastModified ?? null
}

/** Records the trigger's `Last-Modified` for `account`; the seen PRs and the other accounts keep theirs. */
export function writeNotificationsCursor(projectDataDir: string, account: string, lastModified: string): PrInboxState {
  const state = readPrInboxState(projectDataDir)
  const next = { ...state, notifications: { ...state.notifications, [account]: { lastModified } } }
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
