// The `terminal` domain: the user's interactive shell in a Terminal Node, run by main through
// node-pty (src/main/terminal/pty.ts). Handled in src/main/ipc/terminal.ts (ADR-0006).
//
// A terminal is named by its Project and its Node: one shell per Terminal Node. `terminal.open`
// starts the shell, or attaches to the one already running, and answers with the output kept so
// far; later output arrives on `terminal.output`. Each chunk carries `end`, the length of all
// output so far, and the answer to open carries the `end` of its replay, so a client drops what
// it already has. The shell runs until `terminal.close`, the removal of its Node from the
// Layout, the window going away or the app quitting.
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

/** The `kind` of a Terminal Node in the Layout. */
export const TERMINAL_NODE_KIND = 'terminal'

/** The size the renderer asks for; main clamps it to 20–500 columns × 5–300 rows. */
const cells = z.number().int().positive().max(10_000)

const terminalRef = {
  projectId: z.string().min(1),
  nodeId: z.string().min(1).max(200),
}

export const terminalOpen = invokeChannel(
  'terminal.open',
  z.object({ ...terminalRef, cols: cells, rows: cells }),
  z.object({
    pid: z.number().int().positive(),
    /** The shell's file name, e.g. `zsh`. */
    shell: z.string().min(1),
    /** Output kept so far (the last 256 KB), to redraw an attached terminal. */
    replay: z.string(),
    /** Length of all output so far; `replay` ends there. */
    end: z.number().int().nonnegative(),
    /** True when this call started the shell, false when it attached to a running one. */
    started: z.boolean(),
  }),
)

/** Keys typed or pasted in the terminal. */
export const terminalInput = invokeChannel('terminal.input', z.object({ ...terminalRef, data: z.string().min(1).max(1_000_000) }), z.void())

export const terminalResize = invokeChannel('terminal.resize', z.object({ ...terminalRef, cols: cells, rows: cells }), z.void())

/** Ends the shell; closing a terminal that is not running is not an error. */
export const terminalClose = invokeChannel('terminal.close', z.object(terminalRef), z.void())

export const terminalOutput = eventChannel(
  'terminal.output',
  z.object({ ...terminalRef, data: z.string(), end: z.number().int().nonnegative() }),
)

/** The shell ended on its own (`exit`) or was ended by close. */
export const terminalExit = eventChannel(
  'terminal.exit',
  z.object({ ...terminalRef, exitCode: z.number().int(), signal: z.number().int().nullable() }),
)

declare module './channels' {
  interface IpcContract {
    'terminal.open': typeof terminalOpen
    'terminal.input': typeof terminalInput
    'terminal.resize': typeof terminalResize
    'terminal.close': typeof terminalClose
    'terminal.output': typeof terminalOutput
    'terminal.exit': typeof terminalExit
  }
}
