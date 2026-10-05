// Lives next to the contract tests, not in test/fixtures/: tsconfig.test.node.json (composite)
// only lists test/unit and test/contract.
// Generates a Project's `.scratch` of a given size, together with the answer `epic-status --json`
// would give for it. Used to measure worfy's own share of a read on an Auction-sized Project
// (42 Epics, 682 Tickets) without running the real script.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface GeneratedScratch {
  /** What `epic-status --json` prints for the generated tree. */
  json: {
    ref: string
    epics: { epic: string; hasSpec: boolean; hasMap: boolean }[]
    tickets: {
      epic: string
      num: number
      slug: string
      title: string
      statusRaw: string
      state: 'open' | 'work' | 'done'
      blockedRaw: string
      blockedNums: number[]
      blockedParsed: boolean
      ref: string
    }[]
  }
  ticketCount: number
}

/** Writes `<root>/.scratch/epic-NN/{spec.md,issues/*.md}`: `tickets` Tickets spread over `epics` Epics. */
export function generateScratch(root: string, epics = 42, tickets = 682): GeneratedScratch {
  const json: GeneratedScratch['json'] = { ref: 'main', epics: [], tickets: [] }
  const states = ['done', 'done', 'open', 'work'] as const
  let left = tickets
  for (let e = 0; e < epics; e += 1) {
    const epic = `epic-${String(e + 1).padStart(2, '0')}`
    const count = Math.ceil(left / (epics - e))
    left -= count
    const dir = join(root, '.scratch', epic)
    mkdirSync(join(dir, 'issues'), { recursive: true })
    writeFileSync(join(dir, 'spec.md'), `# ${epic}: generated Epic\n\n## Волны\n\nnone\n`)
    json.epics.push({ epic, hasSpec: true, hasMap: false })

    for (let n = 1; n <= count; n += 1) {
      const nn = String(n).padStart(2, '0')
      const slug = `generated-ticket-${n}`
      const blockers = n > 2 ? [n - 1, n - 2] : []
      const state = states[n % states.length]!
      const statusRaw = state === 'work' ? 'claimed — 2026-10-05' : state
      const files = [`src/${epic}/module-${n}.ts`, `src/${epic}/shared-${n % 5}.ts`, `test/${epic}/module-${n}.test.ts`]
      const body = [
        `# ${nn} — Generated ticket ${n} of ${epic}`,
        '',
        `Status: ${statusRaw}`,
        `Blocked by: ${blockers.length ? blockers.map((b) => String(b).padStart(2, '0')).join(', ') : '—'}`,
        '',
        '## Что делаем',
        '',
        'Lorem ipsum '.repeat(120),
        '',
        '## Где в коде',
        '',
        ...files.map((file) => `- \`${file}\` — what changes there`),
        '',
        '## Итог',
        '',
        'Lorem ipsum '.repeat(80),
        '',
      ].join('\n')
      writeFileSync(join(dir, 'issues', `${nn}-${slug}.md`), body)
      json.tickets.push({
        epic,
        num: n,
        slug,
        title: `${nn} — Generated ticket ${n} of ${epic}`,
        statusRaw,
        state,
        blockedRaw: blockers.length ? blockers.join(', ') : '—',
        blockedNums: blockers,
        blockedParsed: true,
        ref: 'main',
      })
    }
  }
  return { json, ticketCount: json.tickets.length }
}
