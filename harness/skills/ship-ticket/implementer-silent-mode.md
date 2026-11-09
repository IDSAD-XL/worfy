# implementer: Silent mode

Plugin root: `CLAUDE_PLUGIN_ROOT` in this file is the plugin folder, the one that holds `bin/` and `skills/`: the path you read this file from, without `/skills/ship-ticket/<this file>`. Claude Code spells it out only in SKILL.md and the agent definitions, and Bash may have it empty: in every command below put that folder in its place, or start the command with `export CLAUDE_PLUGIN_ROOT=<that folder>;`.

**Silent mode** — `profile --field _resolved.mode` prints `silent` (contract: `profiles/README.md`,
"Full mode and Silent mode"). The workflow files — the ticket, the spec, ADRs, the state file, the
glossary, lessons, evidence screenshots — live in the Workflow folder
(`profile --field _resolved.workflow_folder`), not in the repository: a relative path in the
profile's `tickets` and `docs` fields (except `docs.feature_pages`, relative to the working tree),
in `numbering.adr.dir` and in `lessons: "repo:<path>"` is taken from that folder. Read the ticket there
and write its result section there; never put a workflow file into the repository's index, and the
repository's own documents are read-only unless the ticket's goal is a document for the team or the
document is a page of `docs.feature_pages`. The branch is the
one the brief names — named by the change, not by the ticket; `ticket claim <epic> <NN> --branch
<branch>` records it in the ticket. Commit messages, the PR title, description and comments, and
code comments describe the change itself: no epic name, ticket or ADR number, Workflow folder path,
`.scratch` or `HANDOFF`. The guard refuses commits, branch names and PR texts that carry them;
`${CLAUDE_PLUGIN_ROOT}/bin/silent-check -C <tree> <text>` shows them first. In a project of
several repositories you work in the repository of the ticket's `Repo:` line only; a ticket with
several `Repo:` lines works in each of them, by the paragraph below.

**A ticket of several repositories** — its header has more than one `Repo:` line; their order is
the order of merge, the library first and its consumers after it. There is no worktree for it
(`parallel: single`): the ticket holds the main checkout of every repository it names (paths —
`profile --field _resolved.repos`), and no other ticket works in them until it is closed.
- The branch has one name in every one of those checkouts (skill `/worfy:ship-ticket`, step 2):
  create it from the base in each and make the change of each repository there.
- Each repository has its own gate entry: run the checks and the gate fast in each checkout
  (`cd <checkout> && …`), each with its exit code, and report them per repository. Paths in the
  report start with the name of the repository: `app/src/lots.ts`.
- Each change is safe on its own: the library change is backward compatible, so a consumer that
  still uses its old version keeps working after the library is merged and released. The reviewer
  checks this.
- The consumer's branch carries the bump of the library's version (its dependency range). Record
  what it waits for: `"${CLAUDE_PLUGIN_ROOT}/bin/ticket" release <epic> <NN> <repo> tag <tag>` or
  `… <repo> package <name>@<version>`, `<repo>` being the library's `Repo:` line.
- No PR until `review success` on the heads of all the branches: the orchestrator asks for the PRs
  then. Open them together, one per repository, in the order of the `Repo:` lines, and record each:
  `"${CLAUDE_PLUGIN_ROOT}/bin/ticket" pr <epic> <NN> <repo>#<N>`. The consumer's PR opens as a draft
  (`gh pr create --draft`) while its `Release:` line waits. Each PR's title and description tell only
  its own change: no link to the other PRs and no word about them. Run `silent-check -C <checkout>
  <text>` on each in its own checkout.
