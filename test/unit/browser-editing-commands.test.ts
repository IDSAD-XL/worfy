// The editing commands main sends with a key from the frames of another screen (worfy-browser ticket
// 07, src/main/browser/cdp.ts editingCommands): on macOS Chromium runs ⌘A, ⌘C, ⌘V, ⌘X and ⌘Z only as
// commands, so a key sent over CDP alone would do nothing.
import { describe, expect, it } from 'vitest'
import { editingCommands } from '../../src/main/browser/cdp'

const META = 4
const SHIFT = 8
const CTRL = 2
const ALT = 1

describe('editingCommands', () => {
  it('names the command of each ⌘ shortcut on macOS, by the key code', () => {
    expect(editingCommands('KeyA', META, 'darwin')).toEqual(['selectAll'])
    expect(editingCommands('KeyC', META, 'darwin')).toEqual(['copy'])
    expect(editingCommands('KeyV', META, 'darwin')).toEqual(['paste'])
    expect(editingCommands('KeyX', META, 'darwin')).toEqual(['cut'])
    expect(editingCommands('KeyZ', META, 'darwin')).toEqual(['undo'])
    expect(editingCommands('KeyZ', META | SHIFT, 'darwin')).toEqual(['redo'])
  })

  it('names none for another key, another modifier, or another platform', () => {
    expect(editingCommands('KeyB', META, 'darwin')).toBeUndefined()
    expect(editingCommands('KeyA', 0, 'darwin')).toBeUndefined()
    expect(editingCommands('KeyA', META | CTRL, 'darwin')).toBeUndefined()
    expect(editingCommands('KeyA', META | ALT, 'darwin')).toBeUndefined()
    expect(editingCommands('KeyA', CTRL, 'darwin')).toBeUndefined()
    expect(editingCommands('KeyA', META, 'linux')).toBeUndefined()
    expect(editingCommands('KeyA', CTRL, 'win32')).toBeUndefined()
  })
})
