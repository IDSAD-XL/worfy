// The note's textarea against text that comes from main (src/renderer/canvas/nodes/NoteNode.tsx).
//
// main answers each `patchData` with the whole Layout, and answers can arrive while newer typing
// is already on its way. The note is rendered alone, with a fake LayoutOps whose answers the test
// releases by hand, and its `text` prop plays the role of main's copy.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NoteNode, { NOTE_SEND_DELAY_MS } from '../../src/renderer/canvas/nodes/NoteNode'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import { LayoutOpsContext, type LayoutOps } from '../../src/renderer/canvas/useLayout'
import type { LayoutOpInput } from '../../src/shared/layout/types'

interface Sent {
  text: unknown
  answer(): void
}

function setup(initial: string) {
  const sent: Sent[] = []
  const ops: LayoutOps = {
    apply(op: LayoutOpInput) {
      return new Promise<void>((resolve) => {
        sent.push({ text: op.op === 'patchData' ? op.data.text : undefined, answer: resolve })
      })
    },
  }
  const ui = (text: string) => {
    const props = { id: 'n', data: { node: { data: { text } } }, selected: false } as unknown as CanvasNodeProps
    return (
      <ReactFlowProvider>
        <LayoutOpsContext.Provider value={ops}>
          <NoteNode {...props} />
        </LayoutOpsContext.Provider>
      </ReactFlowProvider>
    )
  }
  const view = render(ui(initial))
  const textarea = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement
  return {
    sent,
    textarea,
    type: (value: string) => fireEvent.change(textarea, { target: { value } }),
    pause: () => act(() => vi.advanceTimersByTime(NOTE_SEND_DELAY_MS)),
    fromMain: (text: string) => view.rerender(ui(text)),
    answer: async (index: number) => {
      await act(async () => {
        sent[index]?.answer()
        await Promise.resolve()
      })
    },
    unmount: () => view.unmount(),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('note text', () => {
  it('keeps unsent typing when text from main arrives', () => {
    const note = setup('')
    note.type('abc')
    note.fromMain('from elsewhere')
    expect(note.textarea.value).toBe('abc')
    note.pause()
    expect(note.sent.map((s) => s.text)).toEqual(['abc'])
  })

  it('keeps newer typing when main answers an earlier send late', async () => {
    const note = setup('')
    note.type('abc')
    note.pause()
    note.type('abcd')
    note.pause()
    expect(note.sent.map((s) => s.text)).toEqual(['abc', 'abcd'])
    // main's answer to 'abc' arrives while 'abcd' is still on its way.
    note.fromMain('abc')
    await note.answer(0)
    expect(note.textarea.value).toBe('abcd')
    // The next key is typed on top of 'abcd', not of the stale 'abc'.
    note.type(`${note.textarea.value}x`)
    note.pause()
    expect(note.sent.at(-1)?.text).toBe('abcdx')
  })

  it('takes text from main that arrived during a send once every send is answered', async () => {
    const note = setup('')
    note.type('abc')
    note.pause()
    // Someone else (an agent through main) rewrote the note while 'abc' was on its way, and
    // main answers 'abc' with that newer text.
    note.fromMain('rewritten')
    expect(note.textarea.value).toBe('abc')
    await note.answer(0)
    expect(note.textarea.value).toBe('rewritten')
  })

  it('takes text from main when nothing is typed or on its way', () => {
    const note = setup('first')
    note.fromMain('second')
    expect(note.textarea.value).toBe('second')
  })

  it('sends unsent typing when the note goes away', () => {
    const note = setup('')
    note.type('typed just before')
    expect(note.sent).toEqual([])
    note.unmount()
    expect(note.sent.map((s) => s.text)).toEqual(['typed just before'])
  })
})
