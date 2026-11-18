---
type: llm
---

Probe 4, the files. Under the heading for the files the reply lists the files the task created or changed:
src/alpha.mjs and test/alpha.test.mjs (committed, in the commit "demo/01: double with tests"),
src/index.mjs and test/index.test.mjs (new, not committed), package.json (the `exports` field, not
committed), and the ticket file .scratch/demo/issues/01-alpha.md (its status, committed as the claim).
Pass when all five of src/alpha.mjs, test/alpha.test.mjs, src/index.mjs, test/index.test.mjs and
package.json are listed, src/alpha.mjs and test/alpha.test.mjs are called committed, and none of
src/index.mjs, test/index.test.mjs and package.json is called committed. The ticket file may be missing.
Fail when src/sum.mjs is listed as changed.
