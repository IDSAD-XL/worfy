import { app } from 'electron'
import { appVersion } from '../../shared/ipc/app'
import { defineHandler, type HandlerModule } from './index'

export default [defineHandler(appVersion, () => ({ version: app.getVersion() }))] satisfies HandlerModule
