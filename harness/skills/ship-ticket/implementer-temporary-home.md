# implementer, step 5: Temporary HOME

Plugin root: `CLAUDE_PLUGIN_ROOT` in this file is the plugin folder, the one that holds `bin/` and `skills/`: the path you read this file from, without `/skills/ship-ticket/<this file>`. Claude Code spells it out only in SKILL.md and the agent definitions, and Bash may have it empty: in every command below put that folder in its place, or start the command with `export CLAUDE_PLUGIN_ROOT=<that folder>;`.

**Temporary HOME.** With `Temporary HOME: yes` in the brief, run both commands of this step with
HOME in a temporary folder, by this recipe:
```bash
H="$(node "${CLAUDE_PLUGIN_ROOT}/hooks/eval-env.cjs" harness-home)"   # the real Harness home, before HOME changes
T="$(mktemp -d)"; TW="$(cd "$T" && { pwd -W 2>/dev/null || pwd; })"   # TW: the folder as Windows names it (Git Bash)
: > "$T/.zshenv"; : > "$T/.zprofile"; : > "$T/.zshrc"   # without them zsh -ilc waits for the new-user prompt
( export HOME="$T" USERPROFILE="$TW"; <commands.verify> ); echo "EXIT=$?"
( export HOME="$T" USERPROFILE="$TW" HARNESS_HOME="$H"; node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast </dev/null ); echo "EXIT=$?"
```
`H` is the Harness home as the Harness scripts resolve it — `HARNESS_HOME`, else
`EVAL_HARNESS_HOME` of an eval run, else `.claude/worfy-harness` in the home folder — read before
HOME changes. Node takes the home folder from HOME, and on Windows from USERPROFILE, so both
point at the temporary folder; under Git Bash USERPROFILE gets the Windows spelling of it
(`pwd -W`). The three empty rc files keep `zsh -ilc` (a login shell that code and tests start to read
the user's environment) from stopping at the setup prompt that zsh shows a new user when its
build ships the new-user script: without them such a test hangs until its timeout. `HARNESS_HOME`
points the gate at the real registry, `<HARNESS_HOME>/gate/config.json`; without it the gate
under a temporary HOME finds no registry, prints `[gate] not verified: …` (the registry cannot be
read) and exits 3. A registry still in its old place in the home folder is not found under a
temporary HOME: give its path in `CLAUDE_GATE_CONFIG` for that run. An exit 3 of the gate under a
temporary HOME without `HARNESS_HOME` is an error of the run's environment, not of the code: run
the gate again by the recipe, and do not take that exit 3 for the gate's verdict. With
`HARNESS_HOME` on the real Harness home the gate writes its verdict, markers and cache there
(`<HARNESS_HOME>/gate/state`), as it does without a temporary HOME. That write is allowed
whatever the brief's line "Write to ~/.claude" says: it is the Harness home, not the transcripts
in `~/.claude/projects`.
