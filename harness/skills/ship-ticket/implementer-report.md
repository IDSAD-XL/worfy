# implementer: the fields of the report

`pr` is the PR number. Fields the project does not have (`pr` with `local-green`, `worktree` with
`single`) are `null`, not omitted.
`not_verified` — only real gaps: what is not verified and why; the first line is a false premise of
the brief, if there was one. Things noticed outside the ticket do not go there — they go to
`out_of_scope` (empty — `[]`).
`sign_in_needed` — the Browser checks that did not run for want of a sign-in, one entry per role or
profile in exactly one of the two forms above (section Order, "Browser checks"); `[]` when every
check ran or the ticket has none. The orchestrator copies each entry into the wave report.
Which tests now cover the change — separate claims in `claims`, with the path to the test.
Every claim in `claims` will be re-checked by a separate agent: a claim without evidence is
rejected, and the ticket comes back for rework.

**`removed` is not a formality but the most valuable field of the report.** Reports tend to be right
about what was added and silent about what disappeared: that is how a refusal notice on five
screens and a whole ADR rule were lost, and both times the review found it, not the report. Before
writing the report, ask yourself what, on the surfaces you touched, stopped working the way it
worked yesterday — and write it down, even if you consider the loss justified. An empty `removed` is
acceptable only when you have checked it.
