// The `app` domain: facts about the running application.
import { z } from 'zod'
import { invokeChannel } from './channels'

/**
 * The build version, `<semver>+<short SHA>[.dirty]` (scripts/build-version.ts): the `version` the
 * build writes into its Harness copy. Without a copy (unit tests, `pnpm dev` before the first
 * build) — Electron's app.getVersion(), the package.json `version`.
 */
export const appVersion = invokeChannel('app.version', z.void(), z.object({ version: z.string().min(1) }), 'local')

declare module './channels' {
  interface IpcContract {
    'app.version': typeof appVersion
  }
}
