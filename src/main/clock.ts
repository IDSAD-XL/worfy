// main's clock for the rules that compare a stored time with now: the automatic archive and the
// Layout's touchedAt (ADR-0076), the Limits (Claude's and the Codex poll's), and the Run history.
// Each of them reads appNow() when it is given no clock of its own.
//
// It is the machine's clock, except in a dev run (the unpacked bundle the e2e tests start; app.isPackaged
// false) started with WORFY_NOW, an ISO date: then it starts at that moment and runs on from there with
// the machine's clock. An e2e test pins with it the date its fixture's times are counted from, so the
// test does not change from one day to the next (worfy-polish ticket 121); the window's clock is set
// apart, by Playwright's clock. A packaged worfy.app ignores the variable. The rest of main keeps the
// machine's clock (Date.now): a timer, a timeout or a time written for the user is not a rule of this kind.

/** The machine's clock, read at each call, so vitest's fake timers reach it too. */
const machine = (): number => Date.now()

/**
 * The clock that starts at `given` (an ISO date) and runs on with `real`; `real` itself when nothing is
 * given. A value that is not a date throws: an e2e run that named a wrong one must not pass on today's date.
 */
export function clockFrom(given: string | undefined, real: () => number = machine): () => number {
  if (given === undefined || given === '') return real
  const start = Date.parse(given)
  if (Number.isNaN(start)) throw new Error(`WORFY_NOW is not a date: ${JSON.stringify(given)}. Give an ISO date such as 2026-06-15T09:00:00.000Z, or unset it.`)
  const offset = start - real()
  return () => real() + offset
}

/** main's clock for this run: WORFY_NOW counts in a dev run only. */
export function mainClock({ packaged, env }: { packaged: boolean; env: NodeJS.ProcessEnv }): () => number {
  return clockFrom(packaged ? undefined : env.WORFY_NOW)
}

let current: () => number = machine

/** Called once by src/main/index.ts with mainClock(), before anything reads appNow(). */
export function setAppClock(clock: () => number): void {
  current = clock
}

/** Now, in ms, by main's clock. */
export function appNow(): number {
  return current()
}
