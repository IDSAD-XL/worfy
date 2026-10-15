import {
  FILE_COPY_LIMIT_BYTES,
  MAX_ATTACHMENTS,
  fileTooLarge,
  imageTooLarge,
  tooManyAttachments,
  type Attachment,
  type AttachmentSource,
  type AttachResult,
} from '../../shared/agent/attachments'
import type { InvokeInput, InvokeOutput, IpcResult } from '../../shared/ipc/channels'

// Pasted and dropped files of a message, shared by the input field of the Session view
// (MessageInput.tsx) and the input field of a live Session Node (canvas/nodes/SessionNode.tsx).
// The renderer reads the bytes; main checks each file and copies what needs copying
// (`agent.attach`, src/main/agent/attachments.ts). No React here: the callers keep their chips.

/** Where a file came from: a pasted file is always an image. */
export type FileKind = 'pasted' | 'dropped'

/** The `agent.attach` call; the renderer's `invoke`, or a fake in a test. */
export type AttachInvoke = (channel: 'agent.attach', input: InvokeInput<'agent.attach'>) => Promise<IpcResult<InvokeOutput<'agent.attach'>>>

/** What became of some files: main's answer for the ones it saw, and why the others were refused. */
export interface AttachOutcome {
  results: readonly AttachResult[]
  refused: readonly string[]
}

/** The files read, ready for main, and why the others were refused. */
export interface ReadFiles {
  sources: AttachmentSource[]
  refused: string[]
}

/** A file with no name of its own is a pasted image. */
const nameOf = (file: File): string => (file.name === '' ? 'image.png' : file.name)

/** The bytes of a File in base64. */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error(`${file.name} could not be read`))
    reader.readAsDataURL(file)
  })
}

/**
 * Reads the files the message still has `room` for. A file too big to carry is refused before it
 * is read; what does not fit in the message is neither read nor sent to main.
 */
export async function readFiles(all: readonly File[], kind: FileKind, room: number): Promise<ReadFiles> {
  const sources: AttachmentSource[] = []
  const refused: string[] = []
  const files = all.slice(0, Math.max(0, room))
  const left = all.slice(files.length).map(nameOf)
  for (const file of files) {
    const name = nameOf(file)
    if (file.size > FILE_COPY_LIMIT_BYTES) {
      refused.push(kind === 'pasted' || file.type.startsWith('image/') ? imageTooLarge(name) : fileTooLarge(name))
      continue
    }
    try {
      sources.push({ kind, name, data: await base64Of(file) })
    } catch (reason) {
      refused.push(reason instanceof Error ? reason.message : String(reason))
    }
  }
  if (left.length > 0) refused.push(tooManyAttachments(left))
  return { sources, refused }
}

/** Has main check the read files for the Session `sessionId`; main is not asked about none. */
export async function checkFiles({ sources, refused }: ReadFiles, sessionId: string, invoke: AttachInvoke): Promise<AttachOutcome> {
  if (sources.length === 0) return { results: [], refused }
  const result = await invoke('agent.attach', { sessionId, sources })
  return result.ok ? { results: result.value.results, refused } : { results: [], refused: [...refused, result.error] }
}

/** Reads the files, then has main check them. */
export async function attachFiles(files: readonly File[], kind: FileKind, room: number, sessionId: string, invoke: AttachInvoke): Promise<AttachOutcome> {
  return checkFiles(await readFiles(files, kind, room), sessionId, invoke)
}

/**
 * What a field makes of main's answer when it comes: the attachments it still has `room` for, and
 * the problem to show — every refusal, and the names left out — or null when there is none.
 */
export function takeAttached({ results, refused }: AttachOutcome, room: number): { taken: Attachment[]; problem: string | null } {
  const ok = results.flatMap((result) => (result.ok ? [result.attachment] : []))
  const fits = Math.max(0, room)
  const taken = ok.slice(0, fits)
  const left = ok.slice(fits).map((attachment) => attachment.name)
  const reasons = [...refused, ...results.flatMap((result) => (result.ok ? [] : [result.error])), ...(left.length > 0 ? [tooManyAttachments(left)] : [])]
  return { taken, problem: reasons.length > 0 ? reasons.join('\n') : null }
}

/** How many more attachments a message with `attached` of them takes. */
export const roomFor = (attached: number): number => Math.max(0, MAX_ATTACHMENTS - attached)
