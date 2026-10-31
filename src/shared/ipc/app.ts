// The `app` domain: facts about the running application.
import { z } from 'zod'
import { invokeChannel } from './channels'

/**
 * The build version, `<semver>+<short SHA>[.dirty]` (scripts/build-version.ts): the `version` the
 * build writes into its Harness copy. Without a copy (unit tests, `pnpm dev` before the first
 * build) — Electron's app.getVersion(), the package.json `version`. `packaged`: Electron's
 * app.isPackaged — true for the .app, false for `pnpm dev` and the e2e runs of out/; the worfy Guide
 * shows its test Topic only when it is false (worfy-guide ticket 03, ADR-0090).
 */
export const appVersion = invokeChannel('app.version', z.void(), z.object({ version: z.string().min(1), packaged: z.boolean() }), 'local')

declare module './channels' {
  interface IpcContract {
    'app.version': typeof appVersion
  }
}
