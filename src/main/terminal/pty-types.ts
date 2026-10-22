// The pty of a shell as the Terminal registry (pty.ts) and the start on Windows (windows-pty.ts)
// see it. pty.ts exports these names.
import type { Env } from '../agent/env'

/** The part of node-pty's IPty the registry uses; tests may pass their own. */
export interface PtyProcess {
  readonly pid: number
  onData(listener: (data: string) => void): unknown
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): unknown
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  /** Stops and restarts reading the output (node-pty: its socket); main's screen holds a flood back with it (cursor-answers.ts). */
  pause?(): void
  resume?(): void
}

export type SpawnPty = (file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: Env }) => PtyProcess
