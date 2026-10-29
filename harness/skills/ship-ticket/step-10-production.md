# ship-ticket, step 10: Check production

Only with `pr-green-ci` and if `F deploy` exists; absent or `null` — "step 10 skipped: the project
does not deploy".

How it deploys — `F deploy.how`. Access to the stand — `F deploy.auth`, the environment variables
needed — `F deploy.env`. The block below runs whole, together with the `sha=` line: shell state does
not persist between calls. Repeat it until the CI run is `completed`:

```bash
sha=$(gh pr view <N> --json mergeCommit --jq .mergeCommit.oid)
<F deploy.ci_run_check>                                          # uses $sha; wait for completed, success
got=$(<F deploy.production_check>); echo "EXIT=$? commit=$got sha=$sha"
```

The expectation is `F deploy.production_expect`: a non-zero `EXIT`, an empty `commit`, or a
`commit` not equal to `$sha` — production is "not verified". Then repeat the smoke tests: where
they are and how to repeat them without running what is forbidden locally — `F deploy.smoke`. The
stand's password never goes into command arguments (it is visible in the process list) — only the
way `F deploy.production_check` passes it. Without an answer from the live address the deploy does
not count as verified.
