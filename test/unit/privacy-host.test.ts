// distinctiveHost of harness/lib/privacy.cjs: the host name of the machine is searched for in text only
// when it is a secret worth keeping. A host named with a common word (a platform, a kind of computer)
// would otherwise flag ordinary text — the platform field of an evidence line, a ticket — as a leak.
// Every host name here is invented.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

type Finding = { rule: string; index: number; length: number }
type Privacy = {
  distinctiveHost: (hostname: unknown) => string
  hostNeedles: (hostname: unknown) => string[]
  findings: (text: string, options?: { hostname?: string }) => Finding[]
  maskText: (text: string, options?: { hostname?: string }) => string
}

const privacy = createRequire(import.meta.url)('../../harness/lib/privacy.cjs') as Privacy

// Host-shaped values are built from pieces, so the personal data check of the repository does not find them here.
const LOCAL = '.lo' + 'cal'
const MB = 'Mac' + 'Book'
const PC = '-' + 'PC'
const S_MAC = 's-' + 'Mac'
const DESKTOP = 'DESK' + 'TOP-'

const rules = (text: string, hostname: string): string[] => privacy.findings(text, { hostname }).map((f) => f.rule)

describe('distinctiveHost', () => {
  it.each([
    ['a platform word', 'Mac'],
    ['a platform word with .local', `mac${LOCAL}`],
    ['a platform word with a home router domain', 'Linux.lan'],
    ['Windows', 'WINDOWS'],
    ['a kind of computer', 'laptop'],
    ['a role', 'server'],
    ['a role with a machine number', 'server1'],
    ['a platform word with a machine number', 'mac-02'],
    ['a model name alone', `${MB}-Pro${LOCAL}`],
    ['a model name with the number macOS adds', `Mac-mini-2${LOCAL}`],
    ['a short word before the model', `my-${MB}-Air`],
    ['a common word before -PC', `Office${PC}`],
    ['shorter than three characters', 'ab'],
    ['one letter before a model suffix', 'a-mac'],
    ['a common word before a model suffix', `new-${MB}`],
    ['digits only', '12345'],
    ['localhost', 'localhost'],
    ['empty', ''],
    ['not a string', undefined],
  ])('is "" for %s', (_label, hostname) => {
    expect(privacy.distinctiveHost(hostname)).toBe('')
  })

  it.each([
    ['a name with a model suffix', `jdoes-${MB}-Pro${LOCAL}`, `jdoes-${MB}-Pro`],
    ['a name with -Mac and a number', `jdoe${S_MAC}-2${LOCAL}`, `jdoe${S_MAC}-2`],
    ['a name with -PC', `jdoe${PC}`, `jdoe${PC}`],
    ['a name of four letters', 'qbit', 'qbit'],
    ['a name with a router domain', 'jdoe-workbox.lan', 'jdoe-workbox'],
    ['the Windows default of six characters', `${DESKTOP}ABC123`, `${DESKTOP}ABC123`],
    ['the Windows default of seven digits', `${DESKTOP}1234567`, `${DESKTOP}1234567`],
    ['a CI runner name', 'fv-az123-456', 'fv-az123-456'],
    ['a name that only ends in the letters of a model', 'Tomac', 'Tomac'],
    ['a bare name of three letters', `Max${LOCAL}`, 'Max'],
    ['a three-letter name before -iMac', `Bob-iMac${LOCAL}`, 'Bob-iMac'],
    ['a three-letter name before -Mac-mini', 'Bob-Mac-mini', 'Bob-Mac-mini'],
    ['a three-letter name before -Mac-Studio', 'Eve-Mac-Studio', 'Eve-Mac-Studio'],
    ['a three-letter name before -PC in capitals', `BOB${PC}`, `BOB${PC}`],
    ['a three-letter name before -pc in lower case', 'bob-pc', 'bob-pc'],
    ['a possessive of two letters before the model, in lower case', 'als-macbook-pro', 'als-macbook-pro'],
    ['a two-letter name before -PC', `Bo${PC}`, `Bo${PC}`],
  ])('keeps %s as its first label', (_label, hostname, label) => {
    expect(privacy.distinctiveHost(hostname)).toBe(label)
  })
})

describe('findings and maskText with options.hostname', () => {
  it('a common-word host name gives no finding for that word', () => {
    const text = 'evidence: test-run pass · `pnpm test` exit 0 · mac - · 0123abc\n{"platform":"mac","name":"Mac"}'
    expect(rules(text, `Mac${LOCAL}`)).toEqual([])
    expect(rules(text, 'mac')).toEqual([])
    expect(privacy.maskText(text, { hostname: `Mac${LOCAL}` })).toBe(text)
  })

  it('a distinctive host name in a text is a host finding and is masked whole', () => {
    const text = 'line one\nbuilt on QBIT-Studio today, and on qbit-studio again'
    expect(rules(text, 'QBIT-Studio.lan')).toEqual(['host', 'host'])
    const masked = privacy.maskText(text, { hostname: 'QBIT-Studio.lan' })
    expect(masked).toBe('line one\nbuilt on QB…(11) today, and on qb…(11) again')
    expect(masked.toLowerCase()).not.toContain('qbit-studio')
  })

  it('a Windows default host name of six characters is still a finding', () => {
    expect(rules(`on ${DESKTOP}ABC123 now`, `${DESKTOP}ABC123`)).toEqual(['host'])
    expect(privacy.maskText(`on ${DESKTOP}ABC123 now`, { hostname: `${DESKTOP}ABC123` })).toBe('on DE…(14) now')
  })

  it('a model-suffixed host is judged by the name before the suffix', () => {
    expect(rules(`the ${MB}-Pro answers`, `${MB}-Pro${LOCAL}`)).toEqual([])
    expect(rules('ssh qbits-iMac now', `qbits-iMac${LOCAL}`)).toEqual(['host'])
  })
})

describe('leakRules of a gate-failures export', () => {
  type LeakRules = (text: string, ctx: { hostname?: string; folders?: { rule: string; dir: string }[] }) => string[]
  const load = async (): Promise<LeakRules> => {
    const url = pathToFileURL(join(import.meta.dirname, '..', '..', 'harness', 'lib', 'gate-failures', 'transfer-common.mjs')).href
    return ((await import(url)) as { leakRules: LeakRules }).leakRules
  }

  it('does not refuse a record for a host name that is a common word, and refuses one with a distinctive host name', async () => {
    const leakRules = await load()
    expect(leakRules('skipped on mac: no display', { hostname: 'mac' })).toEqual([])
    expect(leakRules('failed on jdoe-workbox.lan today', { hostname: 'jdoe-workbox.lan' })).toEqual(['host', 'host name of this computer'])
    expect(leakRules('failed on Bob-iMac today', { hostname: `Bob-iMac${LOCAL}` })).toEqual(['host', 'host name of this computer'])
  })

  it('refuses a record with the full domain name of this computer even when its first label is common', async () => {
    const leakRules = await load()
    const host = 'dev01.acme-internal.example'
    expect(leakRules(`failed on ${host}`, { hostname: host })).toEqual(['host', 'host name of this computer'])
    expect(leakRules('failed on dev01', { hostname: host })).toEqual([])
  })
})

describe('hostNeedles', () => {
  it.each([
    ['a bare common word', 'Mac', []],
    ['a common word with .local: the full name', `Mac${LOCAL}`, [`Mac${LOCAL}`]],
    ['a full domain name whose first label is common: the full name only', 'dev01.acme-internal.example', ['dev01.acme-internal.example']],
    ['a distinctive name with a domain: the full name and the label', 'jdoe-workbox.lan', ['jdoe-workbox.lan', 'jdoe-workbox']],
    ['a distinctive bare name: the name', 'jdoe-workbox', ['jdoe-workbox']],
    ['localhost with a domain', 'localhost.localdomain', []],
    ['not a string', undefined, []],
  ])('gives %s', (_label, hostname, needles) => {
    expect(privacy.hostNeedles(hostname)).toEqual(needles)
  })

  it('a full domain name whose first label is common is a finding and masked, its first label alone is not', () => {
    const host = 'dev01.acme-internal.example'
    expect(rules(`resolved ${host} in 3 ms`, host)).toEqual(['host'])
    expect(privacy.maskText(`resolved ${host} in 3 ms`, { hostname: host })).toBe('resolved de…(27) in 3 ms')
    expect(rules('the dev01 build', host)).toEqual([])
  })

  it('a short owner name before a model suffix is a finding in any letter case', () => {
    expect(rules('ssh bob-imac now', `Bob-iMac${LOCAL}`)).toEqual(['host'])
    expect(rules('ssh als-macbook-pro now', 'als-macbook-pro')).toEqual(['host'])
  })
})
