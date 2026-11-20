# worfy Harness — compaction rules

These instructions are for the summary that replaces the conversation when the context is compacted.
The agent that goes on after compaction sees only this summary and its files, not the conversation.
Write the summary for an engineer who picks the work up cold, and keep every fact as the conversation
states it: exact paths, branch names, PR and ticket numbers with their epic, commands with their exit
codes. A fact that is not in the summary is lost.

## Sections

Write the summary under these seven headings, in this order:

1. **Intent** — what the user, or the agent that launched this one, asked for, in their own words, and
   what counts as done.
2. **Essential facts** — decisions taken and why, constraints and limits the work must keep, the
   project, the repository or worktree path, and the rules the user stated during the conversation.
3. **Completed work** — what is finished, each item with how it was verified: the command and its exit
   code. Work that was not verified is not completed: say so.
4. **Files touched** — every file edited or created, one per line, with what changed, and the files
   read that a decision rests on. This is the list summaries lose most often: keep it whole.
5. **Errors** — every failure met, its cause, and whether it is fixed or still open.
6. **Pending work** — what is left, in order.
7. **Next action** — the step to take first after compaction, with the exact edit or command, and the check
   that shows it worked: after a fix, the command that failed, run again.

## By role

Put the facts of the role into those sections. The role follows from the conversation: its first
instructions and the task it was given.

**Orchestrator** — a main Session that runs an epic: the epic, the wave number and each ticket of the
wave with its state; every PR in work with its number, branch, CI state and review verdict; the agents
still running, each with its name, ticket and worktree; every decision taken without the owner, one
line each, as in the decision log (`decisions.tsv`, skill `worfy:epic-wave`); the questions waiting for
the owner.

**Implementer** — an agent that ships one ticket (`worfy:implementer`): the ticket file, the worktree
path, the branch and the base commit; every item of the ticket's done section (`tickets.done_section`
of the profile), word for word, each with its mark — done with its evidence, not done, or not verified;
the PR number when there is one; the commands run so far with their exit codes; the last command that
failed, the error it printed and its cause; and what the change removed from existing behaviour.

**Any other agent** — a reviewer, a scout, a Product Session or any other task: the task as given, its
target (a PR, a branch, a lens, a topic), every file edited, and the findings so far, each with its
`file:line`.
