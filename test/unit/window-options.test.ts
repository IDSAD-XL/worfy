// The frame of the main window by system (src/main/window-frame.ts, worfy-windows ticket 11): the
// frame of design F on macOS, the system's own frame with an opaque background elsewhere.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { frameOptions, WINDOW_BACKGROUND } from '../../src/main/window-frame'

describe('frameOptions', () => {
  it('on macOS is the frame of design F: no title bar, inset traffic lights, a translucent window', () => {
    const mac = {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 20, y: 19 },
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
      backgroundColor: '#00000000',
    }
    expect(frameOptions('darwin', false)).toEqual(mac)
    expect(frameOptions('darwin', true)).toEqual(mac)
  })

  it.each(['win32', 'linux'] as const)('on %s is the system frame: none of the macOS options, an opaque background of the theme', (platform) => {
    expect(frameOptions(platform, false)).toEqual({ backgroundColor: '#f7f7f9' })
    expect(frameOptions(platform, true)).toEqual({ backgroundColor: '#121110' })
    for (const dark of [false, true]) {
      const options = frameOptions(platform, dark)
      for (const key of ['titleBarStyle', 'trafficLightPosition', 'vibrancy', 'visualEffectState']) expect(options).not.toHaveProperty(key)
      // Six hex digits: no alpha channel.
      expect(options.backgroundColor).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('takes the opaque backgrounds from --bg of the light and the dark theme', () => {
    const tokens = readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'theme', 'tokens.css'), 'utf8')
    const dark = tokens.indexOf('@media (prefers-color-scheme: dark)')
    expect(dark).toBeGreaterThan(0)
    const bg = (css: string): string | undefined => /--bg:\s*(#[0-9a-f]{6});/.exec(css)?.[1]
    expect(WINDOW_BACKGROUND.light).toBe(bg(tokens.slice(0, dark)))
    expect(WINDOW_BACKGROUND.dark).toBe(bg(tokens.slice(dark)))
  })
})
