// The session part of the Codex driver (ADR-0094 item 2): a stub until worfy-multi-vendor ticket 20
// runs `codex app-server` for a Session. That ticket replaces this file only.
import { PartNotWired } from '../driver'
import type { SessionPart } from '../session'

const notWired = () => Promise.reject(new PartNotWired('codex', 'session', 'worfy-multi-vendor ticket 20'))

export const codexSession: SessionPart = { start: notWired, resume: notWired }
