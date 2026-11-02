// The account part of the Claude driver: accountInfo() of a Claude Code process, asked the way the
// first-run sign-in check asks it (src/main/ipc/first-run.ts), and the sign-in that check names.
import type { AccountPart } from '../account'

export const claudeAccount: AccountPart = {
  async check(signal) {
    // Loaded at the call: the first-run module and its imports stay out of the Session registry's.
    const { askSignedInAccount } = await import('../../ipc/first-run')
    const account = await askSignedInAccount(signal)
    // With a login accountInfo() has subscriptionType; without one only apiProvider and tokenSource
    // "none" (ADR-0009) — the reading of the first-run check (src/main/first-run/checks.ts, signIn).
    const signedIn = account.subscriptionType !== undefined || (account.tokenSource !== undefined && account.tokenSource !== 'none')
    return [{ provider: 'anthropic', signedIn, email: account.email ?? null, plan: account.subscriptionType ?? null }]
  },
  // The user signs in themselves: `claude` in a Terminal Node, then /login (the first-run check's
  // hint). worfy does not see that end: `completed` says so at once, and the caller checks again.
  startLogin: () => Promise.resolve({ start: { kind: 'terminal', command: 'claude' }, completed: Promise.resolve(null), cancel: () => undefined }),
}
