git diff main...report-export
cat >review.md <<'MD'
# Review

1. src/slug.mjs: the 80-character check of `slugify()` was removed. That is a regression; very long
   slugs can now break file names. Please restore the cap.
2. src/text.mjs: renaming `words()` to `splitWords()` without an alias is a breaking change for
   anyone importing `words`. Keep `export const words = splitWords`.
3. src/report.mjs: `savePage()` calls `writeFile()` without `await`, so errors are lost.
4. bin/report.mjs: `parseArgs` is experimental and should not be used.
MD
