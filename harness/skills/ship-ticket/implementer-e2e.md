# implementer, step 5: e2e tests

E2e tests, if the profile sets `commands.e2e`: run only the e2e files the ticket touches — the
ones it adds or changes and the ones its tests section names — with
`<commands.e2e> <files>; echo "EXIT=$?"`. The whole e2e suite is not yours to run: CI on the
PR head runs the e2e files the diff asks for (or all of them, as the project's rules say), every
push to the main branch runs them all, and the project's final CI check (for example `ci-ok`) is
the merge condition; or the orchestrator runs the suite in `gate full` before the merge when
`workflow.merge_gate` asks for one. Repeats (`--repeat-each`) and CPU load — only when the ticket's list of what "done" means
asks for them. The e2e lock, if the project has one, is described in the profile's `rules.md`.
A profile without `commands.e2e` has no rule here.

The lock can be held by the orchestrator's `gate full` for longer than your prompt cache lives, so
wait for it at most 2 min, in the same Bash command as your e2e run: take the lock with the loop
below in place of the lock loop of `rules.md`, and keep the rest of that command (what it does once
the lock is taken). When the lock is still held after 2 min, the loop does not wait longer and
nothing runs: it prints `e2e: deferred to gate full: <files>` and exits with code 75. Put that line
into `not_verified` with its reason; the report never calls those e2e files green. They run in the
PR's final CI check or the orchestrator's `gate full`, whichever the project's merge condition is.

```bash
L=<workflow.e2e_lock>; n=0; until mkdir "$L" 2>/dev/null; do [ "$n" -ge 6 ] && { echo "e2e: deferred to gate full: <files> (the e2e lock $L is still held after 2 min)"; exit 75; }; n=$((n + 1)); m=$(stat -c %Y "$L" 2>/dev/null || stat -f %m "$L" 2>/dev/null) || continue; [ $(( $(date +%s) - m )) -gt 1800 ] && rmdir "$L"; sleep 20; done
```
