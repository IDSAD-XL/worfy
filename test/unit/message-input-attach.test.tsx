// "+" of the input field in a window on a Linked machine and in a window on this Machine (worfy-link
// ticket 12; ADR-0053, Q14). In a window on Linked machine M the file dialog is this Machine's: "+"
// opens a hidden <input type="file">, and the chosen files go to M as bytes (`agent.attach`,
// source `dropped`), the way a dropped file does. M's own dialog (`agent.attachPick`) is never
// called. In a window on this Machine "+" calls `agent.attachPick`, as before.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FILE_COPY_LIMIT_BYTES, fileTooLarge, tooManyAttachments, type Attachment, type AttachmentSource } from '../../src/shared/agent/attachments'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

const M = 'machine-m'

/** What reached this Machine's preload: the channel, and for `linked.invoke` the channel on M. */
const asked: { channel: string; input: unknown }[] = []
/** The channels called on M through `linked.invoke`, with their input. */
const onM: { channel: string; input: unknown }[] = []

/** M's answer to `agent.attach`: every source taken as a copy in M's data folder. */
function attachOnM(input: { sources: AttachmentSource[] }) {
  return {
    results: input.sources.map((source) => {
      const name = source.kind === 'path' ? source.path : source.name
      const attachment: Attachment = { kind: 'file', name, path: `/data/m/attachments/${name}`, size: 5, copied: true }
      return { ok: true, attachment }
    }),
  }
}

beforeEach(() => {
  vi.resetModules()
  asked.length = 0
  onM.length = 0
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string, input: unknown) => {
      asked.push({ channel, input })
      if (channel === 'linked.invoke') {
        const call = input as { machine: string; channel: string; input: unknown }
        onM.push({ channel: call.channel, input: call.input })
        if (call.channel === 'agent.attach') return Promise.resolve({ ok: true, value: { ok: true, value: attachOnM(call.input as { sources: AttachmentSource[] }) } })
        return Promise.resolve({ ok: true, value: { ok: false, error: `${call.channel}: closed to a Linked machine` } })
      }
      if (channel === 'agent.attachPick') return Promise.resolve({ ok: true, value: { results: [] } })
      return Promise.resolve({ ok: false, error: `no ${channel}` })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

async function mount(machine: string | null) {
  window.history.replaceState(null, '', machine === null ? '/' : `/?machine=${machine}&project=p-00000001`)
  const { MessageInput } = await import('../../src/renderer/session/MessageInput')
  render(<MessageInput sessionId="s" busy={false} history={[]} recipient="Orchestrator" onSend={() => Promise.resolve(null)} onInterrupt={() => undefined} />)
}

const fileInput = () => screen.queryByTestId('input-attach-file') as HTMLInputElement | null

/** Chooses `files` in the hidden input, as the OS dialog of this Machine would. */
async function choose(files: File[]) {
  const input = fileInput()
  if (input === null) throw new Error('no hidden file input')
  await act(async () => {
    fireEvent.change(input, { target: { files } })
  })
}

const named = (name: string, text = 'hello') => new File([text], name, { type: 'text/plain' })

/** The calls of `agent.attachPick`, on this Machine or on M. */
const picks = () => [...asked.filter((each) => each.channel === 'agent.attachPick'), ...onM.filter((each) => each.channel === 'agent.attachPick')]

describe('"+" in a window on a Linked machine', () => {
  it('opens a hidden file input instead of calling agent.attachPick', async () => {
    await mount(M)
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    await act(async () => {
      fireEvent.click(screen.getByTestId('input-attach'))
    })
    expect(picks()).toEqual([])
    const input = fileInput()
    expect(input).not.toBeNull()
    expect(input?.type).toBe('file')
    expect(input?.multiple).toBe(true)
    expect(click).toHaveBeenCalledTimes(1)
    expect(click.mock.contexts[0]).toBe(input)
  })

  it('sends the chosen files to M as `dropped` sources in base64, and shows their chips', async () => {
    await mount(M)
    await choose([named('a.txt', 'hello'), named('b.txt', 'world')])
    await vi.waitFor(() => expect(screen.getAllByTestId('attachment-chip')).toHaveLength(2))
    const attach = onM.filter((each) => each.channel === 'agent.attach')
    expect(attach).toEqual([
      {
        channel: 'agent.attach',
        input: {
          sessionId: 's',
          sources: [
            { kind: 'dropped', name: 'a.txt', data: btoa('hello') },
            { kind: 'dropped', name: 'b.txt', data: btoa('world') },
          ],
        },
      },
    ])
    expect(picks()).toEqual([])
  })

  it('refuses a file over 20 MB before reading it, with fileTooLarge', async () => {
    await mount(M)
    const big = named('big.bin')
    Object.defineProperty(big, 'size', { value: FILE_COPY_LIMIT_BYTES + 1 })
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL')
    await choose([big, named('small.txt')])
    await vi.waitFor(() => expect(screen.getByTestId('input-error').textContent).toBe(fileTooLarge('big.bin')))
    // Only the small file was read and sent.
    expect(read).toHaveBeenCalledTimes(1)
    const sources = onM.flatMap((each) => (each.channel === 'agent.attach' ? (each.input as { sources: AttachmentSource[] }).sources : []))
    expect(sources.map((source) => (source.kind === 'path' ? source.path : source.name))).toEqual(['small.txt'])
  })

  it('of 21 files takes 20 and refuses the last with tooManyAttachments', async () => {
    await mount(M)
    const files = Array.from({ length: 21 }, (_, index) => named(`f${index}.txt`))
    await choose(files)
    await vi.waitFor(() => expect(screen.getAllByTestId('attachment-chip')).toHaveLength(20))
    expect(screen.getByTestId('input-error').textContent).toBe(tooManyAttachments(['f20.txt']))
    const sources = onM.flatMap((each) => (each.channel === 'agent.attach' ? (each.input as { sources: AttachmentSource[] }).sources : []))
    expect(sources).toHaveLength(20)
  })

  it('choosing the same file again attaches it again: the input is emptied after each choice', async () => {
    await mount(M)
    await choose([named('a.txt')])
    await vi.waitFor(() => expect(screen.getAllByTestId('attachment-chip')).toHaveLength(1))
    expect(fileInput()?.value).toBe('')
  })
})

describe('"+" in a window on this Machine', () => {
  it('calls agent.attachPick, as before, and has no hidden file input', async () => {
    await mount(null)
    await act(async () => {
      fireEvent.click(screen.getByTestId('input-attach'))
    })
    await vi.waitFor(() => expect(asked.filter((each) => each.channel === 'agent.attachPick')).toEqual([{ channel: 'agent.attachPick', input: { sessionId: 's' } }]))
    expect(fileInput()).toBeNull()
    expect(onM).toEqual([])
  })
})
