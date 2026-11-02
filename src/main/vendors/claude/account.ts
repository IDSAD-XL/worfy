// The account part of the Claude driver: accountInfo() of a Claude Code process, asked the way the
// first-run sign-in check asks it (src/main/ipc/first-run.ts), the one rule that reads a sign-in in
// its answer, and the sign-in that check names. Also the version of Claude Code this build carries,
// which the first-run check compares with the one in the terminal.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { AccountInfoLike } from '../../agent/session'
import type { AccountPart } from '../account'

/**
 * Whether accountInfo() says Claude Code is signed in: with a login it has subscriptionType; without
 * one only apiProvider and tokenSource "none" (ADR-0009). The first-run sign-in check reads it so too
 * (src/main/first-run/checks.ts).
 */
export const claudeSignedIn = (account: AccountInfoLike): boolean => account.subscriptionType !== undefined || (account.tokenSource !== undefined && account.tokenSource !== 'none')

/** `claudeCodeVersion` of the Agent SDK this build carries (Q20); null when its package.json cannot be read. */
export function bundledClaudeCodeVersion(): string | null {
  try {
    const sdk = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')
    const manifest = JSON.parse(readFileSync(join(dirname(sdk), 'package.json'), 'utf8')) as { claudeCodeVersion?: unknown }
    return typeof manifest.claudeCodeVersion === 'string' ? manifest.claudeCodeVersion : null
  } catch {
    return null
  }
}

export const claudeAccount: AccountPart = {
  async check(signal) {
    // Loaded at the call: the first-run module and its imports stay out of the Session registry's.
    const { askSignedInAccount } = await import('../../ipc/first-run')
    const account = await askSignedInAccount(signal)
    return [{ provider: 'anthropic', signedIn: claudeSignedIn(account), email: account.email ?? null, plan: account.subscriptionType ?? null }]
  },
  // The user signs in themselves: `claude` in a Terminal Node, then /login (the first-run check's
  // hint). worfy does not see that end: `completed` says so at once, and the caller checks again.
  startLogin: () => Promise.resolve({ start: { kind: 'terminal', command: 'claude' }, completed: Promise.resolve(null), cancel: () => undefined }),
}
