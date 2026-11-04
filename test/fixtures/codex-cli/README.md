# Answers of the Codex CLI

Live answers of the Codex CLI that worfy runs for the Harness in Codex (`src/main/harness/codex-install.ts`).
The fake `codex` of the contract tests prints the same shapes.

- `plugin-list-0.166.0.json` — `codex plugin list --json` of Codex 0.166.0 on macOS, recorded 2026-11-04
  (worfy-multi-vendor ticket 46), trimmed and with ids replaced: the home folder is `/Users/me`, only the
  local plugins and two remote ones (`github`, `plugin-management`) are kept, and each remote `source.id` is
  a placeholder (`plugin_connector_example_<n>`). Every field and value kind of the live answer is still
  there. Shape:
  `{ "installed": [...], "available": [...] }`, a plugin is
  `{ pluginId: "name@marketplace", name, marketplaceName, version, installed, enabled, source, ... }`.

`codex plugin marketplace list --json` of the same Codex answers
`{ "marketplaces": [{ "name", "root", "marketplaceSource" }] }` (keys only, no recording kept).
