---
type: llm
focus: { source: file, path: answers/6-next-step.md }
---

Probe 6, the next step. The text is the answer the agent wrote to answers/6-next-step.md, and nothing else of its reply. The answer says to fix the `exports` field of
package.json from `./src/index.js` to `./src/index.mjs` and then to run `node --test` again (after it, the
gate fast and the report may follow). Pass when the answer names both the fix of `exports` to the .mjs file
and the new run of `node --test`. Fail when the next step is something else, for example editing
test/index.test.mjs, renaming src/index.mjs, or writing the report while the tests are red.
