# implementer, step 5: the gate's exit codes

Gate exit codes: `2` — red, fix it. `3` — not verified (neither green nor red): the line
`[gate] not verified: …` names the reason (project not registered,
registry unreadable, resolver crashed); put it into `not_verified` with code 3 and do
not call the work green. `127` — node is not on PATH and the gate never started: put it into
`not_verified` with that code. 128 + the signal number — `129`, `130`, `143`, `149` (SIGHUP,
SIGINT, SIGTERM, Ctrl+Break of Windows) — the gate itself was stopped:
this run wrote nothing, the work is not verified; put it into `not_verified` with that code,
never green. A signal in the gate's first tens of milliseconds, or while it waits up to 2 s on
an open stdin that sends nothing, may leave the verdict of an earlier run in place.
`0` is green only if the output has `[gate] green (…)`; `0`
with the line `[gate] nothing ran (…)` or `[gate] not verified — environment unavailable:`
also goes into `not_verified`.
