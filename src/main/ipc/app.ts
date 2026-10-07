import { app } from 'electron'
import { appVersion } from '../../shared/ipc/app'
import { bundledHarnessVersion } from '../harness/bundled'
import { defineHandler, type HandlerModule } from './index'

// The build version the Harness copy carries; without a copy, Electron's own (package.json).
export default [defineHandler(appVersion, () => ({ version: bundledHarnessVersion() ?? app.getVersion() }))] satisfies HandlerModule
