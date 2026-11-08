# Critic: worfy-scrub — 2026-11-08

Plan: `.scratch/worfy-scrub/spec.md`
Verdict: Keep — the order (guard in report mode, four disjoint cleanup tickets, then the blocking switch) holds; the three objections are fixes inside tickets 01, 02 and 04, not changes of order or shape.

## Objections

### 1. Ticket 02 renames evidence images, and the existing evidence check in `pnpm lint` will fail on every renamed image

Fact: `harness/bin/evidence-check:832` lists changed files with `git diff --name-status -z --no-renames`, so a `git mv` shows up as an added file; `:860` sets `needsNote: st === "A"`, and `:742` reports "image needs a human check (no scrub: note)" for an added image without a `- evidence: screenshot … · scrub: <date>` line added by the same branch; `package.json:17` runs `evidence-check --changed --root .scratch` inside `pnpm lint`; the tickets of `.scratch/worfy-daily` that reference those images contain no `evidence:` line at all, and `worfy-scrub/02` line 28 says evidence lines are not rewritten while line 36 requires `evidence-check --changed` and `pnpm lint` to exit 0.

Judgement: As written, Ticket 02 cannot reach its own "done" criteria: each of the five renamed images needs a new scrub note line, or else the image has to be removed or the check has to be bypassed. The ticket should say which it is. The cheapest fix is a step "add one `- evidence: screenshot … · scrub: <date>` line per renamed image after the agent has looked at it". That line records the visual check the ticket already requires.

Owner decision: accepted — the owner agreed ("все да", Q8): Ticket 02 adds one scrub line per renamed image after the agent has looked at it
### 2. Moving the name check of `plugin-neutral.test.sh` to the new guard drops a check that `harness/` has today

Fact: `harness/bin/tests/plugin-neutral.test.sh:21`, the pattern "names or accounts of the owner", includes the repository account and matches it as a case-insensitive substring; `:80-83` scan with `find` when the test runs outside a git checkout; spec decision 2 (`spec.md:102`) keeps the repository account out of the hash list; `worfy-scrub/04` line 40 removes the name list and hands the check of `harness/` to `scripts/check-personal.mjs`.

Judgement: After Ticket 04, nothing stops the repository account, or a project name glued into a longer word, from reaching the shipped plugin again. ADR-0074 (the Harness plugin is neutral by language and project) forbids both today, and the test enforces it. Ticket 04 should keep a check of `harness/` that is at least as strict as the current one. One way is to keep the account in a hashed list that only the plugin scan uses. Another is to keep that one pattern in the test. Either way, the ticket should state the path for a run from the installed plugin, where `scripts/` is not present.

Owner decision: accepted — the owner agreed ("все да", Q9): Ticket 04 keeps the harness/ check at least as strict, with the repository account in a hash list used only by the plugin scan, substring matching kept, and a path that works from the installed plugin
### 3. The hash guard matches whole words, while the same personal list in `privacy.cjs` matches substrings, so the "report is empty" criteria can be met with leftovers

Fact: `harness/lib/privacy.cjs:147-150` matches each `deny` word "case-insensitively anywhere in the text" (a substring); `spec.md:63-64` and `worfy-scrub/01` line 30 split text on `[^a-z0-9]+` and compare the hash of each word and of up to three neighbouring words joined with `-`; `worfy-scrub/01` line 31 reads the entries of `privacy.json` for `--hash-from` and says nothing about normalising them.

Judgement: The hash guard misses three kinds of value. First, a plural or any name glued to another word without a separator. Second, a `deny` entry that contains a `.`, a `_` or a space. Third, an entry of four or more parts. Such an entry gets a hash that can never match. Yet tickets 02–05 and 06 count "zero findings" as done. Ticket 01 should do three things: split each entry with the same rule, refuse or warn on an entry that cannot be represented, and test both. The spec should also list the substring gap among the risks, so that "empty report" is not read as "no personal strings left".

Owner decision: accepted — the owner agreed ("все да", Q10): Ticket 01 splits deny entries by the text rule and refuses entries it cannot match; the substring gap is risk 8 of the spec
## Alternative

Extend the existing check instead of adding a second one. Give `harness/bin/evidence-check` a whole-tree mode and give `privacy.cjs` a hashed `deny` option. Then CI and the owner's machine run one set of rules, and the plugin-neutral name list goes to hashes in the same place. The cost is that Ticket 01 becomes a platform PR: it touches `harness/` and `evidence-check.test.sh`, so it must wait for the Windows verdict under ADR-0056 (platform PRs wait for Windows). That puts Windows on the path of the first wave, which every cleanup ticket waits on. The spec's separate `scripts/` guard keeps Wave 1 short and Mac-only. It is still the better plan once objections 2 and 3 are fixed inside it.

## What the critic cannot know

- The open personal list is not in the repository. Its file `privacy.json` did not exist on the owner's Mac on 2026-11-08, according to `worfy-scrub/01`. So the critic could not check whether its entries fit the word-and-hyphen matching.
- The critic did not open the images. How many of them show personal data in their pixels is unknown.
- The line counts in the spec's survey table were not recounted.
- There is no product analytics. How many existing users still have the old Harness to migrate is unknown, so the weight of the `PERSONAL_BIN` risk (the list of the owner's personal tool names that the old-Harness migration keeps) cannot be measured.
