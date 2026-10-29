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
