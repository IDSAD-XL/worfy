// The question "which Autopilot runs go on with you?" between Linked machines (worfy-link ticket 15,
// ADR-0053, Q13): before a start, Autopilot (src/main/autopilot/run.ts) asks every Linked machine
// for the Epic and origin key of its runs, and refuses the start when one of them runs the same.
//
// Two service messages of the link (messages.ts), not IPC channels: `autopilot-runs-ask` with an id,
// and `autopilot-runs` with the same id and the runs. They go whether or not "Linked machines can
// work with my Projects" is on, on either side: the answer opens no Project and carries only the
// Epic and the origin key of each run (decided without the owner, question 2 of the ticket); the
// asking side takes the Machine's name from its own list of Linked machines.
//
// A Linked machine that is not connected, or does not answer within ASK_RUNS_TIMEOUT_MS, counts as
// not asked: it does not block the start (question 1), and the start names it. An answer is taken
// only from the Machine it was asked of, and only once.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { LinkedRuns, RunKey } from '../autopilot/run'
import { defineLinkMessage, type LinkMessage, type MessageHandler } from './messages'

/** How long a start waits for a Linked machine's answer. */
export const ASK_RUNS_TIMEOUT_MS = 3000

const id = z.string().min(1).max(100)
const runKeySchema = z.object({ epic: z.string().min(1).max(200), origin: z.string().min(1).max(2000) })

/** "Which Autopilot runs go on with you?" */
export const autopilotRunsAsk = defineLinkMessage('autopilot-runs-ask', z.object({ id }))

/** The answer: the Epic and origin key of every run and start under way (Autopilot.runKeys). */
export const autopilotRunsAnswer = defineLinkMessage('autopilot-runs', z.object({ id, runs: z.array(runKeySchema).max(1000) }))

/** The part of the link service (service.ts, LinkService) the question uses. */
export interface RunsLinkService {
  registerMessage<S extends z.ZodType>(message: LinkMessage<S>, handle: MessageHandler<S>): void
  sendMessage<S extends z.ZodType>(machineId: string, message: LinkMessage<S>, payload: z.input<S>): void
  linkedMachines(): readonly { id: string; name: string }[]
}

export interface AutopilotRunsOptions {
  /** How long to wait for an answer (default ASK_RUNS_TIMEOUT_MS). */
  timeoutMs?: number
  warn?: (message: string) => void
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Answers the Linked machines' questions with `local()`, and asks them. */
export class AutopilotRunsLink {
  private readonly pending = new Map<string, { machineId: string; done: (runs: RunKey[]) => void }>()
  private readonly timeoutMs: number
  private readonly warn: (message: string) => void

  /** Registers both messages on `service`: once per service. */
  constructor(
    private readonly service: RunsLinkService,
    local: () => readonly RunKey[],
    options: AutopilotRunsOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? ASK_RUNS_TIMEOUT_MS
    this.warn = options.warn ?? ((message) => console.warn(message))
    service.registerMessage(autopilotRunsAsk, ({ id: question }, from) => {
      try {
        service.sendMessage(from.machineId, autopilotRunsAnswer, { id: question, runs: local().map(({ epic, origin }) => ({ epic, origin })) })
      } catch (error) {
        this.warn(`[link] could not tell Machine ${from.machineId} the Autopilot runs: ${messageOf(error)}`)
      }
    })
    service.registerMessage(autopilotRunsAnswer, ({ id: question, runs }, from) => {
      const waiting = this.pending.get(question)
      // Only the Machine asked answers its question.
      if (waiting === undefined || waiting.machineId !== from.machineId) return
      this.pending.delete(question)
      waiting.done(runs)
    })
  }

  /** Asks every Linked machine at once; each answer is its runs, or null when it could not be asked. */
  ask(): Promise<LinkedRuns[]> {
    return Promise.all(this.service.linkedMachines().map((machine) => this.askOne(machine)))
  }

  private askOne(machine: { id: string; name: string }): Promise<LinkedRuns> {
    const unasked: LinkedRuns = { machine: machine.name, runs: null }
    const question = randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(question)
        resolve(unasked)
      }, this.timeoutMs)
      this.pending.set(question, {
        machineId: machine.id,
        done: (runs) => {
          clearTimeout(timer)
          resolve({ machine: machine.name, runs })
        },
      })
      try {
        this.service.sendMessage(machine.id, autopilotRunsAsk, { id: question })
      } catch {
        // Not connected (sendMessage throws then): not asked, at once.
        clearTimeout(timer)
        this.pending.delete(question)
        resolve(unasked)
      }
    })
  }
}
