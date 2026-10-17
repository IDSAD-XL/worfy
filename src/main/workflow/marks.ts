// The agents' marks of a Ticket (ADR-0067, item 2): `review` and `check/<name>`, each bound to a
// commit SHA. One interface, two stores by the Project's mode, both only read here:
// - Full mode — the commit statuses of the PR's head commit, from the `statusCheckRollup` the PR
//   tracker already reads (src/main/github/prs.ts): the context is the kind, the state the verdict.
//   GitHub keeps the newest status per context, and the rollup is of the head commit only, so every
//   such mark is on the head SHA. `skipped` is written there as `success` with the description
//   `skipped`; the rollup carries no description, so it reads as `success` — the Stage passes either way.
// - Silent mode — `<Harness home>/runs/<project>/marks/<epic>-<NN>.json`, the file `bin/ticket mark`
//   appends to: `{epic, num, marks: [{kind, verdict, sha, at}]}`. A missing file is no marks; a broken
//   one is no marks too, and the reason goes to the log once until it changes. Nothing is written.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { markVerdictSchema, type MarkFact } from '../../shared/workflow/pipeline'
import type { MarkStatus } from '../github/prs'

/** The kinds of marks a Stage reads; `deploy` is a deploy script's status, read by src/main/github/deployments.ts. */
const AGENT_KIND = /^(review|check\/[a-z0-9][a-z0-9-]*)$/u

const VERDICT_OF_STATE: Record<string, MarkFact['verdict']> = { SUCCESS: 'success', FAILURE: 'failure', ERROR: 'failure', PENDING: 'pending', EXPECTED: 'pending' }

/** Full mode: the agents' marks among the head commit's statuses, as marks on `headSha`. */
export function marksFromStatuses(statuses: readonly MarkStatus[], headSha: string | null): MarkFact[] {
  if (headSha === null) return []
  return statuses.flatMap((status) => {
    const verdict = VERDICT_OF_STATE[status.state]
    return AGENT_KIND.test(status.context) && verdict !== undefined ? [{ kind: status.context, verdict, sha: headSha, at: status.at }] : []
  })
}

const markFileSchema = z.object({
  marks: z.array(
    z.object({
      kind: z.string().regex(AGENT_KIND),
      verdict: markVerdictSchema,
      sha: z.string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/u),
      at: z.string().nullish(),
    }),
  ),
})

/** The file `bin/ticket mark` keeps a Ticket's marks in, in Silent mode: the number as the Ticket file has it, two digits at least. */
export const markFilePath = (harnessHome: string, project: string, epic: string, num: number): string =>
  join(harnessHome, 'runs', project, 'marks', `${epic}-${String(num).padStart(2, '0')}.json`)

export interface SilentMarksOptions {
  harnessHome: string
  /** The Profile's name, `_resolved.name`. */
  project: string
  /** Where the reason a file is broken goes; console.warn by default. */
  log?: ((message: string) => void) | undefined
}

/** Reads the Silent mode marks files; remembers which broken file it has already logged. */
export class SilentMarks {
  private readonly logged = new Map<string, string>()

  constructor(private readonly options: SilentMarksOptions) {}

  /** The marks of one Ticket, oldest first. */
  async read(epic: string, num: number): Promise<MarkFact[]> {
    const file = markFilePath(this.options.harnessHome, this.options.project, epic, num)
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logged.delete(file)
        return []
      }
      return this.broken(file, `it cannot be read: ${(error as Error).message}`)
    }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch (error) {
      return this.broken(file, `it is not JSON: ${(error as Error).message}`)
    }
    const parsed = markFileSchema.safeParse(json)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return this.broken(file, `it is not a marks file: ${issue ? `${issue.path.join('.') || '(the whole file)'}: ${issue.message}` : ''}`)
    }
    this.logged.delete(file)
    return parsed.data.marks.map((mark) => ({ kind: mark.kind, verdict: mark.verdict, sha: mark.sha, at: mark.at ?? null }))
  }

  private broken(file: string, reason: string): MarkFact[] {
    if (this.logged.get(file) !== reason) {
      this.logged.set(file, reason)
      ;(this.options.log ?? ((message: string) => console.warn(message)))(`[pipeline] the marks of ${file} are not read, ${reason}; the Ticket counts as having no marks`)
    }
    return []
  }
}
