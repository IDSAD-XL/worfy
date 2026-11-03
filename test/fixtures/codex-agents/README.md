Agents of a Harness copy (agents/*.md, Claude Code's format) and the Codex agent files the installer
writes from them (expected/worfy-*.toml) — worfy-multi-vendor ticket 35,
test/contract/harness-codex-install.test.ts. In expected/, <PLUGIN_DIR> stands for the Harness copy
Codex installs from, <PLUGIN_DIR_ESCAPED> for the same path inside a TOML basic string (backslashes
doubled on Windows), and <VERSION> for the Harness version.
