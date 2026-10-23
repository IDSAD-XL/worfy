// The keyboard shortcuts of worfy in one list: the key handlers of the renderer, the labels next to
// buttons and fields, the accelerators of the app menu (src/main/menu.ts) and the Keyboard shortcuts
// window (src/renderer/shortcuts/ShortcutsOverlay.tsx) all read them here, so a key and what is
// written about it cannot drift apart.
//
// An entry is written without the system: `primary` is ⌘ on macOS and Ctrl on Windows and Linux.
// How a key press is matched against an entry and how an entry is written for the user is the
// renderer's part (src/renderer/shortcuts/match.ts, over src/renderer/platform.ts); this file has
// no DOM and no Electron, so main and the renderer both import it.
//
// Users do not change the keys: the list is code.

/** The systems an entry can be limited to; the same values as src/renderer/platform.ts has. */
export type ShortcutPlatform = 'mac' | 'windows' | 'linux'

/** The groups of the Keyboard shortcuts window, in the order it shows them. */
export const SHORTCUT_GROUPS = ['Window', 'Canvas', 'Focus mode', 'Find', 'Session', 'Terminal'] as const
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number]

/**
 * Where an entry acts. Two entries of one place never share keys, and no entry shares the keys of an
 * `app` one, which acts everywhere in the window.
 */
export type ShortcutScope = 'app' | 'canvas' | 'focus mode' | 'find bar' | 'session view' | 'composer' | 'slash menu' | 'terminal'

export interface ShortcutKeys {
  /** ⌘ on macOS, Ctrl elsewhere. */
  primary?: boolean
  shift?: boolean
  alt?: boolean
  /** The key as KeyboardEvent.key names it: `K`, `Enter`, `=`, `?`. */
  key: string
  /** Other keys the entry answers to: `+` next to `=` (Shift and = on a US keyboard). */
  also?: readonly string[]
  /** How the key is drawn on macOS when not by the usual glyph: `↩` in ⌘↩, `Enter` in ⇧Enter. */
  macKey?: string
  /** How the key is written on every system, when not by its name: `Esc` for `Escape`. */
  name?: string
}

export interface Shortcut {
  /** Unique; for tests and for the rows of the window (`data-shortcut`). */
  id: string
  /** What the keys do, in English, as the UI names the action. */
  title: string
  group: ShortcutGroup
  scope: ShortcutScope
  keys: ShortcutKeys
  /** The systems the entry exists on; without it, every system. */
  platforms?: readonly ShortcutPlatform[]
  /** A modifier held while the pointer does this, not a key pressed: `⌘ + drag`. */
  pointer?: 'drag'
  /**
   * Which of the keys the shell of a Terminal Node keeps on Windows and Linux, where its keys share
   * Ctrl with worfy's (worfy-windows ticket 11). Without it, all of them: the entry does not match
   * a press inside a terminal there.
   */
  shellKeeps?: readonly string[]
  /**
   * The systems where the app menu shows the entry's key but does not take it, because the menu
   * would take it from the shell of a Terminal Node too: there the renderer catches the key,
   * outside a terminal. Electron hands the menu only the presses the page did not cancel; xterm.js
   * cancels Ctrl+B (it sends ^B) but lets Ctrl+/ through.
   */
  rendererCatchesOn?: readonly ShortcutPlatform[]
}

const primary = (key: string, more: Omit<ShortcutKeys, 'key' | 'primary'> = {}): ShortcutKeys => ({ primary: true, key, ...more })

export const SHORTCUTS = {
  // Window: the app menu and what acts everywhere.
  palette: { id: 'palette', title: 'Search or run a command', group: 'Window', scope: 'app', keys: primary('K') },
  settings: { id: 'settings', title: 'Settings', group: 'Window', scope: 'app', keys: primary(',') },
  toggleSidebar: { id: 'sidebar', title: 'Hide or show the sidebar', group: 'Window', scope: 'app', keys: primary('B') },
  shortcuts: { id: 'shortcuts', title: 'Keyboard shortcuts', group: 'Window', scope: 'app', keys: primary('/'), rendererCatchesOn: ['windows', 'linux'] },
  shortcutsKey: { id: 'shortcuts.question', title: 'Keyboard shortcuts, outside a text field', group: 'Window', scope: 'app', keys: { key: '?' } },
  scaleBigger: { id: 'scale.bigger', title: 'Bigger interface', group: 'Window', scope: 'app', keys: primary('=', { alt: true }) },
  scaleSmaller: { id: 'scale.smaller', title: 'Smaller interface', group: 'Window', scope: 'app', keys: primary('-', { alt: true }) },
  scaleActual: { id: 'scale.actual', title: 'Interface at actual size', group: 'Window', scope: 'app', keys: primary('0', { alt: true }) },

  // Canvas: while the Canvas is on screen.
  canvasZoomIn: { id: 'canvas.zoom-in', title: 'Zoom in', group: 'Canvas', scope: 'canvas', keys: primary('=', { also: ['+'] }), shellKeeps: [] },
  // Ctrl+_ is the shell's undo (readline): only that one stays in a terminal.
  canvasZoomOut: { id: 'canvas.zoom-out', title: 'Zoom out', group: 'Canvas', scope: 'canvas', keys: primary('-', { also: ['_'] }), shellKeeps: ['_'] },
  undo: { id: 'canvas.undo', title: 'Undo', group: 'Canvas', scope: 'canvas', keys: primary('Z') },
  redo: { id: 'canvas.redo', title: 'Redo', group: 'Canvas', scope: 'canvas', keys: primary('Z', { shift: true }) },
  deleteSelection: { id: 'canvas.delete', title: 'Move the selection to the trash', group: 'Canvas', scope: 'canvas', keys: { key: 'Backspace', also: ['Delete'], macKey: '⌫' } },
  dragFree: { id: 'canvas.drag-free', title: 'Drag without snapping', group: 'Canvas', scope: 'canvas', keys: primary('drag'), pointer: 'drag' },

  // Focus mode.
  focusEnter: { id: 'focus.enter', title: 'Open the selection in focus mode', group: 'Focus mode', scope: 'canvas', keys: primary('Enter', { macKey: '↩' }) },
  focusExit: { id: 'focus.exit', title: 'Leave focus mode', group: 'Focus mode', scope: 'focus mode', keys: { key: 'Escape', name: 'Esc' } },

  // Find on the Canvas, and in the transcript of the Session view (worfy-ui ticket 26); both bars step and close with the same keys.
  find: { id: 'find.open', title: 'Find on the Canvas', group: 'Find', scope: 'canvas', keys: primary('F') },
  sessionFind: { id: 'session.find', title: 'Find in the Session', group: 'Find', scope: 'session view', keys: primary('F') },
  findNext: { id: 'find.next', title: 'Next match', group: 'Find', scope: 'find bar', keys: { key: 'Enter', macKey: 'Enter' } },
  findPrevious: { id: 'find.previous', title: 'Previous match', group: 'Find', scope: 'find bar', keys: { shift: true, key: 'Enter', macKey: 'Enter' } },
  findClose: { id: 'find.close', title: 'Close the find bar', group: 'Find', scope: 'find bar', keys: { key: 'Escape', name: 'Esc' } },

  // Session: the window of a Subagent, the field of a Session and its slash menu.
  // While the Session view shows a Subagent: back to the Subagent or the Session that started it.
  back: { id: 'session.back', title: 'Back to what started the Subagent', group: 'Session', scope: 'session view', keys: primary('[') },
  send: { id: 'session.send', title: 'Send the message', group: 'Session', scope: 'composer', keys: { key: 'Enter' } },
  newLine: { id: 'session.new-line', title: 'New line', group: 'Session', scope: 'composer', keys: { shift: true, key: 'Enter' } },
  interrupt: { id: 'session.interrupt', title: 'Interrupt the turn', group: 'Session', scope: 'composer', keys: { key: 'Escape', name: 'Esc' } },
  history: { id: 'session.history', title: 'Earlier and later messages', group: 'Session', scope: 'composer', keys: { key: 'ArrowUp', also: ['ArrowDown'], name: '↑↓' } },
  slashSelect: { id: 'session.slash-select', title: 'Choose the slash command', group: 'Session', scope: 'slash menu', keys: { key: 'Enter' } },

  // Terminal. On Windows Ctrl+I is Tab of the shell: the entry is macOS's alone.
  terminalRequest: { id: 'terminal.request', title: 'Command request (zsh with Terminal AI)', group: 'Terminal', scope: 'terminal', keys: primary('I'), platforms: ['mac'] },
} as const satisfies Record<string, Shortcut>

/** Every entry, in the order of the list above: the order of the rows inside a group of the window. */
export const SHORTCUT_LIST: readonly Shortcut[] = Object.values(SHORTCUTS)

/** The system of a Node.js `process.platform`: what main knows itself by. */
export function shortcutPlatformOf(platform: string): ShortcutPlatform {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'windows'
  return 'linux'
}

/** The entry's keys as an Electron accelerator: `CmdOrCtrl+Alt+=`. */
export function accelerator(shortcut: Shortcut): string {
  const { keys } = shortcut
  return [...(keys.primary === true ? ['CmdOrCtrl'] : []), ...(keys.alt === true ? ['Alt'] : []), ...(keys.shift === true ? ['Shift'] : []), keys.key].join('+')
}

/**
 * What a menu item of the entry carries on `platform` (a `process.platform`): its accelerator, and
 * `registerAccelerator: false` where the renderer catches the key instead (`rendererCatchesOn`).
 */
export function menuKeys(shortcut: Shortcut, platform: string): { accelerator: string; registerAccelerator?: false } {
  const caught = shortcut.rendererCatchesOn?.includes(shortcutPlatformOf(platform)) === true
  return caught ? { accelerator: accelerator(shortcut), registerAccelerator: false } : { accelerator: accelerator(shortcut) }
}
