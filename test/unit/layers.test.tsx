// The scale of layers (z-index, worfy-ui-kit ticket 02): named tokens in theme/tokens.css, the same
// values for inline styles in theme/layers.ts, and the first places that take them.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PINNED_Z_INDEX } from '../../src/renderer/canvas/pinning'
import { AUTOPILOT_WINDOW_LAYER } from '../../src/renderer/autopilot/StartNowModal'
import { MACHINE_WINDOW_LAYER } from '../../src/renderer/machines/machine-dialogs'
import { SETTINGS_LAYER } from '../../src/renderer/settings/settings-window'
import { LAYERS } from '../../src/renderer/theme/layers'

const read = (path: string): string => readFileSync(join(import.meta.dirname, '../../src/renderer', path), 'utf8')

/** `canvasOverlay` → `--z-canvas-overlay`. */
const tokenOf = (name: string): string => `--z-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`

describe('the scale of layers', () => {
  const tokens = read('theme/tokens.css')

  it.each(Object.entries(LAYERS))('%s has the same value in tokens.css and in layers.ts', (name, value) => {
    expect(tokens).toContain(`${tokenOf(name)}: ${value};`)
  })

  it('tokens.css has no z-index token layers.ts does not know', () => {
    const declared = [...tokens.matchAll(/(--z-[a-z-]+):/g)].map((match) => match[1])
    expect(declared.sort()).toEqual(Object.keys(LAYERS).map(tokenOf).sort())
  })

  it('keeps the order the layers had: panel < popover < the Command palette < dialog < toast < a menu over a dialog < the top', () => {
    expect(LAYERS.panel).toBeLessThan(LAYERS.popover)
    expect(LAYERS.popover).toBeLessThan(LAYERS.palette)
    expect(LAYERS.palette).toBeLessThan(LAYERS.dialog)
    // The modal windows of the kit (Settings among them) are the dialog layer: the toasts stay above it.
    expect(LAYERS.dialog).toBeLessThan(LAYERS.toast)
    expect(LAYERS.toast).toBeGreaterThan(110)
    // The list of a Select opens over a dialog, over focus mode and over the Binding menu (2000).
    expect(LAYERS.dialogMenu).toBeGreaterThan(Math.max(LAYERS.toast, LAYERS.canvasOverlay, 2000))
    expect(LAYERS.top).toBeGreaterThan(Math.max(...Object.values(LAYERS).filter((value) => value !== LAYERS.top)))
  })
})

describe('the places on the scale', () => {
  it('the toasts take --z-toast', () => {
    expect(read('toast/toast.css')).toMatch(/\.w-toasts \{[^}]*z-index: var\(--z-toast\);/)
  })

  it('the list of a Select takes --z-dialog-menu', () => {
    expect(read('theme/select.css')).toMatch(/\.w-select-list \{[^}]*z-index: var\(--z-dialog-menu\);/)
  })

  it('a pinned Node takes the Canvas overlay layer', () => {
    expect(PINNED_Z_INDEX).toBe(LAYERS.canvasOverlay)
    expect(read('canvas/pinning.ts')).toContain('LAYERS.canvasOverlay')
  })

  it('the Command palette takes the palette layer, on the portal of its kit window', () => {
    expect(read('palette/CommandPalette.tsx')).toContain('layer="palette"')
  })

  it('none of them keeps a number of its own', () => {
    expect(read('toast/toast.css')).not.toMatch(/z-index: \d/)
    expect(read('theme/select.css')).not.toMatch(/z-index: \d/)
    expect(read('palette/CommandPalette.tsx')).not.toMatch(/zIndex: \d/)
    expect(read('palette/palette.css')).not.toMatch(/z-index/)
  })
})

describe('the modal windows of the kit among the layers that are not on the scale yet', () => {
  const imageOverlay = Number(/\.w-image-overlay \{[^}]*z-index: (\d+);/.exec(read('session/session.css'))?.[1])

  it('Settings, Keyboard shortcuts and the Guide sit on the dialog layer', () => {
    expect(SETTINGS_LAYER).toBe(LAYERS.dialog)
  })

  it('a kit window is above the Command palette and a full-screen image: ⌘, over either opens the window on top', () => {
    // The palette kept its z-index of before the kit (101) when it moved onto the kit (worfy-ui-kit ticket 08).
    expect(LAYERS.palette).toBe(101)
    expect(imageOverlay).toBe(105)
    expect(LAYERS.dialog).toBeGreaterThan(LAYERS.palette)
    expect(LAYERS.dialog).toBeGreaterThan(imageOverlay)
    // A full-screen image stays over the palette, as before.
    expect(imageOverlay).toBeGreaterThan(LAYERS.palette)
  })

  it('a kit window is under the toasts', () => {
    expect(LAYERS.dialog).toBeLessThan(LAYERS.toast)
  })
})

describe('the kit windows that take a layer other than the dialog layer (worfy-ui-kit ticket 06)', () => {
  it('the windows of a Linked machine and of Autopilot keep z 120: above Settings, which Remove of Settings → Machines opens over', () => {
    for (const layer of [MACHINE_WINDOW_LAYER, AUTOPILOT_WINDOW_LAYER] as const) {
      expect(LAYERS[layer]).toBe(120)
      expect(LAYERS[layer]).toBeGreaterThan(SETTINGS_LAYER)
    }
  })

  it('they share the layer of the toasts and are drawn after them, so they stay over the toasts as before', () => {
    expect(LAYERS[MACHINE_WINDOW_LAYER]).toBe(LAYERS.toast)
    expect(LAYERS[AUTOPILOT_WINDOW_LAYER]).toBe(LAYERS.toast)
  })

  it('none of them keeps a number of its own', () => {
    expect(read('machines/machine-dialogs.ts')).not.toMatch(/zIndex|MACHINE_DIALOG_LAYER/)
    expect(read('autopilot/autopilot-modal.css')).not.toMatch(/z-index/)
    for (const path of ['machines/LinkMachineDialog.tsx', 'shell/FirstRun.tsx', 'autopilot/StartNowModal.tsx', 'autopilot/StartAutopilotModal.tsx', 'machines/ChangeAddressDialog.tsx']) {
      expect(read(path)).not.toMatch(/zIndex: \d/)
    }
  })

  it('Link a machine (100 before) and First run (90 before) are on the dialog layer now: above the Command palette and a full-screen image, which no key opens over a kit window', () => {
    expect(LAYERS.dialog).toBeGreaterThan(101)
    expect(LAYERS.dialog).toBeGreaterThan(105)
    expect(read('machines/LinkMachineDialog.tsx')).not.toMatch(/layer=/)
    expect(read('shell/FirstRun.tsx')).not.toMatch(/\slayer=/)
  })
})

// The windows of the Projects (worfy-ui-kit ticket 05) on the kit's Dialog. Before it they kept a
// layer of their own: 95 (Remove project, the Machine step and the connect dialog of "Add project"),
// 96 (the folder browser), 100 (Project settings), 110 (Edit profile); the Command palette (101) and a
// full-screen image (105) were above the first four. Now all six are on the dialog layer, above both,
// as the test of the kit windows above pins; the palette does not open over a kit window, which keeps
// the ⌘ keys of the app (theme/kit/Dialog.tsx).
describe('the windows of the Projects on the dialog layer', () => {
  const WINDOWS = ['shell/ProjectSettings.tsx', 'shell/sidebar/ProjectsSection.tsx', 'projects/RemoveProject.tsx', 'projects/ConnectProject.tsx', 'projects/FolderBrowser.tsx', 'projects/EditProfile.tsx']

  it.each(WINDOWS)('%s draws its windows in the Dialog of the kit, with no portal, backdrop or role of its own', (path) => {
    const source = read(path)
    expect(source).toMatch(/import \{ Dialog \} from '(\.\.\/)+theme\/kit\/Dialog'/)
    expect(source).not.toContain('createPortal')
    expect(source).not.toContain('role="dialog"')
    expect(source).not.toMatch(/backdrop: \{/)
  })

  // ProjectsSection.tsx keeps both for the context menu of a Project, which ticket 12 moves onto the kit.
  it.each(WINDOWS.filter((path) => path !== 'shell/sidebar/ProjectsSection.tsx'))('%s keeps no z-index and no Esc of its own', (path) => {
    const source = read(path)
    expect(source).not.toMatch(/zIndex/)
    expect(source).not.toContain("'Escape'")
  })
})
