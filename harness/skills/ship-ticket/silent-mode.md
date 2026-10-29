# ship-ticket: Silent mode

**Silent mode** — `F _resolved.mode` prints `silent` (contract: `profiles/README.md`, "Full mode and
Silent mode"). The workflow files — the ticket, the epic spec, the state file, ADRs, the glossary,
lessons, evidence screenshots — live in the Workflow folder `F _resolved.workflow_folder`, not in the
repository: a relative path in `F tickets.path`, `F tickets.spec`, `F docs.handoff`, `F docs.adr_dir`,
`F docs.context` and `F lessons` is taken from that folder. Write them only there; the repository's
own documents are read-only, unless the ticket's goal is a document for the team and it says so. The
branch, commit messages, the PR title, description and comments, and code comments describe the change
itself: no epic name, ticket or ADR number, Workflow folder path, `.scratch` or `HANDOFF`. The guard
refuses commits, branch names and PR texts that carry them; `"${CLAUDE_PLUGIN_ROOT}/bin/silent-check"
-C <repo> <text>` shows them before that. In a project of several repositories the ticket's repository
is its `Repo:` line (a name from `F _resolved.repos`), and `<repo>` below is that repository. Full mode
(`full`) — everything as written below, without these rules.
