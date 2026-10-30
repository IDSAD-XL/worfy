Added `--json` to `bin/textkit.mjs`: `count` prints `{"count": n}` and `top` prints an array of
`{"word", "count"}` objects in the text order. The option works before or after the file name; the
text output is unchanged. Two new tests in `test/cli.test.mjs` cover it.

`node --test`: 8 of 9 tests pass. The one that fails is `test/corpus.test.mjs` ("count agrees with
the published word count of the reference corpus"): it reads `/srv/textkit/corpus/en-sample.txt`,
which is not on this machine, so it fails with ENOENT before and after my change. It needs the build
server; I left it as it is.
