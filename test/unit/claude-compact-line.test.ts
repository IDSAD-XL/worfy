// The line a compaction leaves in the Session view (worfy-continuity ticket 12): Claude Code's
// system/compact_boundary becomes a notice "Context compacted (auto) · 812K → 41K" from its
// compact_metadata — the trigger, the tokens before and, when Claude Code tells them, after.
import { describe, expect, it } from 'vitest'
import { sdkMessageToEvents } from '../../src/shared/vendors/claude/events'

const boundary = (metadata: unknown) => ({ type: 'system', subtype: 'compact_boundary', compact_metadata: metadata, session_id: 's-1', uuid: 'u-1' })

describe('the line of a compaction', () => {
  it('names the trigger and the tokens before and after', () => {
    expect(sdkMessageToEvents(boundary({ trigger: 'auto', pre_tokens: 812_000, post_tokens: 41_000 }))).toEqual([
      { type: 'notice', kind: 'notification', text: 'Context compacted (auto) · 812K → 41K' },
    ])
  })

  it('leaves the second number out when Claude Code does not tell the tokens after', () => {
    expect(sdkMessageToEvents(boundary({ trigger: 'manual', pre_tokens: 150_000 }))).toEqual([
      { type: 'notice', kind: 'notification', text: 'Context compacted (manual) · 150K' },
    ])
    expect(sdkMessageToEvents(boundary({ trigger: 'manual', pre_tokens: 150_000, post_tokens: null }))).toEqual([
      { type: 'notice', kind: 'notification', text: 'Context compacted (manual) · 150K' },
    ])
  })

  it('writes the numbers as the context meter does: one decimal, K and M', () => {
    expect(sdkMessageToEvents(boundary({ trigger: 'auto', pre_tokens: 1_234_567, post_tokens: 84_250 }))).toEqual([
      { type: 'notice', kind: 'notification', text: 'Context compacted (auto) · 1.2M → 84.3K' },
    ])
    expect(sdkMessageToEvents(boundary({ trigger: 'auto', pre_tokens: 950, post_tokens: 0 }))).toEqual([
      { type: 'notice', kind: 'notification', text: 'Context compacted (auto) · 950 → 0' },
    ])
  })

  it('still shows the line, without the parts it cannot read, when the metadata is missing or odd', () => {
    expect(sdkMessageToEvents({ type: 'system', subtype: 'compact_boundary' })).toEqual([{ type: 'notice', kind: 'notification', text: 'Context compacted' }])
    expect(sdkMessageToEvents(boundary({ trigger: 'auto', pre_tokens: 'many' }))).toEqual([{ type: 'notice', kind: 'notification', text: 'Context compacted (auto)' }])
  })
})
