# Terminal

Two Features. **Terminal** is a Node with the user's interactive shell. **Terminal AI** is help from a Claude model
in the input line of that shell. Terms are explained in [Concepts](concepts.md).

## Terminal

### Behaviour

A Terminal is a Node on the Canvas with a real shell in it. It is for the user: agents do not use it.

**Creating and closing.** "New terminal" in the Canvas context menu creates the Node. Its default size is 560 by 340
pixels. The shell starts in the root folder of the Project, on macOS with the environment of the user's login shell. The
user cannot choose another folder for the start, and each Node has exactly one shell. The close button in the header, or
any other way the Node leaves the Canvas, ends the shell. A locked Node has no close button.

**Which shell.** On macOS it is `$SHELL -l`, or `/bin/zsh -l` when the variable is not set. The header shows the name
of the shell file, for example `zsh`.

**The shell lives longer than its view.** The shell keeps running when the Node scrolls out of sight, when the Canvas
hides behind the Session view and when the window reloads. The next view redraws the output that main kept: the last
256 KB, at the sizes of the terminal it came at. The view itself keeps 5000 lines of scrollback.

The shell ends in these cases:

- The Node leaves the Layout, by any route.
- The Project leaves the list.
- The last window or connection that opened the shell goes away.
- worfy quits. Quitting waits until every shell has exited, for at most 3 seconds.

After worfy restarts, the Node starts a new shell in the same folder. The old output is gone.

**States.** The header shows these states:

- A shell that is starting or running shows no exit mark.
- A shell that exited on its own stays exited, also across a reload. The header shows `exit <code>` and a Restart
  button, and the last output stays on the screen. Nothing starts a new shell until the user presses Restart.
- A shell that could not start shows "The terminal could not start" with the reason.

**One shell on several screens.** Several windows, and a Linked machine with write access, can open the same shell.
Each of them gets all the output and may type. The shell has one size: the size of the screen that typed or clicked
in it last. Resizing a view on another screen only remembers that size until that screen types or clicks. Restart on
one screen starts the new shell for all of them.

Focus mode shows the same shell in a second view of the same window. The view mounted last sets the size, and leaving
focus mode gives the shell back the size of the Canvas Node.

A Linked machine with read-only access does not get the Terminal at all. A stand-in in the Node says that the output
is not shared with it. It cannot start the shell, and the output does not leave the Machine.

**Input and the Canvas.** Terminal size is limited to 20–500 columns and 5–300 rows. A mouse selection lands on the
right characters at any Canvas zoom, and a drag that began in one Terminal stays in it. The wheel over a Terminal
moves the Canvas until the Node is active, that is, clicked and still selected. In an active Terminal the wheel goes
to xterm.js, the terminal emulator in the view. A pinch and ⌘ + wheel always zoom the Canvas. Esc inside a Terminal
belongs to the shell and does not deselect the Node.

Colours follow the light or dark appearance of the system, without a new terminal.

**A typed command.** The First run checks can open a Terminal with `gh auth login` for the GitHub sign-in. main types
the command into the new shell after its first output, or after one second of silence. Only commands from a fixed list
are accepted, the list has this one command, and attaching to a shell that already runs types nothing.

#### Windows

- The shell is PowerShell: `pwsh.exe` from the Path, including an MSIX install, otherwise Windows PowerShell. `cmd.exe`
  is never used, and `$SHELL` is not read.
- No login shell is read, because Windows has none. The shell starts with an environment built from the variables of the
  Windows session and the registry.
- "Project settings…" has a "Terminal shell" field with PowerShell and Git Bash. The choice applies to the next shell:
  Restart, or a new Node. When Git Bash is not found, the field says so and PowerShell starts. Settings that cannot be
  read also give PowerShell.
- Inside a Terminal, worfy's shortcuts with Ctrl do not match, so Ctrl+K, Ctrl+F and Ctrl+C reach the shell. The exception
  is zooming the Canvas: Ctrl+= and Ctrl+- still zoom, or do nothing in a tile of focus mode, and only Ctrl+\_ stays with the shell. On macOS nothing is given up,
  because worfy's shortcuts use ⌘.
- Closing a Node ends every process under the shell, including one started with `Start-Process` and one two levels down,
  and then the shell. Git Bash gets SIGHUP first, so bash writes its history.
- Quitting worfy waits for at most 6 seconds.
- Output that arrives after a shell exited is dropped. On macOS it is kept and shown.

### How it works

- **main owns the shell, a view only draws it.** This is why the shell survives a remount, and why several screens can
  show one shell ([ADR-0053](../adr/0053-several-screens-on-one-project.md)). The renderer names a Project and a Node,
  never a folder or a program: main starts a shell only for a Node of kind `terminal` in the Layout of that Project.
- **Output has a running length.** Each chunk carries `end`, the length of all output so far. The answer to an open
  carries the `end` of its replay, so a view drops what it already has.
- **The environment** is the same as for Sessions, on macOS that of the login shell
  ([ADR-0007](../adr/0007-claude-code-launch-environment.md)), plus `TERM`, `COLORTERM`, `TERM_PROGRAM=worfy` and `PWD`, and
  on macOS `LANG` when it is not set.
- **A program's questions to its terminal are answered once.** Programs ask the terminal for the cursor position, the
  device attributes, a mode or a setting, and wait. A view is not always mounted, and two views would answer twice. So
  main follows the output on its own headless screen and answers these itself. The same answers from a view are dropped.
  A colour query stays with the views, because the answer depends on their theme: main passes the first answer, and with
  no view mounted such a query gets none.
- **A flood of output cannot stall main.** The headless screens parse in worker threads. When a screen falls too far
  behind, main pauses that shell's output until the screen catches up.
- **Shell integration, for zsh only.** A zsh started for a Terminal Node gets `ZDOTDIR` pointing at a temporary folder of
  worfy. The files there read the user's own startup files, unchanged, and then load worfy's script. The script prints
  OSC 633 sequences, the format of VS Code's shell integration, which say where the prompt is, which command runs, in
  which folder and how it ended. Unlike VS Code, every sequence carries a nonce that programs in the shell do not know, so
  they cannot forge the end of a command. A line that starts with a space gets no command text. The history stays in the
  user's file, and a zsh started inside the Terminal runs without worfy. Other shells run without any integration.

#### Windows

A shell runs on the console of the node-pty package and not on the console of the system
([ADR-0063](../adr/0063-windows-shells-run-on-the-node-pty-console.md)). That console asks for the device attributes
when a shell starts. main answers once and takes the request out of the output, before it is kept or sent to a screen.
Because PowerShell draws its line at absolute positions after a resize, a new view writes the kept output with the
resizes in their places. Windows has no process groups and no SIGHUP, so a close runs a helper that ends what is under
the shell, then closes the pseudo-console. If the shell has not reported its exit within 5 seconds, the Terminal is closed
without it. Why PowerShell is the default: [ADR-0054](../adr/0054-full-windows-port.md).

Windows has no login shell to ask for the environment, so worfy builds it the way a new sign-in does: the persistent variables
of the machine and the user from the registry, on top of a short list of variables that Windows sets for the session
([ADR-0057](../adr/0057-agent-environment-on-windows.md)). Nothing else of the process that started worfy reaches the shell,
with one exception: when the registry cannot be read, for example because a policy forbids `powershell.exe`, the shell gets
only those session variables, the `Path` of worfy's process and, when Git Bash is found, `CLAUDE_CODE_GIT_BASH_PATH`, the
variable through which Claude Code gets Git Bash for its Bash tool.

### Implementation

| What | Where |
|---|---|
| The IPC contract of the `terminal` domain | `src/shared/ipc/terminal.ts` |
| Handlers, and what ends a shell (Layout, Projects, quit) | `src/main/ipc/terminal.ts` |
| The registry of shells: start, subscribers, size, close | `src/main/terminal/pty.ts` |
| The environment, shared with Sessions | `src/main/agent/env.ts` |
| node-pty on Windows, and the helper that ends processes | `src/main/terminal/windows-pty.ts` |
| The kept output and its sizes | `src/main/terminal/replay-buffer.ts` |
| Answers to a program's requests | `src/main/terminal/cursor-answers.ts`, `src/shared/terminal/cursor-answer.ts` |
| The console's own request on Windows | `src/main/terminal/console-request.ts` |
| Reading OSC 633 and the alternate screen | `src/main/terminal/osc.ts` |
| worfy's `ZDOTDIR` folder | `src/main/terminal/shell-integration.ts` |
| The zsh scripts | `src/main/terminal/zsh` |
| The Node: xterm.js, status, header | `src/renderer/canvas/nodes/TerminalNode.tsx` |
| Writing the replay; two views; mouse at zoom; alternate screen | `src/renderer/canvas/nodes/terminal-replay.ts`, `src/renderer/canvas/nodes/terminal-views.ts`, `src/renderer/canvas/nodes/terminal-mouse.ts`, `src/renderer/canvas/nodes/terminal-alt-buffer.ts` |
| Telling typing from a terminal's answer | `src/renderer/canvas/nodes/terminal-user-input.ts` |
| The stand-in for read-only access | `src/renderer/canvas/ReadOnlyTerminal.tsx` |
| The shell setting of a Project | `src/renderer/shell/ProjectSettings.tsx`, `src/shared/projects/action-templates.ts` |
| Keys of the shell on Windows | `src/renderer/platform.ts`, `src/renderer/shortcuts/match.ts`, `src/shared/shortcuts.ts` |

**Data flow.** The Node calls `terminal.open` with its Project, Node id and size. `TerminalRegistry` starts the shell, or
attaches the caller as a subscriber, and answers with the replay, `end` and the sizes. From then on, for every chunk from
node-pty, the registry appends it to `ReplayBuffer`, sends `terminal.output` to each subscriber, feeds `ShellTracker` for
a zsh with the integration, then posts it to the headless screen. Typing and pasting go back on `terminal.input`, and a
click on `terminal.takeSize`. An answer of xterm.js to a program goes on `terminal.input` marked `reply`, which does not
take the size.

The "Sign in with gh" dialog of the account step uses the same registry class with `gh` itself as the process, without a
shell and without the integration. That registry is in `src/main/github/accounts.ts`, the dialog in
`src/renderer/projects/GithubAccount.tsx`, and its handlers and the registry's instance in `src/main/ipc/projects.ts`.

**Main tests.**

- `test/e2e/terminal.spec.ts`: the whole Feature in the app, including several windows, zoom, restart and the packaged app.
- `test/contract/terminal.test.ts`: the channels on a real pty, the size rule and the wiring to Layout, Projects and quit.
- `test/contract/terminal-shell-integration.test.ts`: startup files, history, the nonce, no integration elsewhere.
- `test/contract/terminal-cursor.test.ts`, `test/unit/terminal-replies.test.tsx`: answers to programs, colour queries, floods.
- `test/unit/terminal-osc.test.ts`, `test/unit/terminal-replay.test.ts`: the parser and the replay.
- `test/contract/link-access.test.ts`, `test/e2e/linked-read-only.spec.ts`: access of a Linked machine.
- Windows: `test/contract/terminal-windows.test.ts`, `test/contract/terminal-git-bash-close.test.ts`,
  `test/unit/terminal-shell.test.ts`, `test/unit/terminal-console.test.ts`, `test/unit/console-request.test.ts`,
  `test/unit/terminal-git-bash-close.test.ts`.

## Terminal AI

### Behaviour

Terminal AI proposes text for the input line of a zsh Terminal. It never runs a command: Enter stays with the user. It
has four functions, each with its own switch in Settings. It never prints into the output of the Terminal: the line
editor of zsh draws the grey text.

**Suggestion.** Grey text after the cursor that continues the line. It comes from two sources:

- **The history of commands.** On every change of the line, zsh looks for the last command that starts with the typed
  text. No process starts and worfy is not asked. The same grey text shows on every screen of the shell.
- **The model.** When the history has nothing and the line stays unchanged for 600 ms, the model is asked. Its answer is
  shown only if it starts with what was typed. Typing cancels the question, and a late answer is not shown.

The model is not asked about an empty line, a line that starts with a space, a line that starts with `# `, a line worfy
inserted or a line taken from a Suggestion, until the user changes it.

| Key | Effect |
|---|---|
| → at the end of the line | Takes the whole Suggestion. Elsewhere in the line it moves the cursor as usual. |
| Alt+→ | Takes one word. Without a Suggestion it moves one word forward. |
| Esc | Hides the grey text until the line changes, then does what Esc did before (leaves insert mode in the vi keymap). |

Typing the start of the grey text keeps the rest of it grey. When the user has zsh-autosuggestions loaded, worfy draws no
Suggestion of its own and does not ask the model. The other functions work as usual.

**Next command.** On the first prompt after a command, while the line is empty, the model proposes the next command in
grey after a pause of 800 ms. Typing during the pause or before the answer cancels the question. → takes the answer. Enter
on the empty line runs nothing, because the grey text is not part of the line. Nothing is asked on the first prompt of the
shell, after an empty line or Ctrl+C, after a command that starts with a space, or on a prompt that already has text in it.

**Command request.** A request in words, answered by a command in the input line. There are two ways to ask:

- Type `# ` and words, then press Enter. The line does not run and does not go into the history. A grey "asking Claude…"
  appears, and any key before the answer cancels the request and leaves the line. `#comment` without the space and `# `
  without words are ordinary lines.
- On a macOS screen, press ⌘I in a Terminal. A panel opens under the first row of the screen. Enter asks. When the command
  is in the line, the panel closes and the focus goes back to the terminal. Esc closes the panel, with the same result for
  the focus. On a refusal, in a busy Terminal or with an empty field, the panel stays open and the focus stays in its field.
  The panel also sends the line typed in the shell, read off the screen. When the panel is not available (no zsh connected
  to Terminal AI, or Command request off), ⌘I stays with xterm.js and the shell receives nothing. Ctrl+I always reaches the
  shell: in a terminal it is Tab.

A refusal is a short note in the line or in the panel. Fix shows the same texts in its toast:

| Note | Cause |
|---|---|
| Limits reached until 14:20 | The Limits reject the request. Another day is named. |
| Terminal AI is off | The function is off in Settings. |
| Terminal is busy | A command is running, or a full-screen program holds the Terminal. |
| Claude did not answer in time | The 30 seconds ran out. |
| Claude had no command for that | The answer was empty. |
| Claude could not answer | Any other failure. |
| The shell is not ready yet | The shell has not reported its folder. |

**Fix.** After a command that ended with an exit code other than 0, the header of the Node shows a Fix button, while zsh
is connected to Terminal AI and Fix is on in Settings. It stays until a new command starts. A command that started with a
space never brings it. Pressing it asks for a corrected
command and puts it into the line. The focus returns to the terminal, so Enter runs it, and the button goes away on every
screen. While the request runs the button reads "Fixing…". A refusal shows in an error toast that names the Terminal,
until the next press or until the toast is closed.

**Settings.** The section "Terminal AI" belongs to the Machine, so it applies to all Projects there.

| Switch | Default | Note |
|---|---|---|
| Terminal AI | on | All functions. Rows under it say "Off while Terminal AI is off." |
| Suggestion | on | Also turns off the Suggestion from history. |
| Ask Claude when history has nothing | on | Only the model behind Suggestion. |
| Next command | on | |
| Next command model | Sonnet | Sonnet or Haiku. |
| Command request | on | |
| Fix | on | |

A change reaches running shells at once: turning off Suggestion takes the grey text from a zsh that already runs.

**Limits.** Every request is reported to the Limits meter. Terminal AI stops by itself and starts again without a new
request when the window resets:

- Suggestion and Next command stop while the 5-hour window is used above 80%, or while any window in force has the status
  `allowed_warning` or `rejected`. They stop silently, while the Suggestion from history goes on.
- Command request and Fix stop only on `rejected`.

A window whose reset time has passed does not count, and unknown Limits let everything through. A row in Settings shows
"Paused by Limits until 14:20" for a stopped function.

**What the model receives.**

- The line, the folder, up to 20 last commands of this Terminal, the git branch and the exit code of the last command.
- For Command request, the words as well. For Fix, up to 50 last lines of the failed command's output.
- Never environment variables, and no output for the other functions.

Every field is trimmed, and secrets of known shapes are replaced with `[redacted]`: tokens and keys, passwords in options
and URLs, values of variables whose name says they are secrets, private key blocks. A line or command that starts with a
space stays out of the context. Nothing goes out while a command runs, because what is typed then may be a password, or
while a full-screen program holds the Terminal. The log names each process start and the function and model of each
request. It never has the words, the line, the context or the answer.

**Linked machines.** The settings and the state are local to each Machine, and a Linked machine does not reach them. From a
Linked machine's screen with write access, Fix works on any system, and the panel works only on a macOS screen, because ⌘I
is a key of the screen. The Machine of the Terminal asks the model on its own subscription and within its own Limits.

#### Windows

A Terminal whose Machine runs Windows is never zsh, so none of the functions works in it. The Settings section is still shown,
with the hint "Works in zsh Terminals." From a Windows screen, in a Terminal of a Mac, Suggestion, Next command, the `# ` line
and Fix work. Only the panel does not, because the ⌘I shortcut exists on macOS only.

### How it works

- **It is not a Session.** Requests go to a separate Claude Code process through the Agent SDK. It has no settings of the
  user or Project, no MCP servers, no tools, no transcript and one turn, so the model can only answer with text. It signs in
  by subscription, without API keys. Each request runs in an empty folder of worfy's data folder, because worfy takes a
  process whose folder is inside a Project for a Session of that Project. Reasons: [ADR-0058](../adr/0058-terminal-ai-assist-process.md).
- **One process for all Terminals, one request per process.** The first request starts a spare process. A request takes it
  for one turn, the process is then closed and the next spare starts at once. A spare without requests for 10 minutes is
  closed. Since a request carries no history, a request of one Project holds no commands of another.
- **One request in flight.** Suggestion and Next command are automatic: a new automatic request cancels an automatic one.
  Command request and Fix are on demand: they cancel an automatic request and are never cancelled by one. A second on-demand
  request waits, and an automatic request is refused meanwhile.

| Function | Model | Time limit |
|---|---|---|
| Suggestion | Haiku, no thinking | 5 s |
| Next command | Sonnet at low effort, or Haiku by Settings | 8 s |
| Command request | Sonnet at low effort | 30 s |
| Fix | Sonnet at low effort | 30 s |

- **A Suggestion that would come late is dropped.** It ends when the model starts to think, or when the process could not
  apply the setting that turns thinking off.
- **A refused process.** When a process refuses a request before the prompt went out, Command request and Fix retry once by
  starting a new process, and Suggestion and Next command give up.
- **The answer is one command.** Its first line is taken, without backticks, a code block or a `$ ` prompt.
- **The shell is the client.** Line editing happens in zsh, so main cannot see the line. zsh widgets send it to main over a
  Unix socket, one message per line, and main answers with text to show or a line to insert. zsh draws the grey text itself,
  and Terminal AI writes nothing into the pty. Fix and the panel start with an IPC channel instead of a message from the
  shell, and they end with the same insert. Only an `insert` changes the line, and nothing presses Enter.
- **The link exists only while a line is edited.** zsh cannot keep a descriptor from the programs it starts. So the shell says
  `bye` and closes the connection before a command, and says `hello` again at the next prompt. main closes its side too. The
  same happens around functions worfy did not write that run at the prompt, such as a user's widget. An open question is then
  sent again under the same id, and main keeps it open meanwhile.
- **Access to the socket.** The file has mode 0600 in a folder of 0700. Each shell gets its own token, and a connection without
  a live, unused token is closed. The token stays in a shell variable that is not exported, so no program sees it.
- **Without the socket** the shell starts all the same, and the Suggestion from history goes on.

### Implementation

| What | Where |
|---|---|
| The model: process, queue, refusals | `src/main/terminal-ai/assist.ts` |
| What goes to the SDK | `src/main/terminal-ai/options.ts` |
| The Limits rule | `src/main/terminal-ai/limits-gate.ts` |
| The settings file, `terminal-ai.json` in the data folder | `src/main/terminal-ai/settings.ts`, `src/shared/terminal-ai/settings.ts` |
| Context, redaction, output tail | `src/shared/terminal-ai/context.ts`, `src/shared/terminal-ai/redact.ts`, `src/shared/terminal-ai/output-tail.ts` |
| Shell state into a request | `src/main/terminal-ai/input.ts` |
| The git branch, from `HEAD` and only then from git | `src/main/terminal-ai/git-branch.ts` |
| The socket and its tokens | `src/main/terminal-ai/socket.ts` |
| The messages | `src/main/terminal-ai/protocol.ts` |
| Routing an ask to a function | `src/main/terminal-ai/shell-link.ts` |
| Handlers of Suggestion, Next command, Command request | `src/main/terminal-ai/features` |
| Fix | `src/main/terminal-ai/fix.ts`, `src/main/ipc/terminal-ai-fix.ts`, `src/shared/ipc/terminal-ai-fix.ts` |
| The ⌘I panel | `src/renderer/canvas/nodes/TerminalAiRequest.tsx`, `src/main/ipc/terminal-ai-request.ts`, `src/shared/ipc/terminal-ai-request.ts` |
| Reading the typed line off the screen | `src/renderer/canvas/nodes/terminal-line.ts` |
| The Settings section | `src/renderer/settings/TerminalAiSection.tsx`, `src/renderer/settings/useTerminalAi.ts`, `src/main/ipc/terminal-ai.ts`, `src/shared/ipc/terminal-ai.ts` |
| The link and grey text in zsh | `src/main/terminal/zsh/rc.d/10-assist.zsh` |
| Suggestion, Next command and Command request in zsh | `src/main/terminal/zsh/rc.d/20-suggest-ai.zsh`, `src/main/terminal/zsh/rc.d/30-next-command.zsh`, `src/main/terminal/zsh/rc.d/40-command-request.zsh` |
| The fake backend for tests | `src/main/terminal-ai/fake-backend.ts` |

A new function that the shell asks for adds its switch in the settings, its time limit, prompt and title in
`src/main/terminal-ai/options.ts`, a module under `src/main/terminal-ai/features` and a script under
`src/main/terminal/zsh/rc.d`. The module and the script are found by a glob, so `ShellLink` and the startup files do not
change.

**Data flow of a Suggestion from the model.** `20-suggest-ai.zsh` waits for the pause and sends `ask <id> suggest <line>`.
`ShellLink` passes it to the handler of `suggest`, which builds the input from `ShellState` and calls `AssistService.request`.
The service checks the refusals, takes the spare process, finds the branch, runs `prepareContext` and claims the process. The
answer goes back as `show <id> <text>`, and `10-assist.zsh` draws it if that ask is still open.

**Data flow of a Fix.** `FailedCommands` keeps the failed command of each Terminal from the shell events. `terminalAi.fix.state`
and `terminalAi.fix.changed` tell the Node whether the button is there. `terminalAi.fix.run` calls `runFix`, and the answer goes
to the shell as `insert`. An answer that arrives after a new command started is dropped.

**The channels.** `terminalAi.state`, `terminalAi.setSettings` and `terminalAi.changed` are `local`. The `terminalAi.fix.*` and
`terminalAi.request*` channels are `project`, so they work with a Terminal of the Project.

**Testing without Claude.** With `WORFY_AGENT=fake` the app takes the file fake and never loads the SDK. Under vitest the real
backend throws before the SDK loads, so a test never spends the subscription.

**Main tests.**

- `test/contract/terminal-ai-assist.test.ts`: the process, the queue, the timeouts, refusals, Limits and the channels.
- `test/contract/terminal-ai-zle.test.ts`, `test/contract/terminal-ai-zle-prompt.test.ts`: zsh on a real shell: keys, socket,
  link around commands and widgets, what does not leak.
- `test/contract/terminal-ai-suggest.test.ts`, `test/contract/terminal-ai-next-command.test.ts`,
  `test/contract/terminal-ai-request.test.ts`, `test/contract/terminal-ai-fix.test.ts`: each function on a real zsh.
- `test/contract/terminal-ai-git-branch.test.ts`: the branch.
- `test/unit/terminal-ai-limits-gate.test.ts`, `test/unit/terminal-ai-options.test.ts`, `test/unit/terminal-ai-context.test.ts`,
  `test/unit/terminal-ai-redact.test.ts`, `test/unit/terminal-ai-protocol.test.ts`: the pure rules.
- `test/unit/terminal-ai-settings.test.tsx`, `test/unit/terminal-ai-request.test.tsx`, `test/unit/terminal-ai-fix-button.test.tsx`:
  the interface.
- `test/e2e/terminal-ai-history.spec.ts`, `test/e2e/terminal-ai-suggest.spec.ts`, `test/e2e/terminal-ai-next-command.spec.ts`,
  `test/e2e/terminal-ai-request.spec.ts`, `test/e2e/terminal-ai-fix.spec.ts`, `test/e2e/terminal-ai-settings.spec.ts`: the
  functions in the app, on the fake backend. They are skipped on Windows, except where the Settings section needs no zsh.
