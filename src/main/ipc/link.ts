import { linkPing } from '../../shared/ipc/link'
import { localMachineOf } from '../link/ipc-adapter'
import { appLinkProblem, appLinkService } from '../link/service'
import { defineHandler, type HandlerModule } from './index'

// A call over the link answers for the link service it came through (one process may run several
// in tests); a window's call, for the app's link service.
export default [
  defineHandler(linkPing, (_input, { event }) => {
    const machine = localMachineOf(event) ?? appLinkService()?.localMachine()
    if (machine === undefined) throw new Error(appLinkProblem() ?? 'the link service has not started yet')
    return machine
  }),
] satisfies HandlerModule
