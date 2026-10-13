// src/main/link/secrets.ts: a write of the secrets file that fails (worfy-windows ticket 28 — the
// removal of the temporary file had no test). Real folders: the failure is a folder at the place of
// the file, which no system lets a file be renamed over.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileSecretStore } from '../../src/main/link/secrets'
import { removeTestTree } from '../remove'

describe('FileSecretStore: a write that fails', () => {
  let dir: string

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-link-secrets-')))
  })

  afterEach(() => {
    removeTestTree(dir)
  })

  it('leaves no temporary file beside the secrets file, keeps what it held, and names the file and the code — never the secret', () => {
    const file = join(dir, 'link', 'secrets.json')
    const store = new FileSecretStore(file)
    store.set('machine-key', 'the-first-secret')
    expect(readdirSync(dirname(file))).toEqual(['secrets.json'])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, secrets: { 'machine-key': 'the-first-secret' } })

    unlinkSync(file)
    mkdirSync(file)
    writeFileSync(join(file, 'in-the-way.txt'), 'x')
    let message = ''
    try {
      store.set('outgoing:m1', 'the-second-secret')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/^could not write the link secrets file .*secrets\.json: E[A-Z]+$/)
    expect(message).toContain(file)
    expect(message).not.toContain('the-second-secret')
    // The temporary file held both secrets: it is gone.
    expect(readdirSync(dirname(file))).toEqual(['secrets.json'])
    expect(readdirSync(file)).toEqual(['in-the-way.txt'])
    // What did not reach the disk is not answered from memory either.
    expect(store.get('outgoing:m1')).toBeUndefined()
    expect(store.get('machine-key')).toBe('the-first-secret')
  })
})
