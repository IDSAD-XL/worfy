# implementer: Silent mode

**Silent mode** — `profile --field _resolved.mode` prints `silent` (contract: `profiles/README.md`,
"Full mode and Silent mode"). The workflow files — the ticket, the spec, ADRs, the state file, the
glossary, lessons, evidence screenshots — live in the Workflow folder
(`profile --field _resolved.workflow_folder`), not in the repository: a relative path in the
profile's `tickets` and `docs` fields, in `numbering.adr.dir` and in `lessons: "repo:<path>"` is
taken from that folder. Read the ticket there and write its
result section there; never put a workflow file into the repository's index, and the repository's
own documents are read-only unless the ticket's goal is a document for the team. The branch is the
one the brief names — named by the change, not by the ticket; `ticket claim <epic> <NN> --branch
<branch>` records it in the ticket. Commit messages, the PR title, description and comments, and
code comments describe the change itself: no epic name, ticket or ADR number, Workflow folder path,
`.scratch` or `HANDOFF`. The guard refuses commits, branch names and PR texts that carry them;
`${CLAUDE_PLUGIN_ROOT}/bin/silent-check -C <tree> <text>` shows them first. In a project of
several repositories you work in the repository of the ticket's `Repo:` line only.
