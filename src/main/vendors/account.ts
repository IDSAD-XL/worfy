// The account part of a Vendor driver (ADR-0094 item 2): who is signed in, and how to sign in. The
// tokens stay in the Vendor's own home folder (ADR-0009).

/** One sign-in of a Vendor; Claude Code and Codex have one, a Vendor like OpenCode one per provider. */
export interface AccountConnection {
  /** Whose account it is: `anthropic`, `openai`, … */
  provider: string
  signedIn: boolean
  email: string | null
  /** The subscription, as the Vendor names it; null when it names none. */
  plan: string | null
}

/**
 * How a sign-in starts: worfy opens a URL the Vendor gave (`url`), the Vendor opens the browser
 * itself (`vendorOpensBrowser`), or the user signs in in the Vendor's own terminal interface by
 * running `command` (`terminal`).
 */
export type LoginStart = { kind: 'url'; url: string } | { kind: 'vendorOpensBrowser' } | { kind: 'terminal'; command: string }

export interface AccountPart {
  /** The Vendor's connections; rejects when the Vendor did not answer. `signal` stops the ask. */
  check(signal?: AbortSignal): Promise<AccountConnection[]>
  startLogin(): Promise<LoginStart>
}
