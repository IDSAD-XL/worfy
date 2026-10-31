import { app } from 'electron'
import { appVersion } from '../../shared/ipc/app'
import { bundledHarnessVersion } from '../harness/bundled'
import { defineHandler, type HandlerModule } from './index'

// The build version the Harness copy carries; without a copy, Electron's own (package.json). And
// whether this is a packaged build (the .app), not `pnpm dev` or an e2e run of out/.
export default [defineHandler(appVersion, () => ({ version: bundledHarnessVersion() ?? app.getVersion(), packaged: app.isPackaged }))] satisfies HandlerModule
