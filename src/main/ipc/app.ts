import { app } from 'electron'
import { appVersion } from '../../shared/ipc/app'
import { appBuildNumber } from '../build-number'
import { bundledHarnessVersion } from '../harness/bundled'
import { defineHandler, type HandlerModule } from './index'

// The build version the Harness copy carries; without a copy, Electron's own (package.json). And
// whether this is a packaged build (the .app), not `pnpm dev` or an e2e run of out/. And the build
// number, which the screen shows in place of the SHA (worfy-update ticket 14), when the build has one.
export default [
  defineHandler(appVersion, () => {
    const number = appBuildNumber()
    return { version: bundledHarnessVersion() ?? app.getVersion(), packaged: app.isPackaged, ...(number === undefined ? {} : { number }) }
  }),
] satisfies HandlerModule
