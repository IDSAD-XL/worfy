// The `app` domain: facts about the running application.
import { z } from 'zod'
import { invokeChannel } from './channels'

/** The application version, as Electron reports it (package.json `version`). */
export const appVersion = invokeChannel('app.version', z.void(), z.object({ version: z.string().min(1) }))

declare module './channels' {
  interface IpcContract {
    'app.version': typeof appVersion
  }
}
