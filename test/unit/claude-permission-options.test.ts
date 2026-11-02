// canUseTool of Claude Code becomes worfy's neutral `permission_request` in the Claude driver
// (worfy-multi-vendor ticket 14): the request carries the Vendor's options — for Claude the same three
// as before, Allow / Always allow / Deny — and answering each gives Claude Code the answer the
// Session's gate gave it before the ticket.
import { describe, expect, it } from 'vitest'
import { PermissionGate } from '../../src/main/agent/permissions'
import { CANCELLED_MESSAGE, claudeCanUseTool, CLAUDE_PERMISSION_OPTIONS, DENIED_MESSAGE } from '../../src/main/vendors/claude/session'
import type { AgentEvent } from '../../src/shared/agent/events'

const BASH = { command: 'mkdir -p build/one', description: 'Create the build folder' }

function gate() {
  const events: AgentEvent[] = []
  const permissions = new PermissionGate((event) => events.push(event), () => undefined)
  const requests = () => events.flatMap((event) => (event.type === 'permission_request' ? [event] : []))
  return { events, permissions, requests, canUseTool: claudeCanUseTool(permissions) }
}

describe('permission_request of Claude', () => {
  it('carries the three options and the tool as its subject', async () => {
    const { requests, canUseTool, permissions } = gate()
    void canUseTool('Bash', BASH, { signal: new AbortController().signal, toolUseID: 'toolu_1' })
    expect(requests()).toEqual([
      expect.objectContaining({
        type: 'permission_request',
        subject: 'Bash',
        toolName: 'Bash',
        toolUseId: 'toolu_1',
        input: BASH,
        options: [
          { id: 'allow', label: 'Allow', kind: 'allow' },
          { id: 'always_allow', label: 'Always allow', kind: 'allow_always' },
          { id: 'deny', label: 'Deny', kind: 'deny' },
        ],
      }),
    ])
    expect(requests()[0]?.options).toEqual(CLAUDE_PERMISSION_OPTIONS)
    permissions.cancelAll()
  })

  it('leaves "Always allow" out when Claude Code says it must not be offered', async () => {
    const { requests, canUseTool, permissions } = gate()
    void canUseTool('Bash', BASH, { signal: new AbortController().signal, suppressAlwaysAllowRule: true })
    expect(requests()[0]?.options.map((option) => option.id)).toEqual(['allow', 'deny'])
    permissions.cancelAll()
  })

  it.each([
    ['allow', { behavior: 'allow', updatedInput: BASH }],
    ['always_allow', { behavior: 'allow', updatedInput: BASH }],
    ['deny', { behavior: 'deny', message: DENIED_MESSAGE }],
  ])('answered with %s gives canUseTool the answer it gave before', async (option, before) => {
    const { events, requests, canUseTool, permissions } = gate()
    const answer = canUseTool('Bash', BASH, { signal: new AbortController().signal })
    expect(permissions.answer(requests()[0]?.requestId ?? '', option)).toBe(true)
    expect(await answer).toEqual(before)
    expect(events.at(-1)).toEqual({ type: 'permission_resolved', requestId: requests()[0]?.requestId, decision: option })
  })

  it('after "Always allow" the tool runs without asking; another tool still asks', async () => {
    const { requests, canUseTool, permissions } = gate()
    const first = canUseTool('Bash', BASH, { signal: new AbortController().signal })
    permissions.answer(requests()[0]?.requestId ?? '', 'always_allow')
    await first
    expect(await canUseTool('Bash', { command: 'ls' }, { signal: new AbortController().signal })).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })
    expect(requests()).toHaveLength(1)
    void canUseTool('Write', { file_path: '/tmp/x' }, { signal: new AbortController().signal })
    expect(requests()).toHaveLength(2)
    permissions.cancelAll()
  })

  it('a request refused by Interrupt or the close gives the cancelled answer, as before', async () => {
    const { canUseTool, permissions } = gate()
    const answer = canUseTool('Bash', BASH, { signal: new AbortController().signal })
    permissions.cancelAll()
    expect(await answer).toEqual({ behavior: 'deny', message: CANCELLED_MESSAGE, interrupt: true })
  })

  it('an option the request does not offer is refused, and the request stays open', async () => {
    const { requests, canUseTool, permissions } = gate()
    void canUseTool('Bash', BASH, { signal: new AbortController().signal, suppressAlwaysAllowRule: true })
    const requestId = requests()[0]?.requestId ?? ''
    expect(() => permissions.answer(requestId, 'always_allow')).toThrow(/does not offer/)
    expect(() => permissions.answer(requestId, 'maybe')).toThrow(/does not offer/)
    expect(permissions.pending).toBe(1)
    permissions.cancelAll()
  })
})
