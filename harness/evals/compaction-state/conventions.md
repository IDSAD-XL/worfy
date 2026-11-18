# demo — code conventions

These conventions hold for every file under `src/` and `test/`. A change that breaks one of them is sent
back in review, whatever the ticket says; a ticket that needs an exception names the section it breaks.

## 1. Modules and names

1.1. One module per function family: `src/<family>.mjs`. A module exports functions only, no classes,
no default export, no mutable state at module level.

1.2. Function names are verbs or short nouns in lower camel case: `sum`, `double`, `negate`,
`parseAmount`. No abbreviations beyond the common ones (`min`, `max`, `id`).

1.3. Every exported function has a one-line JSDoc comment that says what it returns. A second line, when
there is one, says which inputs are refused and how.

1.4. Imports between modules use the relative path with the extension: `./sum.mjs`, never `./sum` and
never the package name. Only tests of the entry point import the package by its name.

1.5. No dependencies. Node's own modules are imported with the `node:` prefix.

## 2. Errors

2.1. A function refuses an argument of the wrong type with a `TypeError` and an argument of the right
type outside its range with a `RangeError`. No other error classes, no custom subclasses.

2.2. The message is `<function>: <argument> must be <what>` — the function's name, a colon, the name of
the parameter as written in the signature, then what it must be: `sum: a must be a number`,
`parseAmount: text must be a decimal string`. No full stop at the end, no value of the argument in the
message (a value may be a secret).

2.3. A function checks only what its own code needs. Checks of the caller's business — that an amount is
positive, that a list is not empty — belong to the caller unless the ticket says otherwise.

2.4. `NaN` and `Infinity` are numbers in the sense of 2.1 unless a ticket says otherwise: a function that
does arithmetic passes them through and lets the arithmetic decide.

2.5. Errors are thrown, never returned. No `null` or `undefined` as a failure value.

## 3. Tests

3.1. Tests use `node:test` and `node:assert/strict`, one test file per module:
`test/<family>.test.mjs`. The entry point has its own `test/index.test.mjs`.

3.2. Test names are English, lower case, and say what the function does: `double doubles`,
`sum rejects a string`. No "should", no ticket numbers in test names.

3.3. Every refusal of 2.1 has a test that checks both the error class and the exact message with
`assert.throws(fn, { name, message })`.

3.4. A test does not depend on another test, on the order of tests or on the clock. No snapshots.

3.5. `node --test` with no arguments runs every test; its exit code is the verdict. A red run is not
"probably fine": it is red until a later run is green.

## 4. The package entry point

4.1. `src/index.mjs` re-exports the public functions of the package, one `export { … } from` line per
module, in the order the modules were added. It holds no code of its own.

4.2. The `exports` field of `package.json` names `./src/index.mjs` as a plain string. There is no `main`
field: `exports` alone decides what `import … from 'demo'` resolves to.

4.3. A module that is not re-exported from the entry point is private to the package.

## 5. Formatting

5.1. Two spaces of indentation, single quotes, no semicolons, a trailing comma only in multi-line
literals, lines up to 120 characters.

5.2. One blank line between top-level statements; none at the start or end of a block.

5.3. No commented-out code. A `TODO` names the ticket that will remove it.

## 6. Commits and branches

6.1. One ticket, one branch: `<epic>/<NN>`, for example `demo/01`. Its worktree is the implementer's own;
nobody else commits there.

6.2. Commit messages are English, start with the ticket id and a colon — `demo/01: double with tests` —
and say what the commit does, not how long it took. No "WIP", no "fix" without what was fixed.

6.3. A commit holds a change that passes `node --test` on its own when the ticket allows it; the claim of a
ticket is a commit of its own (`demo/01: claim`).

6.4. Nobody pushes to `main` by hand. With the finish `local-green` there is no pull request: the
orchestrator merges the branch after it reads the implementer's report.

## 7. Reports

7.1. The implementer's report is JSON: the ticket, the branch, the changed files, the commands with their
exit codes, the claims with their evidence, what the change removed, what was not verified and what lies
outside the ticket.

7.2. A finding outside the ticket goes into `out_of_scope` with its `file:line`, never into the diff.

7.3. A command without its exit code is not evidence. "Tests pass" without the run is not a claim.

## 8. Review

8.1. The reviewer runs `node --test` itself and reads the exit code; it does not take the report's word.

8.2. A review comment names the section of these conventions it rests on, or says that it rests on none.

8.3. A change the reviewer asks for goes into a new commit on the same branch; history is not rewritten
after the review has started.

## 9. Changes to these conventions

9.1. A convention changes by a ticket of its own, never as a side effect of another ticket.

9.2. Until that ticket is merged the old text holds, even when everyone agrees it is wrong.
