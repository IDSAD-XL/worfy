// The account part of the Codex driver (ADR-0094 item 2): a stub until worfy-multi-vendor ticket 21
// asks `account/read` and starts the sign-in. That ticket replaces this file only.
import type { AccountPart } from '../account'
import { PartNotWired } from '../driver'

const notWired = () => Promise.reject(new PartNotWired('codex', 'account', 'worfy-multi-vendor ticket 21'))

export const codexAccount: AccountPart = { check: notWired, startLogin: notWired }
