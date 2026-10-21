// Quiet windows (src/main/quiet-windows.ts): a mode for the e2e tests only. WORFY_QUIET_WINDOWS=1
// shows the window without activating worfy, keeps it out of the Dock and the menu bar, makes it
// transparent and lets the mouse through it, and keeps Chromium painting it. Without the variable,
// or with any other value, worfy starts the way it always has.
import { describe, expect, it } from 'vitest'
import { KEEP_PAINTING_WINDOWS, NORMAL_WINDOWS, quietWindows } from '../../src/main/quiet-windows'

describe('quietWindows', () => {
  it('without WORFY_QUIET_WINDOWS keeps the normal start: show(), focus, system notifications, no activation policy', () => {
    const plan = quietWindows({}, 'darwin')
    expect(plan).toEqual(NORMAL_WINDOWS)
    expect(plan).toEqual({
      quiet: false,
      show: 'show',
      takesFocus: true,
      systemNotifications: true,
      activationPolicy: null,
      chromiumSwitches: [],
      backgroundThrottling: undefined,
      opacity: undefined,
      ignoreMouseEvents: false,
    })
  })

  it('with WORFY_QUIET_WINDOWS=1 shows the window inactive, transparent, mouse-through and kept painting, without system notifications', () => {
    expect(quietWindows({ WORFY_QUIET_WINDOWS: '1' }, 'darwin')).toEqual({
      quiet: true,
      show: 'showInactive',
      takesFocus: false,
      systemNotifications: false,
      activationPolicy: 'accessory',
      chromiumSwitches: ['disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding'],
      backgroundThrottling: false,
      opacity: 0,
      ignoreMouseEvents: true,
    })
  })

  it('sets the activation policy on macOS only: the other systems have no such call', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const plan = quietWindows({ WORFY_QUIET_WINDOWS: '1' }, platform)
      expect(plan.quiet).toBe(true)
      expect(plan.show).toBe('showInactive')
      expect(plan.activationPolicy).toBeNull()
    }
  })

  it.each(['0', '', 'true', 'yes', ' 1', '1 ', '2'])('treats WORFY_QUIET_WINDOWS=%j as the normal start', (value) => {
    expect(quietWindows({ WORFY_QUIET_WINDOWS: value }, 'darwin')).toEqual(NORMAL_WINDOWS)
  })

  // WORFY_KEEP_PAINTING=1 (every e2e start, playwright.config.ts): the painting switches of quiet
  // mode without the rest of it, for the specs that turn quiet windows off for the real focus.
  it('with WORFY_KEEP_PAINTING=1 alone keeps the normal start and adds only the painting switches and backgroundThrottling: false', () => {
    const plan = quietWindows({ WORFY_KEEP_PAINTING: '1' }, 'darwin')
    expect(plan).toEqual({
      ...NORMAL_WINDOWS,
      chromiumSwitches: ['disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding'],
      backgroundThrottling: false,
    })
    expect(plan).toBe(KEEP_PAINTING_WINDOWS)
    // Focus and notifications as in a normal start: linked-notify.spec.ts relies on both.
    expect(plan.show).toBe('show')
    expect(plan.takesFocus).toBe(true)
    expect(plan.systemNotifications).toBe(true)
  })

  it('with WORFY_QUIET_WINDOWS=0 and WORFY_KEEP_PAINTING=1 (test/e2e/linked-notify.spec.ts) is still kept painting', () => {
    expect(quietWindows({ WORFY_QUIET_WINDOWS: '0', WORFY_KEEP_PAINTING: '1' }, 'win32')).toEqual(KEEP_PAINTING_WINDOWS)
  })

  it('with both variables is quiet mode, its switches once', () => {
    expect(quietWindows({ WORFY_QUIET_WINDOWS: '1', WORFY_KEEP_PAINTING: '1' }, 'darwin')).toEqual(quietWindows({ WORFY_QUIET_WINDOWS: '1' }, 'darwin'))
  })

  it.each(['0', '', 'true', ' 1', '2'])('treats WORFY_KEEP_PAINTING=%j as not set', (value) => {
    expect(quietWindows({ WORFY_KEEP_PAINTING: value }, 'darwin')).toEqual(NORMAL_WINDOWS)
  })

  it('reads process.env by default', () => {
    const before = process.env.WORFY_QUIET_WINDOWS
    try {
      process.env.WORFY_QUIET_WINDOWS = '1'
      expect(quietWindows().quiet).toBe(true)
      delete process.env.WORFY_QUIET_WINDOWS
      expect(quietWindows().quiet).toBe(false)
    } finally {
      if (before === undefined) delete process.env.WORFY_QUIET_WINDOWS
      else process.env.WORFY_QUIET_WINDOWS = before
    }
  })
})
