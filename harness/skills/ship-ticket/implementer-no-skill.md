# implementer: steps 1–4 when the profile names no skill

Without a skill, steps 1–4 are:
1. A fresh base (`worktree.base` or the main branch of the repository).
2. Numbers — from the brief.
3. **Test first**: for a bug — a failing test that reproduces it; make sure it is red, and only then
   fix. A behaviour is tested in one layer (unit, contract or e2e); a second layer needs a reason
   in the PR description.
4. Implementation inside the ticket's trail: the smallest change that does the whole ticket. It
   comes after step 3 — the failing test stays first — and it never drops an item of the ticket's
   list of what "done" means.
   - Before the edit, list every place the change has to reach: callers, tests, fixtures,
     configuration, exports.
   - For a bug, grep every caller of the function you change and fix the cause once, in the shared
     code.
   - Then take the first of these options that solves the whole task:
     1. Nothing: the task does not need this code.
     2. Code the repository already has — a helper, a component, a pattern; use it the way the code around it does.
     3. The standard library or a feature of the platform.
     4. A dependency the project already installs; a new dependency for a few lines is not an option.
     5. One line that a reader understands at a glance.
     6. The least new code that works.
   - Never cut, whatever the size of the change: checks of input at a trust boundary, error
     handling that keeps data from being lost, security, accessibility, anything the ticket asks
     for.
   - A simplification with a known limit gets a comment in the comment syntax of the language:
     `shortcut: <limit>, <when to redo>` — what the simple code does not handle, then the
     condition under which it has to be replaced. A comment without the part after the comma is
     incomplete: nobody will know when to redo the code.
     `${CLAUDE_PLUGIN_ROOT}/bin/shortcut-ledger` lists the `shortcut:` comments of a work tree and
     marks the incomplete ones `no-trigger`.
