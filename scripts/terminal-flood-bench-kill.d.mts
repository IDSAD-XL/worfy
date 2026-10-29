// Types of scripts/terminal-flood-bench-kill.mjs for its unit test.
export declare function isShellPid(pid: unknown): pid is number
export declare function killShells(pids: Iterable<unknown>, kill?: (pid: number, signal: string) => void): void
