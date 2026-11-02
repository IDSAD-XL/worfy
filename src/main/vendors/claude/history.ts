// The history part of the Claude driver. Claude Code's transcripts are its JSONL files under
// <claude home>/projects, which src/main/claude-home/ reads today (registry.ts, tail.ts) for the
// Session Nodes and the Session view.
import { PartNotWired } from '../driver'
import type { HistoryPart } from '../history'

// shortcut: rejects, as no caller lists or reads Claude Code's Sessions through a driver yet; wire
// it to src/main/claude-home/ when the first one does.
const notWired = (part: string) => () => Promise.reject(new PartNotWired('claude', part, 'no caller goes through the driver yet'))

export const claudeHistory: HistoryPart = {
  list: notWired('history.list'),
  read: notWired('history.read'),
}
