Review written to review.md. Not ready to merge: `pageCount()` adds an empty page when the rows are an
exact multiple of the page size, `savePage()` drops the `writeFile()` promise, and `loadTemplate()`
takes the request's template name as a path without a check. The rename and the removed slug cap are
fine. I did not merge anything.
