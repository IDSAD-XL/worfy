// The `terminal` domain: the user's interactive shell in a Terminal Node, run by main through
// node-pty (src/main/terminal/pty.ts). Handled in src/main/ipc/terminal.ts (ADR-0006).
//
// A terminal is named by its Project and its Node: one shell per Terminal Node. `terminal.open`
// starts the shell, or attaches to the one already running, and answers with the output kept so
// far; later output arrives on `terminal.output`. Each chunk carries `end`, the length of all
// output so far, and the answer to open carries the `end` of its replay, so a client drops what
// it already has. A shell that exited on its own stays exited: open answers with its exit and
// output, and starts a new shell only when asked to (`restart`); every client that opened the
// terminal hears of the new shell on `terminal.started` and opens again. The shell runs until
// `terminal.close`, the removal of its Node from the Layout, the last client that opened it going
// away or the app quitting.
//
// Several screens (worfy-link ticket 05, ADR-0053): every client that opened a terminal gets every
// chunk, with the same `end`, and may type into it. The pty has one size: the size of the client
// that typed or clicked in it last (`terminal.input`, `terminal.takeSize`). `terminal.resize` from
// that client applies at once; from another client it is remembered until that client types or
// clicks.
//
// `terminal.open` may name a command (worfy-harness ticket 19): main types it into the shell it
// starts, once the shell has started. Only the commands of TERMINAL_COMMANDS are accepted, so the
// renderer still never names a program of its own; opening a shell that already runs types nothing.
import { z } from 'zod'
import { terminalShellSettingSchema } from '../projects/action-templates'
import { eventChannel, invokeChannel } from './channels'

/** The `kind` of a Terminal Node in the Layout. */
export const TERMINAL_NODE_KIND = 'terminal'

/** The size the renderer asks for; main clamps it to 20–500 columns × 5–300 rows. */
const cells = z.number().int().positive().max(10_000)

/**
 * The commands main types into a new shell when `terminal.open` asks: `gh auth login` — the
 * first-run screen's sign-in to GitHub (worfy-harness ticket 19); the user answers gh there.
 */
export const TERMINAL_COMMANDS = ['gh auth login'] as const
export const terminalCommandSchema = z.enum(TERMINAL_COMMANDS)
export type TerminalCommand = z.infer<typeof terminalCommandSchema>

const terminalRef = {
  projectId: z.string().min(1),
  nodeId: z.string().min(1).max(200),
}

export const terminalOpen = invokeChannel(
  'terminal.open',
  z.object({
    ...terminalRef,
    cols: cells,
    rows: cells,
    /** Start a new shell even when the last one exited on its own (the Restart button). */
    restart: z.boolean().optional(),
    /** Typed into the shell with a newline once it has started; only when this call starts the shell. */
    command: terminalCommandSchema.optional(),
  }),
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
    /** The exit of a shell that ended on its own and was not restarted; nothing runs then. */
    exited: z.object({ exitCode: z.number().int(), signal: z.number().int().nullable() }).nullable(),
  }),
  'project',
)

/**
 * The shells a Terminal can start on the Machine that answers, for the choice in the settings of a
 * Project (worfy-windows ticket 10). Empty where there is nothing to choose: on macOS and Linux the
 * shell is `$SHELL`. On Windows: PowerShell, named as the one that would start, and Git Bash.
 */
export const terminalShells = invokeChannel(
  'terminal.shells',
  z.void(),
  z.array(
    z.object({
      id: terminalShellSettingSchema,
      /** How the settings name it, e.g. `PowerShell (pwsh)`. */
      label: z.string().min(1),
      /** False when it is not on this Machine: a Terminal that asks for it starts PowerShell. */
      found: z.boolean(),
    }),
  ),
  'project',
)

/** Keys typed or pasted in the terminal. */
export const terminalInput = invokeChannel('terminal.input', z.object({ ...terminalRef, data: z.string().min(1).max(1_000_000) }), z.void(), 'project')

/** The size of the caller's view; the pty takes it only while the caller owns the size. */
export const terminalResize = invokeChannel('terminal.resize', z.object({ ...terminalRef, cols: cells, rows: cells }), z.void(), 'project')

/** A click in the caller's view: the caller owns the size from now on, and the pty takes this size. */
export const terminalTakeSize = invokeChannel('terminal.takeSize', z.object({ ...terminalRef, cols: cells, rows: cells }), z.void(), 'project')

/** Ends the shell; closing a terminal that is not running is not an error. */
export const terminalClose = invokeChannel('terminal.close', z.object(terminalRef), z.void(), 'project')

export const terminalOutput = eventChannel(
  'terminal.output',
  z.object({ ...terminalRef, data: z.string(), end: z.number().int().nonnegative() }),
  'project',
)

/** The shell ended on its own (`exit`) or was ended by close. */
export const terminalExit = eventChannel(
  'terminal.exit',
  z.object({ ...terminalRef, exitCode: z.number().int(), signal: z.number().int().nullable() }),
  'project',
)

/** A new shell started for the terminal (Restart on some screen); a view showing the old exit opens again. */
export const terminalStarted = eventChannel('terminal.started', z.object({ ...terminalRef, pid: z.number().int().positive() }), 'project')

declare module './channels' {
  interface IpcContract {
    'terminal.open': typeof terminalOpen
    'terminal.shells': typeof terminalShells
    'terminal.input': typeof terminalInput
    'terminal.resize': typeof terminalResize
    'terminal.takeSize': typeof terminalTakeSize
    'terminal.close': typeof terminalClose
    'terminal.output': typeof terminalOutput
    'terminal.exit': typeof terminalExit
    'terminal.started': typeof terminalStarted
  }
}
