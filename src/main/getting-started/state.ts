// The state of Getting started (worfy-onboarding epic): worfy's own file `getting-started.json` in
// its data folder (ADR-0005), next to `first-run.json`. Ticket 05 keeps the Demo project there
// (`demo`); ticket 06 adds whether the user was new or existing, whether the section shows, the
// steps marked with their times, whether a rework round was seen and whether the notice was shown.
//
// The file goes through src/main/storage/json-file.ts: the write is atomic (a temporary file renamed
// over the target), and a file that does not read is set aside and the state starts empty. Keys
// this build does not know are kept on a write, so an older build does not drop what a newer one
// wrote. A field that does not parse reads as its empty value; the other keys stay.
//
// Several sources write here — the First run report, the Sessions' events, the Stages of the demo,
// the demo's creation, the window. Each write is one synchronous read-modify-write of the file and
// nothing is kept in memory between calls, so two writes can neither interleave nor drop each
// other's mark, whichever instance over the folder makes them.
import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import {
  demoRecordSchema,
  gettingStartedSectionSchema,
  gettingStartedStepSchema,
  gettingStartedUserSchema,
  type DemoRecord,
  type GettingStartedSection,
  type GettingStartedSnapshot,
  type GettingStartedStep,
} from '../../shared/ipc/getting-started'
import { projectStore } from '../projects/store'
import { dataRoot } from '../storage/paths'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

export { demoCostSchema, demoRecordSchema, type DemoCost, type DemoRecord } from '../../shared/ipc/getting-started'

export const GETTING_STARTED_FILE = 'getting-started.json'

const fileSchema = z.looseObject({
  demo: z.unknown().optional(),
  user: z.unknown().optional(),
  section: z.unknown().optional(),
  steps: z.unknown().optional(),
  reworkSeen: z.unknown().optional(),
  noticeShown: z.unknown().optional(),
})
type StateFile = z.output<typeof fileSchema>

const isoTime = z.iso.datetime()

/** The steps of the file that read: a key 1–6 with an ISO time. Others are left out. */
function stepsOf(value: unknown): GettingStartedSnapshot['steps'] {
  const steps: GettingStartedSnapshot['steps'] = {}
  if (typeof value !== 'object' || value === null) return steps
  for (const [key, at] of Object.entries(value)) {
    const step = gettingStartedStepSchema.safeParse(key)
    if (step.success && isoTime.safeParse(at).success) steps[step.data] = at as string
  }
  return steps
}

export interface GettingStartedStateOptions {
  /**
   * The Project list, read once: at the first write with no `user` recorded (decision 7). The app's
   * state reads the app's list; without it the list is empty.
   */
  projects?: () => readonly { readonly id: string }[]
  /**
   * Whether a Project list that did not read was set aside (`projects.json.unreadable-*`): the list
   * reads empty then, but the user had Projects, so they count as existing. Asked after `projects`,
   * whose first read is what sets the file aside.
   */
  lostProjects?: () => boolean
  /** False: the section does not show by itself (WORFY_GETTING_STARTED_AUTO=0, the e2e tests). */
  auto?: () => boolean
  /** Clock for the times of the steps; tests pass a fixed one. */
  now?: () => Date
}

export class GettingStartedState {
  private readonly listeners = new Set<() => void>()

  /** Does no I/O: the file is read on each call. */
  constructor(
    private readonly dir: string,
    private readonly options: GettingStartedStateOptions = {},
  ) {}

  get file(): string {
    return join(this.dir, GETTING_STARTED_FILE)
  }

  /**
   * The state now. With no `user` in the file — no file, or one written before this was decided —
   * this read decides it and writes it (decision 7): a Project in the list besides the demo means an
   * existing user, the section hidden; none, a new user, the section shown. A list that did not read
   * and was set aside counts as Projects: an existing user is never made to go through Getting
   * started. It is not decided again.
   */
  read(): GettingStartedSnapshot {
    return this.snapshotOf(this.update((file) => file))
  }

  /** The Demo project this Machine created, or null. Writes nothing. */
  demo(): DemoRecord | null {
    return this.demoOf(readJsonFile(this.file, fileSchema))
  }

  /** Sets the Demo project's record (null: none) and keeps the rest of the file. */
  setDemo(record: DemoRecord | null): void {
    // Nothing to drop: no file is written, so a rolled-back creation leaves none behind.
    if (record === null && readJsonFile(this.file, fileSchema)?.demo === undefined) return
    this.update((file) => {
      const rest: StateFile = { ...file }
      delete rest.demo
      return record === null ? rest : { ...rest, demo: demoRecordSchema.parse(record) }
    })
  }

  /** Marks `step` now; a step already marked keeps its time. True when this call marked it. */
  markStep(step: GettingStartedStep): boolean {
    let marked = false
    this.update((file) => {
      const steps = stepsOf(file.steps)
      if (steps[step] !== undefined) return file
      marked = true
      return { ...file, steps: { ...steps, [step]: (this.options.now?.() ?? new Date()).toISOString() } }
    })
    return marked
  }

  /** Records that the demo Ticket was seen in a rework round. True when this call recorded it. */
  markReworkSeen(): boolean {
    let marked = false
    this.update((file) => {
      if (file.reworkSeen === true) return file
      marked = true
      return { ...file, reworkSeen: true }
    })
    return marked
  }

  setSection(section: GettingStartedSection): GettingStartedSnapshot {
    return this.snapshotOf(this.update((file) => ({ ...file, section })))
  }

  /** The notice for an existing user was shown (ticket 08). */
  noticeSeen(): GettingStartedSnapshot {
    return this.snapshotOf(this.update((file) => ({ ...file, noticeShown: true })))
  }

  /**
   * Calls `listener` after every write of this instance that changed the file. It gets no state:
   * a listener that writes in turn runs before the listeners after it, so each reads the file
   * itself (read()) and none sends an older state after a newer one.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Reads the file, applies `change`, decides `user` and the section when the file has none, and
   * writes the result when it differs from what was read; then tells the listeners. Synchronous
   * from the read to the write, so no other write of this process comes between them.
   */
  private update(change: (file: StateFile) => StateFile): StateFile {
    const read = readJsonFile(this.file, fileSchema)
    const next = this.decided(change({ ...read }))
    if (read !== undefined && JSON.stringify(next) === JSON.stringify(read)) return next
    writeJsonFile(this.file, fileSchema, next)
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[getting-started] a change listener threw', error)
      }
    }
    return next
  }

  /** `file` with `user` and `section` that read; the ones missing are decided now (decision 7). */
  private decided(file: StateFile): StateFile {
    let user = gettingStartedUserSchema.safeParse(file.user).data
    if (user === undefined) {
      const demoId = this.demoOf(file)?.projectId
      const others = (this.options.projects?.() ?? []).filter((project) => project.id !== demoId)
      user = others.length > 0 || this.options.lostProjects?.() === true ? 'existing' : 'new'
    }
    let section = gettingStartedSectionSchema.safeParse(file.section).data
    section ??= user === 'new' && (this.options.auto?.() ?? true) ? 'shown' : 'hidden'
    return { ...file, user, section }
  }

  private demoOf(file: StateFile | undefined): DemoRecord | null {
    const parsed = demoRecordSchema.safeParse(file?.demo)
    return parsed.success ? parsed.data : null
  }

  private snapshotOf(file: StateFile): GettingStartedSnapshot {
    const decided = this.decided(file)
    return {
      user: gettingStartedUserSchema.parse(decided.user),
      section: gettingStartedSectionSchema.parse(decided.section),
      steps: stepsOf(file.steps),
      reworkSeen: file.reworkSeen === true,
      noticeShown: file.noticeShown === true || !(this.options.auto?.() ?? true),
      demo: this.demoOf(file),
    }
  }
}

/** Whether `dir` holds a set-aside copy of `name` (src/main/storage/json-file.ts names it `<name>.unreadable-<time>`). */
function setAsideIn(dir: string, name: string): boolean {
  try {
    return readdirSync(dir).some((entry) => entry.startsWith(`${name}.unreadable-`))
  } catch {
    // No data folder yet: nothing was set aside.
    return false
  }
}

let shared: GettingStartedState | undefined

/**
 * The state of the running app, over dataRoot() and the app's Project list. The section shows by
 * itself unless WORFY_GETTING_STARTED_AUTO is `0` (the e2e tests, test/e2e/launch-env.ts).
 */
export function gettingStartedState(): GettingStartedState {
  shared ??= new GettingStartedState(dataRoot(), {
    projects: () => projectStore().list(),
    lostProjects: () => setAsideIn(dataRoot(), basename(projectStore().file)),
    auto: () => process.env.WORFY_GETTING_STARTED_AUTO !== '0',
  })
  return shared
}
