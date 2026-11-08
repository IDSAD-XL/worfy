# Step 5 of /worfy:human-review-setup — write the skill

Plugin root: `<plugin>` below is the plugin folder, the one that holds `bin/` and `skills/`: the path you read this file from, without `/skills/human-review-setup/write.md`.

The input is what step 4 left in the private folder (`<_resolved.dir>/state/human-review/`): `research.md`, and
in `raw/` the comments (`prs.jsonl`), the labels (`reviewers.json`) and the analysis (`analysis/*.jsonl`). The
template is `<plugin>/skills/human-review-setup/template/`: `SKILL.template.md`, `voice-examples.md`, `lint.json`.
The output is the private review skill of this project:

```text
<private folder>/
  research.md                         step 4, unchanged
  lint.json                           the limits of the draft check
  .claude/skills/human-review/
    SKILL.md                          the skill, every rule ending with [R<n>]
    voice-examples.md                 real comments of the team by tier, with links
```

## 1. Build in raw/skill/ first

Write everything first into a new folder `<private folder>/raw/skill/`, and copy `research.md` there.
`review-draft-lint --skill <folder>` reads `SKILL.md` and `research.md` from the same folder, while the
installed skill folder holds no `research.md`: the evidence stays in the private folder, outside the folder a
session loads skills from. Building aside also keeps a half-written skill from replacing a working one, and
`review-history clean` deletes `raw/skill/` with the rest of `raw/`.

## 2. Fill SKILL.md

Copy `template/SKILL.template.md` to `raw/skill/SKILL.md`, then:

- Change only the `{{…}}` lines. Every other line stays as the template writes it: loading the pull request,
  the check on the head commit, `review-draft-lint` and the explicit "yes" before anything is posted are the
  same for every team.
- Each `{{rules: …}}` line becomes a list, one item per rule, drawn from the sections of `research.md` it
  names. Each item ends with the reference of its section, `[R<n>]`, or several (`[R5] [R8]`) when a rule draws
  on several. A section that says "No evidence in the window" gives the default its `{{…}}` line names, with
  that section's reference.
- A rule is one short item: what to do, and the number behind it — "Approve dependency bumps without a comment:
  41 of 44 were (93%). [R1]".
- No other list item under a `## ` heading: `review-draft-lint --skill` takes every list item there for a rule.
  Explanations are paragraphs.
- No login and no colleague's name; reviewer labels (`reviewer A`) only where a share needs one.
- Rules in English; a quoted phrase stays in the language of the history.

## 3. Fill voice-examples.md

Copy `template/voice-examples.md` to `raw/skill/voice-examples.md` and replace each `{{examples: <tier>}}` line
by the examples of that tier, in the format and by the rules the file states. Pick them from
`raw/analysis/*.jsonl` (`url`, `tier`, `reviewer`, `chars`, `area`) and take each comment's text from
`raw/prs.jsonl` by its `url`. Prefer comments whose `insisted` is not empty and that were not `withdrawn`.
Leave out the pull requests of `held_out` in `meta.json`.

## 4. Fill lint.json

Copy `template/lint.json` to `raw/skill/lint.json`. For each tier with a Voice section of comments in
`research.md`, set `tiers.<tier>.max_chars` to that section's 90th percentile of the length, rounded up to a
whole number; a tier without comments keeps the template's default. `forbidden` is the list of the existing
`<private folder>/lint.json`, if there is one — words the person added — and `[]` otherwise.

## 5. Check

Run, in the project root:

```bash
"<plugin>/bin/review-draft-lint" --skill "<private folder>/raw/skill"; echo "EXIT=$?"
"<plugin>/bin/evidence-check" "<private folder>/raw/skill/SKILL.md" "<private folder>/raw/skill/voice-examples.md"; echo "EXIT=$?"
```

The first: every rule ends with `[R<n>]` and `research.md` has that section. The second: no home folder path,
host name, email or token. Then check `lint.json` itself with an empty draft,
`{"payload": {"event": "COMMENT", "comments": []}, "tiers": []}` in `raw/skill/empty-draft.json`:

```bash
"<plugin>/bin/review-draft-lint" "<private folder>/raw/skill/empty-draft.json" --rules "<private folder>/raw/skill/lint.json"; echo "EXIT=$?"
```

And a short Node script over `raw/skill/`: no `{{` left in `SKILL.md` and `voice-examples.md`; none of the
logins of `raw/reviewers.json` (case-insensitive) and no `@<name>` but `@someone` in either file; in each tier of
`voice-examples.md` with examples from three or more labels, no label gives more than a third of them.

A finding (exit 1) — fix it: add the missing reference, drop a rule no section supports, take a login out — and
run all the checks again until each one passes. Exit 2 — show its line and stop.

## 6. Install

1. An existing skill moves aside first, into `<private folder>/previous/` (create it with `mkdir -p`). The
   suffix `<stamp>` is the time of this run, `YYYY-MM-DDTHH-MM-SS`, so two builds on one day keep both:
   `.claude/skills/human-review/SKILL.md` to `previous/SKILL-<stamp>.md`, `voice-examples.md` to
   `previous/voice-examples-<stamp>.md`, and `<private folder>/lint.json` to `previous/lint-<stamp>.json`.
2. Copy `raw/skill/SKILL.md` and `raw/skill/voice-examples.md` into `<private folder>/.claude/skills/human-review/`
   (create it), and `raw/skill/lint.json` to `<private folder>/lint.json`, next to `research.md`.
3. Tell the person how many rules each step of the skill has, and that `/human-review` loads in new Claude Code
   sessions of this project: a session already running does not see it.

Then go on to step 6 of SKILL.md.
