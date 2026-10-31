// The `app` domain: facts about the running application.
import { z } from 'zod'
import { invokeChannel } from './channels'

/**
 * The build version, `<semver>+<short SHA>[.dirty]` (scripts/build-version.ts): the `version` the
 * build writes into its Harness copy. Without a copy (unit tests, `pnpm dev` before the first
 * build) — Electron's app.getVersion(), the package.json `version`. `packaged`: Electron's
 * app.isPackaged — true for the .app, false for `pnpm dev` and the e2e runs of out/; the worfy Guide
 * shows its test Topic only when it is false (worfy-guide ticket 03, ADR-0090). `number`: the build
 * number (worfy-update ticket 14, scripts/build-version.ts), which the screen shows as
 * `v<major>.<minor>.<number>` (src/shared/version-number.ts); absent for a build without one (a
 * shallow clone, no git, unit tests).
 */
export const appVersion = invokeChannel(
  'app.version',
  z.void(),
  z.object({ version: z.string().min(1), packaged: z.boolean(), number: z.number().int().positive().optional() }),
  'local',
)

declare module './channels' {
  interface IpcContract {
    'app.version': typeof appVersion
  }
}
