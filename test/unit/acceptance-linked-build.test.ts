// The build of a Linked machine for an item of the Acceptance view (worfy-acceptance ticket 07,
// src/shared/acceptance/linked-build.ts): the line of an item whose `needs:` names another platform, the commit a
// decision names, and what the view says of a worfy there older than the view. Every name is invented.
import { describe, expect, it } from 'vitest'
import { buildCommit, linkedBuildLine, linkedCommit, olderWorfyText, type BuildMachine } from '../../src/shared/acceptance/linked-build'

const PC: BuildMachine = { id: 'pc', name: 'Studio PC', online: true, build: '0.4.2101+3f2a1b9c', platform: 'windows' }
const MINI: BuildMachine = { id: 'mini', name: 'Mini', online: true, build: '0.4.2099+abcdef1', platform: 'mac' }
const OLD_PC: BuildMachine = { id: 'old', name: 'Old PC', online: true, build: '0.4.1990+1234567' }

describe('linkedBuildLine', () => {
  it("on the Mac, an item for Windows shows the PC's build while the PC is online; offline or unlinked — \"PC not connected\"", () => {
    expect(linkedBuildLine('windows', 'mac', null, [MINI, PC])).toEqual({ state: 'online', text: 'PC build: 0.4.2101+3f2a1b9c (Studio PC)', machineId: 'pc' })
    expect(linkedBuildLine('windows', 'mac', null, [{ id: 'pc', name: 'Studio PC', online: false }])).toEqual({ state: 'not-connected', text: 'PC not connected', machineId: null })
    expect(linkedBuildLine('windows', 'mac', null, [])).toEqual({ state: 'not-connected', text: 'PC not connected', machineId: null })
  })

  it("an item for this Machine's own platform has no line: its Stable copy line says enough", () => {
    expect(linkedBuildLine('mac', 'mac', null, [MINI, PC])).toBeNull()
    // Nor a platform the owner-check line does not know.
    expect(linkedBuildLine('ios', 'mac', null, [MINI, PC])).toBeNull()
  })

  it("in a window on the PC, an item for Windows names the PC itself, even next to another PC; one for this Mac has none", () => {
    const other: BuildMachine = { ...PC, id: 'pc-2', name: 'Another PC', build: '0.4.2000+aaaaaaa' }
    expect(linkedBuildLine('windows', 'mac', 'pc', [other, PC])?.text).toBe('PC build: 0.4.2101+3f2a1b9c (Studio PC)')
    expect(linkedBuildLine('mac', 'mac', 'pc', [other, PC])).toBeNull()
    // A window on another Mac: an item for the Mac names that Mac's build.
    expect(linkedBuildLine('mac', 'mac', 'mini', [MINI, PC])?.text).toBe('Mac build: 0.4.2099+abcdef1 (Mini)')
  })

  it("a window on a Linked machine of a build before the ticket (its build said, no platform): the line says to update worfy there", () => {
    expect(linkedBuildLine('windows', 'mac', 'old', [OLD_PC])).toEqual({ state: 'old', text: 'Update worfy on Old PC: it does not say its platform', machineId: 'old' })
    // A PC of a newer build wins.
    expect(linkedBuildLine('windows', 'mac', 'old', [OLD_PC, PC])?.state).toBe('online')
  })

  it("right after a connection opens, before its `hello`, nothing says to update: the Machine is not connected yet for the line", () => {
    const opening: BuildMachine = { id: 'pc', name: 'Studio PC', online: true }
    expect(linkedBuildLine('windows', 'mac', null, [opening])).toEqual({ state: 'not-connected', text: 'PC not connected', machineId: null })
    expect(linkedBuildLine('windows', 'mac', 'pc', [opening])).toEqual({ state: 'not-connected', text: 'PC not connected', machineId: null })
  })

  it("this Machine's window, the PC offline and an old Linked Mac online: \"PC not connected\", no update offered on that Mac", () => {
    const oldMac: BuildMachine = { id: 'old-mac', name: 'Old Mac', online: true, build: '0.4.1990+1234567' }
    expect(linkedBuildLine('windows', 'mac', null, [oldMac, { ...PC, online: false, build: undefined, platform: undefined }])).toEqual({ state: 'not-connected', text: 'PC not connected', machineId: null })
  })
})

describe('linkedCommit', () => {
  it("names the commit of the Linked machine's build for its platform, the window's Machine first", () => {
    expect(linkedCommit('windows', 'mac', null, [PC])).toEqual({ sha: '3f2a1b9c', build: '0.4.2101+3f2a1b9c' })
    expect(linkedCommit('windows', 'mac', 'pc', [PC])).toEqual({ sha: '3f2a1b9c', build: '0.4.2101+3f2a1b9c' })
    expect(linkedCommit('mac', 'mac', 'mini', [MINI])).toEqual({ sha: 'abcdef1', build: '0.4.2099+abcdef1' })
  })

  it("null on this Machine's own platform, and when no Linked machine of the platform is online", () => {
    expect(linkedCommit('mac', 'mac', null, [MINI, PC])).toBeNull()
    expect(linkedCommit('windows', 'mac', null, [{ ...PC, online: false }])).toBeNull()
    expect(linkedCommit('linux', 'mac', null, [MINI, PC])).toBeNull()
  })

  it('a build with uncommitted changes is not its commit: `-`', () => {
    expect(linkedCommit('windows', 'mac', null, [{ ...PC, build: '0.4.2101+3f2a1b9c.dirty' }])).toEqual({ sha: '-', build: '0.4.2101+3f2a1b9c.dirty' })
  })
})

describe('buildCommit', () => {
  it('reads the SHA of `<semver>+<SHA>`; none of a dirty build or another text', () => {
    expect(buildCommit('0.4.2101+3f2a1b9c')).toBe('3f2a1b9c')
    expect(buildCommit('0.4.2101+3f2a1b9c.dirty')).toBeNull()
    expect(buildCommit('0.2.0+bench')).toBeNull()
    expect(buildCommit('0.4.2101')).toBeNull()
  })
})

describe('olderWorfyText', () => {
  it("turns a Linked machine's \"not open\" for the view's channels into \"Update worfy on <name>\"; anything else stays", () => {
    expect(olderWorfyText('acceptance.get', 'acceptance.get: not open to Linked machines', 'Studio PC')).toBe('Update worfy on Studio PC: its worfy has no Acceptance view yet')
    expect(olderWorfyText('actions.ownerCheck', 'actions.ownerCheck: not open to Linked machines', 'Studio PC')).toBe('Update worfy on Studio PC: its worfy cannot record an owner check yet')
    expect(olderWorfyText('acceptance.get', 'Studio PC is unreachable', 'Studio PC')).toBeNull()
    expect(olderWorfyText('acceptance.get', 'Linked machines can only view the Projects of Studio PC: access is read-only', 'Studio PC')).toBeNull()
    expect(olderWorfyText('projects.list', 'projects.list: not open to Linked machines', 'Studio PC')).toBeNull()
  })
})
