// Browser profiles (worfy-browser ticket 03, ADR-0078 item 5): the partition of a profile, read
// from the Project id and the profile id (src/shared/browser/partition.ts); the reading of an
// origin and the record of a profile (src/shared/browser/profiles.ts). The rule by which a Browser
// Node gets its profile is test/unit/browser-profile-choice.test.tsx.
import { describe, expect, it } from 'vitest'
import { browserPartition, browserPartitions, DEFAULT_BROWSER_PROFILE } from '../../src/shared/browser/partition'
import { browserProfileSchema, browserProfilesFileSchema, defaultBrowserProfile, parseOrigin } from '../../src/shared/browser/profiles'

describe('the partition of a Browser profile', () => {
  it('is persist:worfy-browser-<hash of the Project>-<profile id>', () => {
    expect(browserPartition('alpha-0a1b2c3d', 'admin-1f2e3d')).toBe('persist:worfy-browser-0a1b2c3d-admin-1f2e3d')
    expect(browserPartition('My Project (copy) é-0a1b2c3d', 'user-000000')).toBe('persist:worfy-browser-0a1b2c3d-user-000000')
  })

  it('is the one of ticket 10 for the profile `default`, so the logins made before profiles stay with it', () => {
    expect(DEFAULT_BROWSER_PROFILE).toBe('default')
    expect(browserPartition('alpha-0a1b2c3d', 'default')).toBe('persist:worfy-browser-0a1b2c3d-default')
    expect(browserPartition('alpha-0a1b2c3d')).toBe('persist:worfy-browser-0a1b2c3d-default')
  })

  it('differs between two profiles of one Project, and between one profile id in two Projects', () => {
    const admin = browserPartition('alpha-0a1b2c3d', 'admin-aaaaaa')
    const user = browserPartition('alpha-0a1b2c3d', 'user-bbbbbb')
    expect(admin).not.toBeNull()
    expect(admin).not.toBe(user)
    expect(browserPartition('alpha-0a1b2c3d', 'default')).not.toBe(browserPartition('beta-99999999', 'default'))
  })

  it('is none for a profile id Electron could not make a folder of: only lowercase letters, digits and single dashes', () => {
    for (const id of ['', 'Admin', 'a b', 'a/b', '../x', 'a.b', '-a', 'a-', 'a--b', 'é', 'a'.repeat(41)]) expect(browserPartition('alpha-0a1b2c3d', id), JSON.stringify(id)).toBeNull()
    expect(browserPartition('alpha', 'default'), 'a Project id without the hash').toBeNull()
  })

  it('lists the partitions of every profile of every Project, once each', () => {
    const profiles: Record<string, string[]> = { 'alpha-0a1b2c3d': ['default', 'admin-aaaaaa', 'default'], 'beta-99999999': ['user-bbbbbb', 'Bad Id'], odd: ['default'] }
    expect(browserPartitions(Object.keys(profiles), (id) => profiles[id] ?? [])).toEqual([
      'persist:worfy-browser-0a1b2c3d-default',
      'persist:worfy-browser-0a1b2c3d-admin-aaaaaa',
      'persist:worfy-browser-99999999-user-bbbbbb',
    ])
    // A Project with no profile (all deleted) has no partition.
    expect(browserPartitions(['alpha-0a1b2c3d'], () => [])).toEqual([])
  })
})

describe('an origin of a Browser profile', () => {
  it('is scheme://host or scheme://host:port, http or https, written as the browser writes it', () => {
    expect(parseOrigin('http://localhost:3000')).toEqual({ origin: 'http://localhost:3000' })
    expect(parseOrigin('https://staging.example.com')).toEqual({ origin: 'https://staging.example.com' })
    expect(parseOrigin('  HTTPS://Staging.Example.com:443/ ')).toEqual({ origin: 'https://staging.example.com' })
    expect(parseOrigin('http://127.0.0.1:8080')).toEqual({ origin: 'http://127.0.0.1:8080' })
    expect(parseOrigin('http://[::1]:8080')).toEqual({ origin: 'http://[::1]:8080' })
  })

  it('has no path, query, fragment or user', () => {
    for (const text of ['https://example.com/path', 'https://example.com/a/', 'https://example.com?x=1', 'https://example.com#top', 'https://user@example.com', 'https://example.com//']) {
      expect(parseOrigin(text), text).toEqual({ error: expect.stringMatching(/no path, query or user/) })
    }
  })

  it('is exact: a * of subdomains is refused (the owner\'s decision 2)', () => {
    for (const text of ['https://*.example.com', 'https://*', 'http://localhost:*']) expect(parseOrigin(text), text).toEqual({ error: expect.stringMatching(/only exact origins/) })
  })

  it('is refused without a scheme, with a scheme other than http(s), with a bad port, or empty', () => {
    expect(parseOrigin('example.com')).toMatchObject({ error: expect.stringMatching(/scheme:\/\/host:port/) })
    expect(parseOrigin('ftp://example.com')).toMatchObject({ error: expect.stringMatching(/only http and https/) })
    expect(parseOrigin('file:///etc')).toMatchObject({ error: expect.any(String) })
    expect(parseOrigin('http://localhost:99999')).toMatchObject({ error: expect.stringMatching(/not a valid address/) })
    expect(parseOrigin('   ')).toMatchObject({ error: expect.any(String) })
  })

  it('is kept only in the browser\'s spelling: the file schema refuses any other', () => {
    const profile = { id: 'admin-aaaaaa', name: 'admin', origins: ['http://localhost:3000'], autopilot: false }
    expect(browserProfileSchema.safeParse(profile).success).toBe(true)
    for (const origin of ['HTTP://localhost:3000', 'https://example.com:443', 'https://*.example.com', 'https://example.com/x']) {
      expect(browserProfileSchema.safeParse({ ...profile, origins: [origin] }).success, origin).toBe(false)
    }
    // An empty list is allowed.
    expect(browserProfileSchema.safeParse({ ...profile, origins: [] }).success).toBe(true)
  })
})

describe('the flag «Available to Autopilot»', () => {
  it('is off unless a profile says otherwise, in the file and in Default', () => {
    const read = browserProfilesFileSchema.parse({ profiles: [{ id: 'admin-aaaaaa', name: 'admin', origins: [] }] })
    expect(read.profiles[0]?.autopilot).toBe(false)
    expect(defaultBrowserProfile()).toEqual({ id: 'default', name: 'Default', origins: [], autopilot: false })
  })
})
