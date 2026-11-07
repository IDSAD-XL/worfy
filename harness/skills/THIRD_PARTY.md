# Third-party skills

Nineteen folders of `skills/` are a copy of Matt Pocock's skills, not skills written for worfy.

## Source

- Upstream: <https://github.com/mattpocock/skills>, plugin `mattpocock-skills` of the
  `claude-plugins-official` marketplace.
- Version: 1.3.1, upstream commit `49dd158d1076134a641b33efb035946536778336`.
- Author: Matt Pocock (<https://www.aihero.dev>).
- Licence: MIT. The licence text is [`LICENSE.mattpocock-skills`](LICENSE.mattpocock-skills), the
  `LICENSE` of the 1.3.1 copy byte for byte.

## Copied skills

Each folder is copied whole (`SKILL.md`, the files next to it, `agents/openai.yaml`, `scripts/`),
flat under `skills/<name>/`, with the upstream name. Upstream keeps them in `skills/engineering/` and
`skills/productivity/`:

- engineering: `code-review`, `codebase-design`, `diagnosing-bugs`, `domain-modeling`,
  `grill-with-docs`, `improve-codebase-architecture`, `prototype`, `research`, `tdd`, `to-spec`,
  `to-tickets`, `wayfinder`;
- productivity: `grill-me`, `grilling`, `handoff`, `teach`, `to-questionnaire`, `wait-what`,
  `writing-for-agents`.

The skill-folder check of `bin/tests/start-context.test.sh` reads the names of this section to leave
these folders alone: upstream links the files of a skill relatively, not through the plugin root.

## Not copied

`ask-matt`, the upstream setup skill (its work, where a project keeps tickets, belongs to
`connect-project`), `pr`, `wizard`, `triage`, `implement`, `implement-spec`, and everything under
`misc/`, `in-progress/` and `deprecated/`.

## Reference edits

Every file is the 1.3.1 file byte for byte, except the references below. Nothing else in the text
changed: words such as issue, label, `resolved` and `GLOSSARY.md` stay upstream's, and
`bin/TICKETS.md`, section "Wayfinding operations", reads them in worfy's terms.

- A call of the Skill tool names the skill `worfy:<name>` instead of `<name>`.
- A skill named as a slash command is `/worfy:<name>` instead of `/<name>`.
- "The issue tracker should have been provided to you. If not, tell the user to run" the upstream
  setup skill becomes: the tracker is the ticket folder of the worfy project profile
  (`bin/profile --field tickets.root`), its format and operations are in `bin/TICKETS.md`, section
  "Wayfinding operations", and a project without a profile is pointed to `/worfy:connect-project`.

| File | Line | Edit |
| --- | --- | --- |
| `skills/code-review/SKILL.md` | 13 | tracker sentence |
| `skills/grill-me/SKILL.md` | 7 | Skill tool: `"worfy:grilling"` |
| `skills/grill-with-docs/SKILL.md` | 7 | Skill tool: `"worfy:grilling"`, `"worfy:domain-modeling"` |
| `skills/improve-codebase-architecture/SKILL.md` | 13, 71 | Skill tool: `"worfy:codebase-design"` |
| `skills/improve-codebase-architecture/SKILL.md` | 54 | `/worfy:codebase-design` |
| `skills/improve-codebase-architecture/SKILL.md` | 64 | Skill tool: `"worfy:grilling"` |
| `skills/improve-codebase-architecture/SKILL.md` | 66 | Skill tool: `"worfy:domain-modeling"` |
| `skills/improve-codebase-architecture/HTML-REPORT.md` | 42, 108, 123 | `/worfy:codebase-design` |
| `skills/tdd/SKILL.md` | 26 | Skill tool: `"worfy:codebase-design"` |
| `skills/tdd/SKILL.md` | 38 | the `worfy:code-review` skill |
| `skills/teach/SKILL.md` | 12 | `/worfy:teach` |
| `skills/to-spec/SKILL.md` | 9 | tracker sentence (with the triage label vocabulary) |
| `skills/to-tickets/SKILL.md` | 11 | tracker sentence (with the triage label vocabulary) |
| `skills/to-tickets/SKILL.md` | 60 | the tracker `/worfy:connect-project` configured |
| `skills/wayfinder/SKILL.md` | 25 | tracker sentence |
| `skills/wayfinder/SKILL.md` | 77, 115 | Skill tool: `"worfy:research"` |
| `skills/wayfinder/SKILL.md` | 78 | Skill tool: `"worfy:prototype"` |
| `skills/wayfinder/SKILL.md` | 79, 111, 124 | Skill tool: `"worfy:grilling"`, `"worfy:domain-modeling"` |

`test/contract/harness-third-party-skills.test.ts` pins the sha256 of every 1.3.1 file: a file not
in this table must match it, a file in the table must differ from it.

## Updates

There is no synchronisation with upstream, automatic or scheduled. A new upstream version comes in
only by the owner's word, as a pull request of its own: read the upstream diff between the two
versions by hand, copy the changed files, apply the reference edits above again, and update this
file and the hashes of the test.
