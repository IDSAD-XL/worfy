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

/** A sign-in that started. */
export interface LoginAttempt {
  start: LoginStart
  /**
   * The connections once the sign-in is over; null when the Vendor cannot tell (a sign-in in its
   * own terminal: check() again). Rejects when the sign-in failed or was cancelled.
   */
  completed: Promise<AccountConnection[] | null>
  /** Stops a sign-in that is not over; nothing once it is. */
  cancel(): void
}

export interface AccountPart {
  /** The Vendor's connections; rejects when the Vendor did not answer. `signal` stops the ask. */
  check(signal?: AbortSignal): Promise<AccountConnection[]>
  startLogin(): Promise<LoginAttempt>
  /**
   * Whether this build carries the Vendor's agent, so that a sign-in can happen at all; starts nothing.
   * Absent: always (Claude Code comes with every build).
   */
  inBuild?(): Promise<boolean>
}
