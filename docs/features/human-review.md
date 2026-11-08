# Team reviewer

The **Team reviewer** is a private review skill of a Project. It is written from the review history of the Project's pull
requests on GitHub, so that a draft review reads like the team's own: a short nit where the team writes a nit, nothing
where the team lets a change through. worfy offers to build it when a Project is added, shows it in "Project settings…",
reminds once a month to update it, and gives it to the Project's Sessions. The skill, and everything read to build it,
stays on this machine, in the Profile folder of the Project. Terms are explained in [Concepts](concepts.md); "Project
settings…" and adding a Project are on [Projects](projects.md). The plan and the reasons are in the spec of the Epic,
[worfy-human-review](../../.scratch/worfy-human-review/spec.md), and in
[ADR-0102](../adr/0102-private-project-skills-in-profile-folder.md).

**Not the Stage `human-review`.** The [Pipeline](workflow.md) has a Stage of kind `human-review`, "Human review" on the
board: it waits until GitHub's review decision on the open PR is `APPROVED`. That Stage watches the review a person
gives on GitHub. The Team reviewer is a skill that drafts a review. They share a word and nothing else: the Stage
does not use the skill, and the skill does not move a Ticket on the Pipeline.

## Team reviewer

### Behaviour

**The offer after an add.** Once a folder new to the list is added, by Connect or as a folder the Harness knows
already, worfy runs `review-history probe` of the Harness in the background, with the Profile's GitHub account and a
2-minute limit. The probe reads pull requests updated in the last 12 months that have a review of the team, and stops
at the 30th substantive comment. A comment counts when its author is in the team (owner, member or collaborator of the
repository), is not a bot and is not the author of that pull request, and its own text, quotes left out, is at least 20
characters long or holds a `suggestion` block; "LGTM", "+1", "thanks" or an emoji alone do not count. With 30 such
comments (`voice: yes`) the Project gets an `action` toast "Build a reviewer in your team's style?" with "Build" and
"Later". `voice: no`, no `origin` on GitHub, no `gh`, a failure or the time limit show nothing, and the log gets one
line. "Later", or closing the toast, is saved in the Project's settings, and the offer is not made again. A Project
whose reviewer is built already gets no offer.

**"Build".** The toast's "Build", or "Build" in "Project settings…", opens a new [Session](sessions.md) in the Project's
root, always on Claude Code, whose first message is `/worfy:human-review-setup`. That skill, the generator, goes in
this order:

1. **Read and estimate.** It reads the history into a temporary folder: pull requests updated in the last 12 months with
   a review of the team, at most 500 per repository. Then it shows the counts (pull requests, reviews by state,
   comments by kind, substantive comments, reviewers), the characters and an estimate of the tokens a model would
   read, and the list of ignored logins and text openings, which the person may extend. It says that the colleagues'
   comments will go to the Vendor of the model, as any code of the Session does. No model reads a comment before an
   explicit "yes". Without it the temporary folder is deleted and nothing else happens.
2. **Too little history.** Fewer than 30 substantive comments: "The team's voice cannot be built: N substantive
   comments of people over M pull requests, 30 are needed." It offers `/worfy:code-review` instead, a review against
   the repository's documented standards. Only the counts stay, no text of a comment.
3. **One reviewer.** When one reviewer wrote 80% or more of the team's comments, it says so: the voice will mostly be
   that person's. The voice is still built from everyone's numbers, and no reviewer gives more than a third of the
   examples of a tier when three or more people gave examples.
4. **Analysis.** After the "yes", 5 recent pull requests are held out for the check below, or a third of them when
   fewer than 15 qualify. Subagents read the rest in
   batches by area of code and sort every comment of the team by tier (let go, nit, question, heads-up, followup,
   argued, blocker) and by theme. The result is `research.md`, the evidence file: sections `R1`, `R2`, … with the
   numbers and the links to the comments.
5. **The skill.** It fills a template of eight steps (load the pull request, triage, a checklist by area, verify and
   grade, voice by tier, review state, draft, show the person). Every rule ends with the `[R<n>]` of the section of
   `research.md` behind it, and a script refuses the skill while a rule has no such section.
6. **The check on 5 pull requests.** One Subagent per held-out pull request drafts a review at the commit the team's
   first review saw, and posts nothing. The draft's remarks are paired with the team's real comments on that commit:
   two line comments only when they are on the same file within 10 lines, and a judge Subagent confirms each pair. Each
   pull request gets a page with the team's comments beside the draft, and the line "matched K of N remarks of the
   team, M extra"; the total carries the words "a rough measure". Comments the team wrote on later commits are listed
   apart and not counted.
7. **The person decides.** **Keep** deletes the temporary folder and records the date. **Build again** takes the
   person's remarks into the skill and runs the check again; its result is then marked "after the person saw these
   PRs". **Refuse** deletes the private folder. With no answer, the temporary folder is deleted and the rest stays.

**Using it.** Once built, the reviewer reaches every Claude Code Session of the Project that a person is at, as the
skill `/human-review`: the Orchestrator, "New session", "Ship ticket" and a Product Session. Asked to review a pull
request, it writes a draft in the team's voice, checks it with `review-draft-lint`, and shows it. Nothing goes to
GitHub without the person's explicit "yes" to that draft in the conversation; a request to change it, a question or
silence is not a "yes". These Sessions never get it:

- an Autopilot Session and any other Session that runs without a person: nobody there can say "yes";
- the draft Session of "Add project";
- a Codex Session: the private folder is attached only by the Claude Code driver;
- a Session started outside a Project, or one whose Canvas did not connect.

**Claude Code in a terminal.** A `claude` you start yourself in a shell, in worfy's [Terminal](terminal.md) or anywhere
else, is not a worfy Session and does not get the folder. Give it by hand: find the Profile folder with
`profile -C <project> --dir` of the Harness, then start `claude --add-dir "<Profile folder>/state/human-review"`.
Claude Code loads the `.claude/skills/` of an added directory, so `/human-review` is there.

**"Team reviewer" in "Project settings…".** The section shows `Not built`, `Built <date>, <N> PRs`, or
`Too little history: <N> of 30`, or `Not available: <reason>` when the Profile folder cannot be read. The date is when the person kept the result, else the last whole read of the
history; after an update the person accepted, it is the date of that update, and `<N>` adds the pull requests the
update read. "Build" starts the generator's Session and closes the dialog, unless a field of the dialog was edited: then the
dialog stays open and says the Session has started. Once the reviewer is built, "Update" takes its
place. "Delete" asks first, then erases the private folder and nothing else.

**The monthly update.** Each time a window makes a Project active, it asks main whether a reminder is due. It is due
when the reviewer is built, its date is more than 30 days old, and no reminder came in the last 30 days. A due
reminder is saved before the answer, so it comes once, in one window. The Project then gets an `action` toast "Update
your team reviewer?" with "Update" and "Later". The reminder reads only the private folder: no Harness script, no
GitHub, no model. "Update", here or in "Project settings…", opens a Session with
`/worfy:human-review-setup --refresh`:

- It reads only the pull requests since the last analysis, and counts only the team's comments written after that
  date. With none, it says there is no new pull request with a review of the team since that date, deletes what it
  read and spends no tokens.
- It asks the same "yes" after the estimate, then analyses the new comments together with the `research.md` of
  before. Old sections keep their numbers, and new themes get the next ones.
- It writes the new skill as a draft and shows the diff of the rules: **Added**, **Changed** and **Removed**, each
  with its `[R<n>]` and, for every number in the rule, "before → now".
- It checks the draft on 5 of the new pull requests, as a build does.
- **Accept** moves the installed skill, its examples, `research.md`, `lint.json` and the old check pages into
  `previous/` with a time stamp, and puts the new ones in place. **Reject**, or no answer, deletes the draft and
  changes nothing.

#### Windows

The Feature has no code of its own for Windows. The probe starts as every Harness script does, `node <script>`, and the
private folder's path reaches Claude Code as it is spelled, with a drive letter or spaces.

#### On a Linked machine

A read-only screen of a Linked machine sees the state line of "Team reviewer" without its buttons, and does not ask
for the reminder: answering it writes the reminder's date. A screen with full access works as a window of the Machine.

### How it works

- **One private folder per Project, on this machine.** Everything lives in `<Profile folder>/state/human-review/`:
  `meta.json` (the window, the counts, the dates, the held-out pull requests, the result of the check), `ignore.json`
  (bot and service logins and text openings, edited by the person), `research.md`, `lint.json`, `check/`, `previous/`,
  the temporary `raw/` and the skill in `.claude/skills/human-review/`. The Harness keeps `state/` of a Profile out of
  the git history of its home, so the colleagues' words never enter a git history, and "Delete" erases them for real.
  The reviewer is built exactly when `.claude/skills/human-review/SKILL.md` is in that folder; the Profile has no
  field for it ([ADR-0102](../adr/0102-private-project-skills-in-profile-folder.md)).
- **The voice is the team's.** All the team's reviewers count together. The skill, its examples and `research.md` hold
  links to comments and labels such as "reviewer A", never a login. Logins appear only in `ignore.json` and, for one
  run, in `raw/`.
- **Reading GitHub costs API points, not tokens.** `review-history` reads with `gh api graphql`, 100 pull requests a
  page, one request at a time, under the GitHub account of the Profile; it never switches the global `gh` account. A
  rate-limit answer is retried three times.
- **A draft is checked before a person sees it.** `review-draft-lint` refuses a comment longer than the limit of its
  tier, a trace of the workflow (an Epic, a Ticket, an ADR number, `.scratch`, `HANDOFF`), an AI authorship line,
  personal data, and a word the person added to `forbidden` in `lint.json`.
- **The check never sees the answer.** The draft of a held-out pull request is built from the diff between the commit
  the pull request branched from and the commit the first review saw. For a merged pull request that base is the merge
  base of the merge commit's first parent and that commit; for one not merged, of `origin/<base branch>` and that
  commit. A pull request with an empty diff is skipped. The drafting Subagent reads no later history of the pull
  request.
- **A Session gets the folder as an extra directory.** On each start a Claude Code Session with a person reads the
  Profile folder through `bin/profile` and adds the private folder after the Cards folder, as `additionalDirectories`.
  The Profile's `skills.allowed` does not remove it. A failure leaves the Session without the folder and logs one
  line, rather than leaving the person without a Session.

### Implementation

**Modules.**

| What | Where |
|---|---|
| The offer, the state of "Team reviewer", the reminder (`refreshDue`), "Delete" | `src/main/projects/review-offer.ts` |
| The channels `projects.reviewer.*` and their access | `src/main/ipc/projects.ts`, `src/shared/ipc/projects.ts` |
| The toasts of the offer and of the reminder | `src/renderer/projects/review-offer.ts`, asked on activation from `src/renderer/projects/useProjects.ts` |
| The section "Team reviewer" | `src/renderer/shell/ProjectSettings.tsx` |
| The generator's Session (`buildTeamReviewer`) and its command | `src/main/actions/launch.ts`, `src/shared/projects/action-templates.ts` |
| `humanReview.offer` and `humanReview.remindedAt` | `src/main/projects/settings.ts` |
| The private folder in a Session (`privateSkillsFolder`, `additionalDirectories`) | `src/main/vendors/claude/query.ts`, `src/main/vendors/claude/options.ts` |
| The Profile folder (`readProfileFolder`) | `src/main/workflow/profile.ts` |
| Reading the history, the estimate, the probe | `harness/bin/review-history` |
| Checking a draft and a skill | `harness/bin/review-draft-lint`, `harness/lib/workflow-traces.cjs` |
| The generator | `harness/skills/human-review-setup/SKILL.md`, with `analyse.md`, `write.md`, `check.md`, `refresh.md` |
| The template of the generated skill | `harness/skills/human-review-setup/template/` |

**Main tests.**

- `test/contract/projects.test.ts`: the offer by the probe's answer, "Later", the state and "Delete", the reminder
  once in 30 days with "Update".
- `test/e2e/projects.spec.ts`: the offer with "Later" and "Build" in the built app.
- `test/unit/review-offer-toast.test.ts`, `test/unit/project-settings-shell.test.tsx`: the toasts and the section.
- `test/unit/agent-options.test.ts`, `test/contract/workflow-profile.test.ts`: which Sessions get the private folder,
  after the Cards folder, with `skills.allowed` too.
- `harness/bin/tests/review-history.test.sh`, `test/contract/harness-review-draft-lint.test.ts`,
  `test/contract/harness-human-review-setup.test.ts`: the scripts and the generator's texts.
