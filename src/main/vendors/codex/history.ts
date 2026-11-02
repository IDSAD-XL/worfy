// The history part of the Codex driver (ADR-0094 item 2): a stub until worfy-multi-vendor ticket 22
// lists and reads threads (`thread/list`, `thread/read`). That ticket replaces this file only.
import { PartNotWired } from '../driver'
import type { HistoryPart } from '../history'

const notWired = () => Promise.reject(new PartNotWired('codex', 'history', 'worfy-multi-vendor ticket 22'))

export const codexHistory: HistoryPart = { list: notWired, read: notWired }
