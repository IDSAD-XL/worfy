git log --format='%h %s%n%n%b' main..report-export
git diff main...report-export
cat >review.md <<'MD'
# Review of report-export

Not ready to merge: three bugs in src/report.mjs, the rest is fine.

## Bugs

1. **pageCount() is wrong at exact multiples** (src/report.mjs, `pageCount`). `Math.floor(count / pageSize) + 1`
   gives 3 pages for 40 rows of 20, so `exportReport()` writes an empty third page. Use
   `Math.max(1, Math.ceil(count / pageSize))`; add a test for 40 rows.
2. **savePage() does not await writeFile()** (src/report.mjs, `savePage`). The promise is dropped:
   a failed write (missing folder, no permission) becomes an unhandled rejection, and
   `exportReport()` returns paths before the files exist. Make `savePage` async and await it.
3. **Template name from the request is used as a path** (src/report.mjs, `loadTemplate`). The
   service passes the user's `template` field straight into `join(TEMPLATES, name + '.txt')`;
   `../../config/secrets` reads any `.txt` file outside `templates/`. Allow only names that match
   `/^[a-z0-9-]+$/` or check the resolved path stays inside `templates/`.

## Smaller points

- `pageSize` of 0 or less is not checked.
- No tests for `savePage()`, `exportReport()` or bin/report.mjs.

## Checked and fine

- Rename to `splitWords()`: every caller, test and the README are updated; no alias is needed in a
  private package.
- Dropping the 80-character cap of `slugify()`: explained in the commit, default stays 40.
MD
