# first-run-tools

Stand-ins for the tools the first-run screen checks (worfy-harness ticket 19): `claude`, `gh`,
`node`, `jq`, `git`, `npm`, `qmd`. Each is a `/bin/sh` script that uses shell built-ins only (and
`/bin/ln` in `npm install`), so a PATH with nothing else on it still runs them. Every call appends
`<tool> <arguments>` to `$FIRST_RUN_TOOLS_LOG` when it is set. A test puts the tools it wants on
the PATH (links in a temporary folder): a tool left out is "not installed".

| variable | tool | meaning |
|---|---|---|
| `FIRST_RUN_TOOLS_LOG` | all | the call log |
| `FIRST_RUN_TOOLS_DIR` | `npm` | this folder: `npm install -g` links `qmd` from here |
| `FIRST_RUN_TOOLS_STATE` | `claude` | a folder with the plugin state (`marketplace`, `plugin-version`) |
| `FAKE_CLAUDE_VERSION` | `claude` | what `claude --version` prints (default `2.1.289`) |
| `FAKE_GH_ACCOUNT` | `gh` | the signed-in account; empty — `gh auth status` exits 1, not signed in |
| `FAKE_NODE_VERSION` | `node` | what `node --version` prints, without `v` (default `22.11.0`) |
| `FAKE_NPM_FAIL` | `npm` | `npm install` prints it to stderr and exits 1 |
| `FAKE_NPM_BIN` | `npm` | where `npm install -g` puts `qmd` (a folder on the PATH) |
| `FAKE_NPM_PREFIX` | `npm` | what `npm prefix -g` prints |
| `FAKE_QMD_PULL_FAIL` | `qmd` | `qmd pull` prints it to stderr and exits 1 |

`gh auth login` prints `fake gh: auth login started` and exits 0: the e2e test looks for that line
in a Terminal Node. `claude plugin list | marketplace add | install | update` keep the state of the
`worfy@worfy-harness` plugin in `$FIRST_RUN_TOOLS_STATE`, as the stub `claude` of
`test/e2e/harness-install.spec.ts` does.
