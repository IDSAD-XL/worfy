// The state of Getting started (worfy-onboarding epic): worfy's own file `getting-started.json` in
// its data folder (ADR-0005), next to `first-run.json`. Ticket 05 keeps the Demo project there
// (`demo`); ticket 06 adds the rest.
//
// The file goes through src/main/storage/json-file.ts: the write is atomic (a temporary file renamed
// over the target). Keys this build does not know are kept on a write, so an older build does not
// drop what a newer one wrote. A `demo` that does not parse reads as none; the other keys stay.
import { join } from 'node:path'
import { z } from 'zod'
import { dataRoot } from '../storage/paths'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

export const GETTING_STARTED_FILE = 'getting-started.json'

/** Which settings the Demo project's Orchestrator runs with (spec, decision 5): Sonnet with effort medium, or Opus. */
export const demoCostSchema = z.enum(['cheaper', 'more-expensive'])
export type DemoCost = z.infer<typeof demoCostSchema>

export const demoRecordSchema = z.object({
  projectId: z.string().min(1),
  /** The demo's repository. */
  path: z.string().min(1),
  /** The name of its Profile in the Harness. */
  profile: z.string().min(1),
  cost: demoCostSchema,
})
export type DemoRecord = z.infer<typeof demoRecordSchema>

const fileSchema = z.looseObject({ demo: z.unknown().optional() })

export class GettingStartedState {
  /** Does no I/O: the file is read on each call. */
  constructor(private readonly dir: string) {}

  get file(): string {
    return join(this.dir, GETTING_STARTED_FILE)
  }

  /** The Demo project this Machine created, or null. */
  demo(): DemoRecord | null {
    const parsed = demoRecordSchema.safeParse(readJsonFile(this.file, fileSchema)?.demo)
    return parsed.success ? parsed.data : null
  }

  /** Sets the Demo project's record (null: none) and keeps the rest of the file. */
  setDemo(record: DemoRecord | null): void {
    const rest: Record<string, unknown> = { ...readJsonFile(this.file, fileSchema) }
    delete rest.demo
    writeJsonFile(this.file, fileSchema, record === null ? rest : { ...rest, demo: demoRecordSchema.parse(record) })
  }
}

let shared: GettingStartedState | undefined

/** The state of the running app, over dataRoot(). */
export function gettingStartedState(): GettingStartedState {
  shared ??= new GettingStartedState(dataRoot())
  return shared
}
