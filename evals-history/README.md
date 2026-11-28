# Records of full eval runs

Each full run of `pnpm eval:harness` (no `--case`, `--tag` or `--changed`) writes two files here:
`<time>-<commit>.json`, the record, and `<time>-<commit>.md`, its summary for a person. The format and
the comparison with earlier records are described in `harness/README.md`, section "Evals", and in
`scripts/eval-history.mjs`. Commit both files with the change the run measured.

The folder lies outside `harness/evals/`: there every folder with a `prompt.md` is a case, and a change
there would choose the paid `--changed` run.
