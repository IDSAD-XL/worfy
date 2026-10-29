# ship-ticket, step 6: the gate's exit codes

On an open stdin that sends nothing it waits 2 s before it starts, and a signal in those
2 s may leave the verdict of an earlier run in place (the bash gate before it waited on `cat`
forever: a ticket once stood like that for ten hours).
Gate exit codes: `0` — green, only if the output has the line `[gate] green (…)` (exit code 0
with `[gate] nothing ran (…)` or `[gate] not verified — environment unavailable:` is not a
check); `2` — red, fix it; `3` — not verified, neither green nor red: the
line `[gate] not verified: …` names the reason (project not registered, registry
unreadable, resolver crashed); `127` — node is not on PATH and the gate never started; 128 + the
signal number — `129`, `130`, `143`, `149` (SIGHUP, SIGINT, SIGTERM, Ctrl+Break of Windows) — the
gate itself was stopped and this run wrote nothing. On exit code 3, 127, 129, 130, 143 or 149 do
not merge and do not call the ticket done: the work is not verified, the code
goes into the report as "not verified", and on 3 or 127 a human fixes the environment.
