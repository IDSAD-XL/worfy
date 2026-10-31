// "Harness out of date" (worfy-update ticket 05; spec R10): the installed Harness is behind the one
// of this copy. worfy cannot order two Harness versions of one semver from different commits
// (compareHarnessVersions answers `unordered`), and the Stable copy changes its semver rarely, so for
// such a pair GitHub is asked: `compare/<commit of the installed>...<commit of this copy>`, with the
// client of the Update check (src/main/update/github.ts, no sign-in). `ahead` means this copy's
// commit comes after the installed one's: the Harness is behind. A higher semver of this copy
// (`newer`) says the same without a request.
//
// The answer goes into the Update state as `harnessBehind { from, to }`; null when the Harness is not
// behind, or when GitHub did not answer (spec R15: a check skipped is no signal). The check runs only
// while Update is on, first after the start's Harness install of ticket 05 has ended, then with the
// Update checks' hour (CHECK_EVERY_MS), and again after each install of the Harness that answers
// `done` (src/main/index.ts), so a Harness the user brought up to date stops being "out of date" at
// once. An install leaves the Harness of this copy, which needs no request: GitHub is asked about once
// an hour.
import type { HarnessState, HarnessStatus } from '../../shared/ipc/harness'
import { compareHarnessVersions } from '../harness/install'
import { CHECK_EVERY_MS } from './check'
import type { UpdateGitHub } from './github'
import { changeUpdateState, readUpdateState } from './state'

export interface HarnessBehind {
  from: string
  to: string
}

/** The commit of a build version, `abc1234` of `0.3.0+abc1234[.dirty]`. */
const commitOf = (version: string): string | undefined => /\+([0-9a-f]{7,})/u.exec(version)?.[1]

/**
 * Whether the installed Harness is behind the one of this copy, as `state` (HarnessInstaller.status)
 * and, for one semver from two commits, GitHub say. GitHub is asked only for that pair.
 */
export async function harnessLag(state: HarnessState, client: Pick<UpdateGitHub, 'compare'>): Promise<HarnessBehind | null> {
  if (state.kind !== 'outdated' || state.from === null) return null
  const { from, to } = state
  const order = compareHarnessVersions(to, from)
  if (order === 'newer') return { from, to }
  if (order !== 'unordered' || !state.sameVersion) return null
  const base = commitOf(from)
  const head = commitOf(to)
  // One commit, one side `.dirty`: GitHub cannot order them either.
  if (base === undefined || head === undefined || base.startsWith(head) || head.startsWith(base)) return null
  const comparison = await client.compare(base, head)
  if (!comparison.ok) {
    console.warn(`[update] whether the Harness is behind was not checked: ${comparison.reason}`)
    return null
  }
  return comparison.value?.status === 'ahead' ? { from, to } : null
}

export interface HarnessLagOptions {
  /** The state of the installed Harness (the app's installer). */
  status: () => Promise<HarnessStatus>
  client: Pick<UpdateGitHub, 'compare'>
  stateFile: () => string
  /** Hears a change of `harnessBehind`. */
  onChange?: () => void
}

/** The check of the lag and its schedule. Built only while Update is on. */
export class HarnessLagChecks {
  private running: Promise<void> | null = null
  /** The check asked for while one runs: that one may have read the Harness before an install changed it. */
  private next: Promise<void> | null = null

  constructor(private readonly options: HarnessLagOptions) {}

  /**
   * Checks now; while a check runs, once more after it, and every ask meanwhile shares that one.
   * Never rejects.
   */
  run(): Promise<void> {
    if (this.running !== null) {
      this.next ??= this.running.then(() => {
        this.next = null
        return this.run()
      })
      return this.next
    }
    const running = this.check()
      .catch((error: unknown) => console.error('[update] whether the Harness is behind could not be checked', error))
      .finally(() => (this.running = null))
    this.running = running
    return running
  }

  /** Checks once `after` has settled (the Harness install of the start), then every hour; the function returned stops it. */
  start(after: Promise<unknown>): () => void {
    let stopped = false
    let every: ReturnType<typeof setInterval> | undefined
    const begin = (): void => {
      if (stopped) return
      void this.run()
      every = setInterval(() => void this.run(), CHECK_EVERY_MS)
    }
    after.then(begin, begin)
    return () => {
      stopped = true
      if (every !== undefined) clearInterval(every)
    }
  }

  private async check(): Promise<void> {
    const { state } = await this.options.status()
    const behind = await harnessLag(state, this.options.client)
    const file = this.options.stateFile()
    const known = readUpdateState(file).harnessBehind
    if (known?.from === behind?.from && known?.to === behind?.to) return
    changeUpdateState((state) => ({ ...state, harnessBehind: behind }), file)
    this.options.onChange?.()
  }
}
