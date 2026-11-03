// The `vendors` domain (worfy-multi-vendor ticket 29): the sign-in of each Vendor this build runs, for
// Settings → Vendors and the optional step "Use Codex too" of Getting started. main asks each Vendor's
// account part (src/main/vendors/<id>/account.ts), the same one the Vendor picker of "New session" asks
// through `sessions.vendors`; worfy keeps no tokens, the Vendor keeps them in its own home (ADR-0009).
// Every channel is `local`: a sign-in is this Machine's, and a Linked machine never starts one here.
import { z } from 'zod'
import { vendorIdSchema } from '../vendors/vendor'
import { invokeChannel } from './channels'

/** One sign-in of a Vendor (AccountConnection of src/main/vendors/account.ts). */
export const vendorConnectionSchema = z.object({
  /** Whose account it is: `anthropic`, `openai`, … */
  provider: z.string(),
  signedIn: z.boolean(),
  email: z.string().nullable(),
  /** The subscription, as the Vendor names it; null when it names none. */
  plan: z.string().nullable(),
})
export type VendorConnection = z.output<typeof vendorConnectionSchema>

export const vendorEntrySchema = z.object({
  vendor: vendorIdSchema,
  /** Whether this build carries the Vendor's agent; a Vendor not in the build cannot be signed in to. */
  inBuild: z.boolean(),
  /** The first-run checks demand this Vendor's sign-in (Claude Code); the others are optional. */
  required: z.boolean(),
})
export type VendorEntry = z.output<typeof vendorEntrySchema>

/** The Vendors this build runs, in their order, and which of them it carries. Starts no process. */
export const vendorsList = invokeChannel('vendors.list', z.void(), z.object({ vendors: z.array(vendorEntrySchema) }), 'local')

/**
 * Who is signed in to `vendor`: its connections. May start a process of the Vendor to ask it; refused,
 * with the Vendor's reason, when that process did not answer.
 */
export const vendorsAccount = invokeChannel('vendors.account', z.object({ vendor: vendorIdSchema }), z.object({ connections: z.array(vendorConnectionSchema) }), 'local')

/**
 * Starts a sign-in to `vendor` and answers once it is over. `connections`: the sign-in as it ended; null
 * when the Vendor cannot tell (a sign-in in its own terminal: ask `vendors.account` again). `command`:
 * what the user runs in a Terminal to sign in there; null for a sign-in in the browser, which main opens
 * itself. Refused when the sign-in failed, was cancelled or timed out. A second call while one runs gets
 * the answer of the first.
 */
export const vendorsStartLogin = invokeChannel(
  'vendors.startLogin',
  z.object({ vendor: vendorIdSchema }),
  z.object({ connections: z.array(vendorConnectionSchema).nullable(), command: z.string().nullable() }),
  'local',
)

/** Cancels the sign-in to `vendor` that runs; nothing when none does. */
export const vendorsCancelLogin = invokeChannel('vendors.cancelLogin', z.object({ vendor: vendorIdSchema }), z.void(), 'local')

declare module './channels' {
  interface IpcContract {
    'vendors.list': typeof vendorsList
    'vendors.account': typeof vendorsAccount
    'vendors.startLogin': typeof vendorsStartLogin
    'vendors.cancelLogin': typeof vendorsCancelLogin
  }
}
