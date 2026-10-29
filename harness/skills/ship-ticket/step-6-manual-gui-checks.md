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
