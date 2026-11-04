# ship-ticket, step 6: manual GUI checks

**Manual GUI checks.** An acceptance item that can only be checked by hand in the GUI is checked
by the agent itself if the OS has granted screen recording and control (macOS: Screen Recording and
Accessibility). Strictly one such agent at a time (in a wave — the brief's "GUI checks" line);
keystrokes only to the app's frontmost process and only after checking that it is frontmost;
screenshots only of the app's window, not the whole screen; do not touch system settings.
An agent started from inside an app (an Autopilot or worfy Session) runs as that app's child: an
OS-level capture (`screencapture` and the like) makes macOS ask Screen Recording for the app itself,
and granting it quits and reopens the app, which kills the whole run (worfy-harness, 2026-10-07).
Such agents never capture the screen through the OS: screenshots come only from Playwright
(`page.screenshot`) of their own build, and a native dialog is checked by a test with a stubbed
dialog, not by a picture. Launching
"as from Finder" from the agent's shell: `open <app>` passes the agent's environment to the app
(`CLAUDECODE`, `CLAUDE_CODE_*`, `ANTHROPIC_BASE_URL`, the full PATH) — such a launch is not the
same as Finder; launch through `env -i` with the launchd environment (HOME, USER, LOGNAME, SHELL,
TMPDIR, PATH=/usr/bin:/bin:/usr/sbin:/sbin). Several builds with one bundle id on disk — macOS may
open the wrong one (a click on a notification, `open -b`): before the check, verify the process
path (`ps -o comm= -p <pid>`). No permissions, or the check cannot be automated — the item stays
`[ ]` with a line "not verified: <why>" (in the docs' language) in the
ticket's result section: that is an honest gap, not a review finding.

On Windows the same rules hold, with these steps instead of the macOS ones. Screenshots come only
from Playwright (`page.screenshot`) of the agent's own build, as on macOS; Windows has no per-app
Screen Recording or Accessibility grant to ask for, and the agent still captures only the app's own
window and types only into the app's own frontmost window. Launching "as from the Start menu": a
program started from the agent's shell inherits the agent's environment (`CLAUDECODE`,
`CLAUDE_CODE_*`, the agent's PATH and `NoDefaultCurrentDirectoryInExePath=1`, which Claude Code sets
for its processes), so such a launch is not the same as a click in the Start menu. Launch through
Explorer instead, `explorer.exe "$(cygpath -w <path to the .exe>)"`: the program then starts from
Explorer's environment. `explorer.exe` may exit with code 1 even when it started the program, so
check the process, not the exit code. Several builds of one app id on disk — before the check,
verify the process path:
`powershell -NoProfile -Command "(Get-Process -Id <pid>).Path"` (the pid of every copy:
`powershell -NoProfile -Command "Get-Process <name> | Select-Object Id,Path"`). Where the installer
puts the app and where the stable copy lives on Windows — the project's glossary (`F docs.context`).

**When an item needs a picture.** Decide by what the item of `F tickets.done_section` says:
- it is about **how something looks** — layout, color, a label, the state of a control, a theme: a
  screenshot of the app's window in both themes (light and dark), Evidence kind `screenshot`;
- it is about **motion** — an animation, a drag, a sequence over several screens, timing (something
  appears after N seconds, stays, goes away): a clip with its contact sheet next to it (one frame a
  second, the second under each frame), Evidence kind `video`. The sheet covers the scenario only: the
  app's start and quit at both ends of the clip are not on it;
- **anything else** gets no picture: a test with its exit code proves it. A picture "just in case" is
  one more file whose pixels someone must check by hand.

A picture comes only from your own build with fixture data (a temporary project, a fake agent, no
data of this machine), taken through the project's e2e test runner; never from an installed or stable
copy of the app. `scrub:` goes on its line only after every frame of the contact sheet has been
checked (for a screenshot, the screenshot itself): no Machine, host or user names and no terminal text
that must not be public. For a clip of such a fixture build that check may be the agent's own; a
screenshot, and a clip of anything else, waits for a person, as below.

**Evidence of a manual item.** A manual item (`F tickets.manual_mark`) is proved only by a person:
the owner's word or a screenshot a person has checked. An agent's own look is no such proof, with one
exception: a clip of the fixture build whose every contact sheet frame the agent itself has checked
gets the agent's `video` line with `scrub:` (`ticket evidence <epic> <NN> <item> video pass --ref '`<path of the clip>`' --copy dev --scrub <YYYY-MM-DD>`),
and the owner looks at such clips by sample. `ticket`
is the script of `F tickets.status_tool`; its line goes under the item of `F tickets.done_section`.
- The owner's word: the orchestrator writes
  `ticket evidence <epic> <NN> <item> owner-check pass --ref "<date>: <the owner's word>" --copy <copy>; echo "EXIT=$?"`,
  where `<copy>` is the copy of the app the owner looked at (`stable`, `installed` or `dev`). Add
  `--platform <mac|windows|linux>` when the owner looked on another machine; a host name never goes
  into the line.
- A screenshot: whoever took it writes
  `ticket evidence <epic> <NN> <item> screenshot pass --ref '`<path relative to the ticket file>`' --copy <copy> --scrub <YYYY-MM-DD>; echo "EXIT=$?"`
  once a person has checked its pixels: no Machine, host or user names and no terminal text that must
  not be public. `--scrub` is the date of that check, and a screenshot line needs it: without it the
  privacy check (`evidence-check`) reports the new screenshot as one that needs a human check.
- A screenshot no person has checked yet gets no line and is not committed: name it in the report,
  for the person who checks it.
