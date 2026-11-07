# Auto-approval

How worfy answers a permission request of the agent of an [Autopilot](autopilot.md) run: the modes Off, Shadow and On,
the approval policy, a request parked for the owner and where to see the decisions. New to the terms: start with
[Concepts](concepts.md).

## Auto-approval

### Behaviour

#### The mode and the approval policy

Auto-approval decides what worfy answers when the agent of a run asks for a permission. It is set per Project on the
Machine of the Project, in the Orchestrator's Modes menu ([Sessions](sessions.md)), and is Off until set. The mode is
kept in worfy's own `app-settings.json`, not in the Profile, which the agent could change itself. While worfy runs with
a debugging port or the Node inspector open, Off applies whatever is saved. A run reads the mode at each request.

| Mode | What the agent gets | What the journal gets |
|---|---|---|
| Off | The refusal of an unattended Session, as without Auto-approval. The policy is not asked. | `refused-dialog` |
| Shadow | The same refusal as at Off: no hint, no park. | `auto-approval` with what the policy would have done: `would-allow`, `would-deny`, `would-park`, or `hard-deny`. |
| On | The policy's decision (below). | `auto-approval` with `allow`, `deny`, `park` or `hard-deny`; a park also gets `park-answered` or `park-expired` when it ends. |

The approval policy judges each request in a fixed order and gives one outcome with the rule that decided it:

- **deny with a hint**: the agent can rewrite the request. A question with answer options is always this ("decide by
  the rules of the Project, or write the question into the owner questions of the Ticket"); so is a command the
  policy cannot read in full (a command substitution in a target, `eval`, a loop over a variable target, a variable with
  no known value), a symbolic link on the path, a delete of a whole root, and a write to git's config, hooks or
  attributes. What the policy did not read it never allows. The hint is fixed text of the rule, never a piece of the
  request.
- **allow**: every target is inside the roots of the run — the worktrees of the Tickets of the current Wave, the
  Project's `.scratch`, the run's own temporary folder and the Session's scratchpad — and an allow rule passes every
  action: file programs inside the roots without the network, an `sh`/`bash`/`zsh -c` script whose every action another
  rule passes, git in a worktree of the Wave without push and without deleting a branch, and Edit, Write, MultiEdit,
  NotebookEdit (Claude Code) or a file change (Codex) inside the roots. A push is never allowed.
- **park**: parsed, but only a person can decide, such as a push or a tool the policy does not know. The request waits
  on the Orchestrator's Session for at most 60 minutes, as described under [During a run](#during-a-run).
- **hard deny**: refused in every mode, and no answer lifts it. The secrets and settings of the home folder
  (`~/.claude`, `~/.codex`, `~/.ssh`, `~/.gnupg`, `~/.config/gh`, `~/.gitconfig`, `~/.config/git`, `~/.npmrc`, the shell
  rc files, `~/Library`) and `%APPDATA%` and worfy's data folder (except the run's own temporary folder), to write,
  delete or read; writing into the Harness home, the folders of other live Sessions and other worktrees; programs that
  change the system or app settings (`sudo`, `launchctl`, `security`, `crontab`, `defaults write` and the like);
  `chmod` and `chown` outside the roots; a force push, a push that deletes, a push to the default branch or a branch of
  another worktree, and deleting, checking out or committing on such a branch; running what was downloaded
  (`curl … | sh`); sending a file from outside the roots.

Where to see the decisions: Run history lists them in its Auto-approval block, with the counters and, in Shadow, the
Project's Shadow decisions so far ([Flight Recorder](flight-recorder.md#the-auto-approval-block)). When the run is over
the Orchestrator's chat gets one line, `Auto-approval: allowed 3, denied 1, parked 0` or `Shadow: would allow 2, would
deny 1, would park 0`. A switch from Shadow to On is the owner's: worfy never changes the mode itself.

#### During a run

While a run goes on:

- On either Vendor the Project's Auto-approval mode changes what happens to a permission request; it is read
  at each request, so a switch counts from the next one. Off: the refusal of an unattended Session, as in
  [Autopilot, During a run](autopilot.md#during-a-run). Shadow: the approval policy judges the request,
  the journal gets an `auto-approval` line with what it would have done (`would-allow`, `would-deny`, `would-park`) and
  the rule, and the model still gets the refusal of Off. On: the policy's decision is the answer — an allowed request
  runs, a denied one is refused with the rule's hint, and a hard deny is always refused. A request only a person can
  decide is parked: it opens on the Orchestrator's Session as a permission card that names the rule and the paths, with
  Allow and Deny but no Always allow, so one answer covers that one request. During the Orchestrator's own turn the
  Session shows that it needs permission; a background task's parked request leaves an idle Session idle. A
  notification "Parked: `<tool>` in `<folder name>`" goes out, and the other Subagents go on. The owner's answer is
  the answer to the agent; with no answer in 60 minutes, or when the run stops, the request is refused with a hint, and
  while the run is stopping a request is not parked but refused at once. A parked request keeps its background task
  from counting as stalled. The journal gets `park` when it is parked, then `park-answered` or `park-expired`.
  When the run is over, the Orchestrator's chat gets one line that counts the run's decisions. It comes at the stop when
  nothing is left running, and also when the run gives the Orchestrator back to a person with its turn or background
  tasks still running ([after any other stop](autopilot-faults.md#after-any-other-stop)): their later requests go to the person, not to the
  policy. After Stop autopilot with a turn or tasks still running, and when the give-back could not change the Session,
  the line comes once the run's turn and background tasks have ended and the Orchestrator is back, the app quits, or the
  next run takes the Session over. A request of those tasks after such a stop is judged by the run's policy and
  journaled as during the run, and the line counts it; once the next run has opened its own policy, the requests are
  judged by that policy and belong to the next run. The line reads `Auto-approval: allowed 3,
  denied 1, parked 0` for On, `Shadow: would allow 2, would deny 1, would park 0` for Shadow, with `hard-denied N` added
  when there was a hard deny, and both, On first, when the mode was switched during the run. The end of a park is not
  counted again. A run with no decision gets no line. Run history lists the decisions
  ([Flight Recorder](flight-recorder.md#the-auto-approval-block)).
  On a Codex Orchestrator the request is Codex's approval of a command or a file
  change, and the answer is `accept` or `decline`: Codex's answer carries no text, so the rule's hint reaches only the
  journal. A command is judged in the folder Codex names for it. Codex wraps each command in the login shell
  (`/bin/zsh -lc '<script>'`). A wrapper of `zsh`, `bash` or `sh` — by name or from `/bin`, `/usr/bin`,
  `/usr/local/bin` or `/opt/homebrew/bin` — with `-lc` or `-c` and one quoted script word with nothing after it
  (single-quoted, or double-quoted with every `$` and backquote escaped) is judged as `<shell> -c '<script>'` (the
  login profile is the owner's own and outside every root); any other wrapper is not approved. Codex's `shell_environment_policy` may leave variables out of a command's shell. worfy pins the home
  folder and the run's variables (`TMPDIR` and its git environment) in every command's shell of the thread
  (`shell_environment_policy.set`), but Codex applies the owner's `include_only` after these pins, so it may still drop
  any of them. When a Codex request is judged, no variable has a known value: a command that uses one — `TMPDIR`,
  `HOME`, `USERPROFILE` or a secret included — or makes a folder with `mktemp -d` outside macOS is not approved, and no
  value of one reaches the journal. A `~` at the start of a word is still judged as the `HOME` the app-server started
  with, while bash, zsh and Git Bash with `HOME` dropped take the home folder from the user database: the two are
  assumed to be the same folder (on Windows with a custom `HOME`, such as `D:\home`, they may differ). Git on Codex is judged as git without the run's git environment,
  so the policy approves no git command there and parks the ones it would allow on Claude Code. A file change is
  judged by each path it writes, the new path of a rename and its `grantRoot` included. A request with a `grantRoot`
  (writes under a folder for the rest of the Session) is never accepted by the policy, input to a running command and
  a request for network access are parked, and no answer is ever "accept for this Session". A parked Codex request
  waits on the card as Claude Code's does, with Accept, Decline and "Decline and stop the turn"; the card also shows
  Codex's reason and, for network access, the host. A parked file change with a `grantRoot` offers no Accept, since
  Codex would take it as writes under that folder until the Session ends: the agent can ask again for each file. The
  owner's pick is Codex's answer, and a park that ends without one is declined. A request Codex withdraws, or one
  Interrupt cancels, while it is being judged gets no journal line on Codex
  and is not parked; on Claude Code each judged request gets one. An unattended Codex runs in Full access, so it
  asks nothing for now. Each request is judged in the environment the agent's process started with: its
  whole shell environment, so `CDPATH`, `BASH_ENV`, `ZDOTDIR`, `ENV`, `IFS` or a `GIT_` variable there makes a command
  it changes not approved. Git is read again at each request that writes a file or runs git, in the Project's root and,
  when a worktree may have config of its own (`git config --worktree`, an `includeIf`), in the checkout each git
  command runs in and in each worktree of the Wave: a hook or a program the agent put into the git config since is
  seen; where the refs are kept in reftable, the default branch is read from git as well. When git lists the config
  but will not name the git folders (a path key with no value, such as `core.excludesFile`), they are read from the
  `.git` folder or file and its `commondir`, and only when git listed that repository's config; otherwise the facts
  count as unknown and no write or git command is approved. Writing a config file the
  environment names (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `XDG_CONFIG_HOME/git/config`), even an empty one, is
  never approved, as writing `.git/config`. A request that only reads, and runs no git, reads no git. Git in a worktree
  whose `.git` file or `commondir`
  names a git folder other than the Project's, or cannot be read, is judged as git whose hooks are not known: a command
  a hook or the config could change is not approved. Writing a config file git reads — one an
  `include.path` or `includeIf` names too, also before it exists — is never approved, as writing `.git/config`.
- In Shadow and On the run's agent (Claude Code, or Codex's app-server) starts with the run's own temporary folder as `TMPDIR`
  (`<data folder>/autopilot-tmp/<run>`) and a git environment: `GIT_CONFIG_PARAMETERS` turns off the owner's
  `log.showSignature` and `format.pretty` and keeps git from opening a bare repository above the folder, and
  `GIT_NO_LAZY_FETCH=1` keeps a partial clone from fetching through `core.sshCommand` while the repository has hooks or
  programs in its config. This does not stop hooks or filters themselves: while there are any, the policy approves git
  only for reading refs and objects. An agent whose process started without that environment (in Off, or before the
  repository got a hook) gets no git approved. On macOS `mktemp -d` ignores `TMPDIR`, so a folder it makes is outside
  every root; `mkdir -p "$TMPDIR/<name>"` is approved (not on Codex, where no variable has a known value), and the hint of a refusal in the home folder names it. In Off
  the agent starts as before, with neither. The folder is removed when the run ends; a run that could not start its
  policy has none. A Session another run took over keeps its folder, as does a crash or a quit;
  such folders go the next time worfy starts.

### How it works

The policy sees only the requests the agent asks. In `bypassPermissions` Claude Code runs most commands without asking,
so Auto-approval makes a run no less safe than `bypassPermissions` is: it only says yes to part of what used to get no.
The decision and its reasons are recorded in [ADR-0098](../adr/0098-approval-policy.md).

### Implementation

#### Modules

The modules of the Auto-approval item of the Modes menu are listed on the [Sessions](sessions.md#implementation) page,
and those of the counters of a run's decisions on the [Flight Recorder](flight-recorder.md#modules) page.

#### Tests

| Test | Covers |
|---|---|
| `test/unit/auto-approve-shell.test.ts` | The parser of a shell command for Auto-approval: the examples of the spec, each construct outside the grammar, words and quotes, the variables a command surely gets, Git Bash on Windows. |
| `test/contract/auto-approve-shell-sh.test.ts` | The parser against real shells (sh, bash, dash and zsh where installed, Git Bash on Windows): the words it reads are the words the shell passes. |
| `test/unit/auto-approve-policy.test.ts` | The approval policy: hard deny in every mode, questions, commands outside the grammar, each allow rule, the attacks of the spec (delete everything, a link to the home folder), git config and hooks, other worktrees and the default branch, Windows paths, the hints. |
| `test/unit/auto-approve-roots.test.ts` | The roots and hard areas: links and globs on disk, the folder of `mktemp -d`, roots recorded at the start and moved since, what a copy brings along, Windows path forms. |
| `test/unit/auto-approve-run.test.ts` | The policy of a run: its git environment and what it reads of the repository, the context of each request, the command and the targets as the journal keeps them, the Claude driver by mode, and no write into the Project. |
| `test/unit/auto-approve-park.test.ts` | Park: the wait on the gate, the 60-minute limit, a stop of the run (also while the request is on its way), the notification. |
| `test/unit/auto-approve-summary.test.ts` | The decisions of a run in its journal, their counters for Run history and the line in the Orchestrator's chat at the end of a run. |
| `test/contract/auto-approve-claude.test.ts` | Auto-approval of an unattended Claude Code Session: Off unchanged byte for byte, Shadow, On, a switch during the run, the run's environment, a policy that cannot start or throws, a parked request of a background task, a Stop during a park. |
| `test/contract/auto-approve-codex.test.ts` | The same on Codex over the fake app-server: Off, Shadow, On, the variables pinned in Codex's shell and the owner's `include_only` that may drop them, the login-shell wrapper, a request closed while judged, a park and its ends, a file change with a `grantRoot`. |
| `test/contract/auto-approve-setting.test.ts` | The mode in `app-settings.json`: per Project, garbage read as Off, writes only through its channel, an edit made outside worfy, a Linked machine, the debugging port and the inspector. |
| `test/e2e/auto-approve.spec.ts` | The built app under Playwright's debugging port: the Modes menu shows Off in force with the reason, the saved mode is read at start, nothing is written. |
