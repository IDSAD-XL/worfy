// The `codeStoriesSetting` domain (worfy-code-stories ticket 03): the switch "Code stories for PRs" of
// Project settings. It shows and writes the Profile field `code_stories.pr`: "on" — the implementer writes a
// Code story of each ticket's PR, "off" — it does not. The field is the Profile's, not a worfy setting, because
// the Harness reads only the Profile (spec decision 25). Absent or null reads as on, as `bin/profile` resolves it
// (decision 14). The write goes through the Harness's `bin/profile-set --field code_stories.pr`
// (src/main/ipc/code-stories-setting.ts), as Eco mode does (src/shared/ipc/eco-mode.ts, ADR-0073), never by
// worfy itself (ADR-0002, ADR-0005), with `--expect` and the fingerprint the window read.
// The channels are `project`, as `ecoMode`: a window that shows a Linked machine reads and writes the Profile of
// that Machine's Project through the link. Reading is `read`, open with read-only access; writing is `write`,
// open only with full access.
import { z } from 'zod'
import { absolutePathSchema } from '../paths'
import { invokeChannel } from './channels'
import { pipelineFingerprintSchema } from './pipeline'

/** What the switch shows for a Project. */
export const codeStoriesSettingStateSchema = z.discriminatedUnion('available', [
  /** Not read: the Harness has no `bin/profile-set --field`, or the root is no Project of this Machine. */
  z.object({ available: z.literal(false), reason: z.string() }),
  z.object({
    available: z.literal(true),
    /** `code_stories.pr` of the Profile is not "off". */
    on: z.boolean(),
    /** The fingerprint of the field: a write goes ahead only while the Profile still has it. */
    fingerprint: pipelineFingerprintSchema,
  }),
])
export type CodeStoriesSettingState = z.infer<typeof codeStoriesSettingStateSchema>

/** The switch's state for the Project at `root`. Writes nothing. */
export const codeStoriesSettingRead = invokeChannel('codeStoriesSetting.read', z.object({ root: absolutePathSchema }), codeStoriesSettingStateSchema, 'project', 'read')

export const codeStoriesSettingSetInputSchema = z.object({
  root: absolutePathSchema,
  /** true writes `code_stories.pr: "on"`, false writes "off". */
  on: z.boolean(),
  /** The fingerprint `codeStoriesSetting.read` (or the last write) gave. */
  expected: pipelineFingerprintSchema,
})

export const codeStoriesSettingSetResultSchema = z.discriminatedUnion('status', [
  /** Written. `warning`: why the change was not committed in the Harness home's git; the write stays. */
  z.object({ status: z.literal('saved'), on: z.boolean(), fingerprint: pipelineFingerprintSchema, warning: z.string().nullable() }),
  /** The field is not the one read: nothing written; read again. */
  z.object({ status: z.literal('conflict') }),
  /** Another write of the same Profile held its lock for the whole wait: nothing written, try again. */
  z.object({ status: z.literal('busy') }),
  /** `bin/profile-set` refused the value (exit 1) with this reason: nothing written. */
  z.object({ status: z.literal('invalid'), reason: z.string() }),
  /** The Harness has no `bin/profile-set --field`: nothing written. */
  z.object({ status: z.literal('too-old') }),
])
export type CodeStoriesSettingSetResult = z.infer<typeof codeStoriesSettingSetResultSchema>

/** Turns the story PR on or off for the Project at `root`: the click of the switch. */
export const codeStoriesSettingSet = invokeChannel('codeStoriesSetting.set', codeStoriesSettingSetInputSchema, codeStoriesSettingSetResultSchema, 'project', 'write')

declare module './channels' {
  interface IpcContract {
    'codeStoriesSetting.read': typeof codeStoriesSettingRead
    'codeStoriesSetting.set': typeof codeStoriesSettingSet
  }
}
