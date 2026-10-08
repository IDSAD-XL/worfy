// The checks the link server runs before the WebSocket handshake (src/main/link/checks.ts): the
// peer address is loopback or local network, and Host names this machine with the server port.
import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import { allowedHostNames, isAllowedHost, isLocalNetworkAddress, normalizeAddress, parseHostHeader } from '../../src/main/link/checks'

describe('isLocalNetworkAddress', () => {
  it.each([
    ['127.0.0.1', 'IPv4 loopback'],
    ['127.255.0.9', 'the rest of 127/8'],
    ['10.0.0.1', '10/8'],
    ['10.255.255.254', '10/8, top'],
    ['172.16.0.1', '172.16/12, bottom'],
    ['172.31.255.254', '172.16/12, top'],
    ['192.168.0.119', '192.168/16'],
    ['169.254.10.20', 'link-local IPv4'],
    ['::1', 'IPv6 loopback'],
    ['fc00::1', 'fc00::/7'],
    ['fd12:3456:789a::1', 'fc00::/7, fd half'],
    ['fe80::1cf6:52ec:1e29:a090', 'fe80::/10'],
    ['febf::1', 'fe80::/10, top'],
    ['fe80::1%en0', 'with a zone id'],
    ['::ffff:192.168.1.5', 'IPv4 in IPv6, local'],
    ['::ffff:127.0.0.1', 'IPv4 loopback in IPv6'],
    ['::ffff:7f00:1', 'IPv4 loopback in IPv6, hex form'],
    ['[::1]', 'in brackets'],
  ])('accepts %s (%s)', (address) => {
    expect(isLocalNetworkAddress(address)).toBe(true)
  })

  it.each([
    ['8.8.8.8', 'public IPv4'],
    ['172.15.255.255', 'just below 172.16/12'],
    ['172.32.0.1', 'just above 172.16/12'],
    ['192.169.0.1', 'next to 192.168/16'],
    ['169.253.0.1', 'next to 169.254/16'],
    ['11.0.0.1', 'next to 10/8'],
    ['2001:4860:4860::8888', 'public IPv6'],
    ['fec0::1', 'just above fe80::/10'],
    ['fe00::1', 'below fc00::/7'],
    ['::ffff:8.8.8.8', 'public IPv4 in IPv6'],
    ['::ffff:808:808', 'public IPv4 in IPv6, hex form'],
    ['::', 'unspecified'],
    ['not an address', 'malformed'],
    ['', 'empty'],
  ])('refuses %s (%s)', (address) => {
    expect(isLocalNetworkAddress(address)).toBe(false)
  })

  it('reduces IPv4 inside IPv6 to IPv4', () => {
    expect(normalizeAddress('::FFFF:192.168.0.5')).toBe('192.168.0.5')
    expect(normalizeAddress('fe80::1%en0')).toBe('fe80::1')
  })
})

describe('the Host allowlist', () => {
  const info = (address: string, family: 'IPv4' | 'IPv6'): NetworkInterfaceInfo =>
    ({ address, family, netmask: '', mac: '00:00:00:00:00:00', internal: false, cidr: null, ...(family === 'IPv6' ? { scopeid: 0 } : {}) }) as NetworkInterfaceInfo
  const names = {
    interfaces: { en0: [info('192.168.0.119', 'IPv4'), info('fe80::1cf6:52ec:1e29:a090', 'IPv6')], lo0: [info('127.0.0.1', 'IPv4'), info('::1', 'IPv6')] },
    hostname: 'Alexeys-MacBook-Pro.local',
  }
  const port = 52000

  it('lists the interface addresses, localhost, loopback and the .local name', () => {
    expect([...allowedHostNames(names)].sort()).toEqual(
      ['127.0.0.1', '192.168.0.119', '::1', 'alexeys-macbook-pro.local', 'fe80::1cf6:52ec:1e29:a090', 'localhost'].sort(),
    )
    // Windows: os.hostname() has no domain; its mDNS name is <name>.local.
    expect(allowedHostNames({ interfaces: {}, hostname: 'DESKTOP-PC' }).has('desktop-pc.local')).toBe(true)
  })

  it.each([
    `192.168.0.119:${port}`,
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `LOCALHOST:${port}`,
    `[::1]:${port}`,
    `[fe80::1cf6:52ec:1e29:a090]:${port}`,
    `Alexeys-MacBook-Pro.local:${port}`,
  ])('accepts %s', (host) => {
    expect(isAllowedHost(host, port, names)).toBe(true)
  })

  it.each([
    [`evil.example:${port}`, 'a foreign name (DNS rebinding)'],
    [`192.168.0.120:${port}`, 'another address of the network'],
    [`192.168.0.119:${port + 1}`, 'a foreign port'],
    ['192.168.0.119', 'no port: means 443'],
    ['[::1]', 'IPv6 in brackets without a port'],
    [`::1:${port}`, 'IPv6 without brackets'],
    [`[::1:${port}`, 'unclosed bracket'],
    [`localhost:${port}x`, 'a malformed port'],
    ['', 'empty'],
  ])('refuses %s (%s)', (host) => {
    expect(isAllowedHost(host, port, names)).toBe(false)
  })

  it('refuses a missing Host', () => {
    expect(isAllowedHost(undefined, port, names)).toBe(false)
  })

  it('takes a Host without a port as 443', () => {
    expect(isAllowedHost('localhost', 443, names)).toBe(true)
    expect(parseHostHeader('[::1]')).toEqual({ name: '::1', port: undefined })
    expect(parseHostHeader(`[::1]:${port}`)).toEqual({ name: '::1', port })
  })
})
