// The limits part of the Codex driver (ADR-0094 item 2): a stub until worfy-multi-vendor ticket 21
// reads `account/rateLimits/read`. That ticket replaces this file only.
import { PartNotWired } from '../driver'
import type { LimitsPart } from '../limits'

export const codexLimits: LimitsPart = {
  read: () => Promise.reject(new PartNotWired('codex', 'limits', 'worfy-multi-vendor ticket 21')),
}
