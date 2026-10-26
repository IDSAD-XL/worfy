// Linking through Tailscale by hand (worfy-link ticket 29; ADR-0070, point 5): the address field
// takes a MagicDNS name or a Tailscale address with the port the other window shows; the Host check
// takes this machine's MagicDNS names while "Link through Tailscale" is on; "Link a machine" lists
// the Tailscale address first while the setting is on, and the window marks it.
import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { allowedHostNames, isAllowedHost, isAllowedHostName, isTailscaleAddress, type HostNames } from '../../src/main/link/checks'
import { appLinkEnvironment, linkAddresses } from '../../src/main/link/service'
import { isTailscaleHost, parseLinkAddress } from '../../src/shared/ipc/link'

const info = (address: string, internal = false): NetworkInterfaceInfo =>
  (address.includes(':')
    ? { address, family: 'IPv6', netmask: '', mac: '00:00:00:00:00:00', internal, cidr: null, scopeid: 0 }
    : { address, family: 'IPv4', netmask: '', mac: '00:00:00:00:00:00', internal, cidr: null }) as NetworkInterfaceInfo

describe('an address typed by hand', () => {
  it.each([
    ['pc:52000', { host: 'pc', port: 52000 }],
    ['pc.example.ts.net:52000', { host: 'pc.example.ts.net', port: 52000 }],
    ['100.101.102.103:52000', { host: '100.101.102.103', port: 52000 }],
    ['[fd7a:115c:a1e0::1]:52000', { host: 'fd7a:115c:a1e0::1', port: 52000 }],
  ])('reads %s', (text, address) => {
    expect(parseLinkAddress(text)).toEqual({ ok: true, address })
  })

  it('asks for the port of a MagicDNS name typed without one', () => {
    expect(parseLinkAddress('pc')).toEqual({ ok: false, error: 'Add the port: host:port' })
  })
})

describe('the MagicDNS names of this machine in the Host check', () => {
  const interfaces = { en0: [info('192.168.0.119')], utun4: [info('100.101.102.103'), info('fd7a:115c:a1e0::1')] }
  const port = 52000
  const machine = (hostname: string, tailscale: boolean): HostNames => ({ interfaces, hostname, tailscale })

  it.each([
    ['pc.local', 'macOS: os.hostname() in .local'],
    ['PC', 'Windows: the bare computer name, upper case'],
    ['pc', 'the bare name'],
  ])('takes pc and pc.<tailnet>.ts.net for %s (%s) while the setting is on', (hostname) => {
    const on = machine(hostname, true)
    expect(allowedHostNames(on).has('pc')).toBe(true)
    for (const name of ['pc', 'pc.example.ts.net', 'pc.tail1234.ts.net', 'PC.Example.TS.NET'.toLowerCase()]) expect(isAllowedHostName(name, on), name).toBe(true)
    for (const host of [`pc:${port}`, `PC:${port}`, `pc.example.ts.net:${port}`]) expect(isAllowedHost(host, port, on), host).toBe(true)
  })

  it.each([
    ['other.example.ts.net', 'another machine of the tailnet'],
    ['other', 'another bare name'],
    ['pc.ts.net', 'no tailnet between the name and ts.net'],
    ['xpc.example.ts.net', 'a name that only ends in pc'],
    ['pc-2.example.ts.net', 'a name that only starts with pc'],
    ['pc.example.ts.net.evil.test', 'ts.net not at the end (DNS rebinding)'],
    ['pc.example.ts.netx', 'not the ts.net zone'],
    ['pc..ts.net', 'an empty tailnet label'],
    ['pc.exa_mple.ts.net', 'a tailnet label that is not a DNS label'],
    ['pc.example.com', 'another zone'],
  ])('refuses %s (%s) with the setting on', (name) => {
    expect(isAllowedHostName(name, machine('pc.local', true))).toBe(false)
    expect(isAllowedHost(`${name}:${port}`, port, machine('pc.local', true))).toBe(false)
  })

  it('takes none of the MagicDNS names while the setting is off; the rest of the list stays', () => {
    const off = machine('pc.local', false)
    expect(allowedHostNames(off).has('pc')).toBe(false)
    for (const name of ['pc', 'pc.example.ts.net', 'other.example.ts.net']) expect(isAllowedHostName(name, off), name).toBe(false)
    expect(isAllowedHost(`pc:${port}`, port, off)).toBe(false)
    // The interface addresses, the Tailscale ones included, and the .local name pass either way.
    for (const host of [`100.101.102.103:${port}`, `[fd7a:115c:a1e0::1]:${port}`, `pc.local:${port}`]) {
      expect(isAllowedHost(host, port, off), host).toBe(true)
      expect(isAllowedHost(host, port, machine('pc.local', true)), host).toBe(true)
    }
  })

  it('takes no bare name when os.hostname() is empty', () => {
    const on = machine('', true)
    expect(isAllowedHostName('.example.ts.net', on)).toBe(false)
    expect([...allowedHostNames(on)].sort()).toEqual([...allowedHostNames(machine('', false))].sort())
  })

  it('keeps the port check for a MagicDNS name', () => {
    expect(isAllowedHost(`pc:${port + 1}`, port, machine('pc.local', true))).toBe(false)
    expect(isAllowedHost('pc', port, machine('pc.local', true))).toBe(false)
  })
})

describe('the Tailscale address in "Link a machine"', () => {
  it('isTailscaleHost of the window agrees with isTailscaleAddress of main', () => {
    const table = [
      '100.64.0.0',
      '100.101.102.103',
      '100.127.255.255',
      '100.63.255.255',
      '100.128.0.0',
      '10.0.0.5',
      '192.168.1.20',
      'fd7a:115c:a1e0::1',
      'fd7a:115c:a1e0:ab12:4843:cd96:6258:b240',
      'FD7A:115C:A1E0::5',
      'fd7a:115c:a1e1::1',
      'fd7a:115c::1',
      'fd7a::115c:a1e0:1',
      'fd00::1',
      '::1',
      'pc',
      'pc.example.ts.net',
      '100.101.102',
      '100.101.102.103.4',
    ]
    for (const host of table) expect(isTailscaleHost(host), host).toBe(isTailscaleAddress(host))
    expect(table.filter((host) => isTailscaleHost(host))).toEqual(['100.64.0.0', '100.101.102.103', '100.127.255.255', 'fd7a:115c:a1e0::1', 'fd7a:115c:a1e0:ab12:4843:cd96:6258:b240', 'FD7A:115C:A1E0::5'])
  })

  const interfaces = {
    en0: [info('192.168.1.20'), info('fe80::1cf6:52ec:1e29:a090'), info('2a02:2378::5')],
    lo0: [info('127.0.0.1', true), info('::1', true)],
    utun4: [info('100.101.102.103'), info('fd7a:115c:a1e0::1'), info('fe80::abcd')],
  }

  it('lists the Tailscale addresses first while the setting is on', () => {
    expect(linkAddresses(interfaces, 52000, true)).toEqual(['100.101.102.103:52000', '[fd7a:115c:a1e0::1]:52000', '192.168.1.20:52000', '[2a02:2378::5]:52000'])
  })

  it('keeps the order of the interfaces while the setting is off: IPv4, then IPv6', () => {
    expect(linkAddresses(interfaces, 52000, false)).toEqual(['192.168.1.20:52000', '100.101.102.103:52000', '[2a02:2378::5]:52000', '[fd7a:115c:a1e0::1]:52000'])
  })
})

describe('WORFY_LINK_INTERFACES: the interfaces an e2e test gives the app', () => {
  const MAP = '{"en0":["192.168.1.20"],"utun4":["100.101.102.103","fd7a:115c:a1e0::1"]}'

  /** Runs `body` with console.warn recorded; returns what it warned. */
  function warned(body: () => void): string[] {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      body()
      return warn.mock.calls.map((call) => String(call[0]))
    } finally {
      warn.mockRestore()
    }
  }

  it('reads a JSON map of interface names to addresses, as non-internal entries, in an unpacked build', () => {
    const env = appLinkEnvironment('dev', { WORFY_LINK_HOST: '127.0.0.1', WORFY_LINK_INTERFACES: MAP })
    expect(env.listenHost).toBe('127.0.0.1')
    expect(Object.keys(env.interfaces ?? {})).toEqual(['en0', 'utun4'])
    expect(linkAddresses(env.interfaces ?? {}, 52000, true)).toEqual(['100.101.102.103:52000', '[fd7a:115c:a1e0::1]:52000', '192.168.1.20:52000'])
    expect(env.interfaces?.utun4?.map((entry) => [entry.family, entry.internal])).toEqual([
      ['IPv4', false],
      ['IPv6', false],
    ])
  })

  it('is not read by a packaged build: the app keeps its real interfaces', () => {
    const env = appLinkEnvironment('packaged', { WORFY_LINK_HOST: '127.0.0.1', WORFY_LINK_BONJOUR: '0', WORFY_LINK_INTERFACES: MAP })
    expect(env.interfaces).toBeUndefined()
    // The other two variables keep working as before.
    expect(env).toEqual({ listenHost: '127.0.0.1', bonjour: false })
  })

  it('keeps only IP literals: a name would join the Host allowlist and pass DNS rebinding', () => {
    let env: ReturnType<typeof appLinkEnvironment> | undefined
    const warnings = warned(() => {
      env = appLinkEnvironment('dev', { WORFY_LINK_INTERFACES: '{"x":["evil.test","100.101.102.103","","localhost","100.101.102","fe80::1%en0"]}' })
    })
    expect(env?.interfaces?.x?.map((entry) => entry.address)).toEqual(['100.101.102.103', 'fe80::1%en0'])
    expect(warnings).toEqual(['"evil.test"', '""', '"localhost"', '"100.101.102"'].map((value) => expect.stringContaining(`WORFY_LINK_INTERFACES: ${value} is not an IP address`)))
    const names = allowedHostNames({ interfaces: env?.interfaces ?? {}, hostname: 'pc.local', tailscale: true })
    expect(names.has('evil.test')).toBe(false)
    expect(isAllowedHost('evil.test:52000', 52000, { interfaces: env?.interfaces ?? {}, hostname: 'pc.local', tailscale: true })).toBe(false)
  })

  it('gives none when unset, and none with a warning when it is not such a map', () => {
    expect(warned(() => expect(appLinkEnvironment('dev', {}).interfaces).toBeUndefined())).toEqual([])
    for (const text of ['not json', '[]', '{"en0":"192.168.1.20"}', '{"en0":[5]}', 'null']) {
      expect(warned(() => expect(appLinkEnvironment('dev', { WORFY_LINK_INTERFACES: text }).interfaces, text).toBeUndefined()), text).toEqual([
        expect.stringContaining('WORFY_LINK_INTERFACES'),
      ])
    }
  })
})
