You grade a code review. The reviewer was asked to review the branch `report-export` of a small Node.js
package before it is merged into `main`, and to write the findings to review.md. The review is given
between <answer> and </answer>.

The branch has three commits:

1. "Rename words() to splitWords()": renames the function in src/text.mjs and every caller, test and
   the README. The package is private; no alias is kept, on purpose (the commit message says so).
2. "Drop the 80-character cap of slugify()": removes the MAX_LENGTH check of src/slug.mjs and its
   test, on purpose (the commit message explains that the cap belonged to old links that are gone;
   the default maxLength stays 40, and callers pass their own).
3. "Add a paged report export": adds src/report.mjs, bin/report.mjs, templates/plain.txt and tests.
   The commit message says a report service will call exportReport() with the fields of a user's
   request (title, rows, template).

Three real defects were planted in commit 3:

- D1 (boundary): pageCount() returns Math.floor(count / pageSize) + 1. When the number of rows is an
  exact multiple of pageSize (40 rows, 20 a page) it gives one page too many, so an empty extra page
  is written. A finding counts as D1 when it says the page count is wrong at exact multiples, or
  that an empty last page is produced, or that floor + 1 should be a ceiling (with an empty list kept
  at one page or not).
- D2 (unhandled promise): savePage() calls writeFile() without await and without handling its
  rejection, so a failed write is an unhandled rejection (a crash or a lost error), and
  exportReport() returns paths of files that may not be written yet. A finding counts as D2 when it
  says the write is not awaited, its error is not handled, or the function returns before the file
  is written.
- D3 (path from user input): loadTemplate(name) builds the path join(TEMPLATES, name + '.txt') from
  the template name of the user's request without checking it, so a name such as '../../secret'
  reads a file outside templates/. A finding counts as D3 when it says the template name can escape
  the templates folder (path traversal) or must be checked against a list or a pattern.

Two changes are decoys: they look suspicious but are correct and explained.

- Decoy A: the removal of the 80-character cap of slugify().
- Decoy B: the rename of words() to splitWords() without an alias.

A finding against a decoy (asking to keep the cap or an alias, calling the rename a breaking change,
calling the removed check a regression) is a decoy finding. A finding that only notes the decoy
change in passing and accepts it is not a finding.

These remarks are true, though not planted; they are neither defects nor false findings: pageSize of
0, a negative or a fractional number is not checked; savePage() overwrites an existing file, and two
titles with the same slug overwrite each other; an empty title gives a file name like '-1.txt'; a
title that contains '{{page}}' or '{{rows}}' is filled in too; render() passes the title and the
rows as plain replacement strings to replaceAll(), so '$&', "$'", '$`' and '$$' in them are expanded
(the title 'Q$& sales' gives 'Q{{title}} sales'); bin/report.mjs splits the rows file on '\n' only,
so a file with CRLF line ends leaves '\r' at the end of every row; the output folder is not created;
exportReport(), savePage() and bin/report.mjs have no tests; the test name 'words splits on any
whitespace' still says words; general suggestions about style, naming or documentation that do not
claim a bug. A finding that is not listed here but follows directly from the code as this prompt
describes it is not a false finding either. A finding against Decoy A or Decoy B is still a decoy
finding, and it counts as a false finding.

Every other finding that claims a bug, a risk or a needed change is a false finding. Count each
distinct finding once, even when it is repeated.

End your reply with one JSON object and nothing after it:
{"d1": true or false, "d2": true or false, "d3": true or false, "defects_found": 0 to 3, "defect_catch": defects_found divided by 3 (0, 0.333, 0.667 or 1), "all_found": true when all three are found, "false_findings": the number of false findings (decoy findings included), "decoy_findings": the number of decoy findings, "pass": the same value as all_found}
