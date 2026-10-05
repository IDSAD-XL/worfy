// readDocs (src/main/docs/watch.ts) lists the ADRs by number whatever order the folder gives the
// names in: readdir makes no promise about it, so here it hands them out shuffled.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const order = vi.hoisted(() => ({ names: null as string[] | null }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      const names = (await actual.readdir(...args)) as unknown as string[]
      return order.names ? order.names.filter((name) => names.includes(name)) : names
    },
  }
})

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'worfy-adr-order-'))
  mkdirSync(join(root, 'docs', 'adr'), { recursive: true })
  for (const name of ['0001-a.md', '0002-b.md', '0010-c.md', '0010-a.md']) writeFileSync(join(root, 'docs', 'adr', name), `# ${name}\n`)
})

afterEach(() => {
  order.names = null
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

it('orders the ADRs by number, then by path, when the folder lists them out of order', async () => {
  order.names = ['0010-c.md', '0002-b.md', '0010-a.md', '0001-a.md']
  const { readDocs } = await import('../../src/main/docs/watch')
  const { adrs } = await readDocs(root)
  expect(adrs.map((adr) => adr.path)).toStrictEqual(['docs/adr/0001-a.md', 'docs/adr/0002-b.md', 'docs/adr/0010-a.md', 'docs/adr/0010-c.md'])
})
