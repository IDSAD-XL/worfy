// Stub: replaced by the parser in the next commit of this ticket.
export interface ShellAction { program: string; args: string[]; cwd: string; writes: string[]; deletes: string[]; reads: string[]; network: boolean; stdinFrom: number | null }
export type Analysis = { judged: true; actions: ShellAction[] } | { judged: false; why: string }
export interface AnalyzeContext { cwd: string; env: Readonly<Record<string, string | undefined>>; platform: NodeJS.Platform }
export function analyze(command: string, context: AnalyzeContext): Analysis {
  return { judged: true, actions: [{ program: command.split(' ')[0] ?? '', args: [], cwd: context.cwd, writes: [], deletes: [], reads: [], network: false, stdinFrom: null }] }
}
