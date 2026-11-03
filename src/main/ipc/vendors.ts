// Handlers of the `vendors` domain (src/shared/ipc/vendors.ts, worfy-multi-vendor ticket 29): the sign-in
// of each Vendor for Settings → Vendors and Getting started. They ask the account part of each Vendor's
// driver — the same part whose check the Vendor picker of "New session" reads (`sessions.vendors`,
// signInRefusal of src/main/agent/node-sessions.ts) — and keep nothing: the next ask asks the Vendor again.
//
// A sign-in runs in main until it is over, failed, cancelled or timed out (the Vendor's account part ends
// it); the window only waits for the answer. One sign-in per Vendor at a time: a second call while one
// runs gets the answer of the first. Every sign-in still running when the app quits is cancelled.
import { app } from 'electron'
import { vendorsAccount, vendorsCancelLogin, vendorsList, vendorsStartLogin } from '../../shared/ipc/vendors'
import { UNNAMED_VENDOR, VENDOR_IDS, type VendorId } from '../../shared/vendors/vendor'
import type { AccountConnection, AccountPart } from '../vendors/account'
import { vendorDriver } from '../vendors/registry'
import { defineHandler, type HandlerModule } from './index'

/** What `vendors.startLogin` answers. */
interface LoginAnswer {
  connections: AccountConnection[] | null
  command: string | null
}

export interface VendorsHandlersOptions {
  /** The account part of each Vendor; its driver's by default. */
  account?: (vendor: VendorId) => AccountPart
  /** Where the handlers learn that the app quits; app.on('will-quit') by default. */
  onQuit?: (listener: () => void) => void
}

export function vendorsHandlers(options: VendorsHandlersOptions = {}): HandlerModule {
  const account = options.account ?? ((vendor: VendorId) => vendorDriver(vendor).account)
  const running = new Map<VendorId, Promise<LoginAnswer>>()
  const cancels = new Map<VendorId, () => void>()
  // Cancelled while the sign-in was still starting: it is cancelled as soon as it has started.
  const cancelledEarly = new Set<VendorId>()
  const cancel = (vendor: VendorId): void => {
    const now = cancels.get(vendor)
    if (now !== undefined) now()
    else if (running.has(vendor)) cancelledEarly.add(vendor)
  }
  options.onQuit?.(() => {
    for (const vendor of running.keys()) cancel(vendor)
  })

  const login = async (vendor: VendorId): Promise<LoginAnswer> => {
    const attempt = await account(vendor).startLogin()
    cancels.set(vendor, attempt.cancel)
    if (cancelledEarly.has(vendor)) attempt.cancel()
    const connections = await attempt.completed
    return { connections, command: attempt.start.kind === 'terminal' ? attempt.start.command : null }
  }

  return [
    defineHandler(vendorsList, async () => ({
      vendors: await Promise.all(
        VENDOR_IDS.map(async (vendor) => ({
          vendor,
          inBuild: (await account(vendor).inBuild?.()) ?? true,
          // The first-run checks demand the sign-in of the Vendor every Session ran on before worfy-multi-vendor.
          required: vendor === UNNAMED_VENDOR,
        })),
      ),
    })),
    defineHandler(vendorsAccount, async ({ vendor }) => ({ connections: await account(vendor).check() })),
    defineHandler(vendorsStartLogin, ({ vendor }) => {
      const pending = running.get(vendor)
      if (pending !== undefined) return pending
      const started = login(vendor).finally(() => {
        running.delete(vendor)
        cancels.delete(vendor)
        cancelledEarly.delete(vendor)
      })
      running.set(vendor, started)
      return started
    }),
    defineHandler(vendorsCancelLogin, ({ vendor }) => cancel(vendor)),
  ]
}

export default vendorsHandlers({ onQuit: (listener) => app.on('will-quit', listener) })
