# first-run-tools

Stand-ins for the tools the first-run screen checks (worfy-harness ticket 19): `claude`, `gh`,
`node`, `jq`, `git`, `npm`, `qmd`. Each is a `/bin/sh` script that uses shell built-ins only (and
`/bin/ln` in `npm install`), so a PATH with nothing else on it still runs them. Every call appends
`<tool> <arguments>` to `$FIRST_RUN_TOOLS_LOG` when it is set. A test puts the tools it wants on
the PATH (links in a temporary folder): a tool left out is "not installed".

Windows cannot start a `#!/bin/sh` script, so each tool also has a Node port, `<tool>.mjs`, with
the same answers and the same variables (`stand-in.mjs` holds the call log). On Windows
`test/contract/first-run-checks.test.ts` puts a `<tool>.cmd` on the PATH that runs the port with
the tests' node, so the checks find and start it as they find npm's `claude.cmd`; the installer runs
`claude.mjs` by its path (src/main/program.ts). There `npm install -g` writes a `qmd.cmd` into
`$FAKE_NPM_BIN` in place of the link. On macOS and Linux the `/bin/sh` scripts are used, as before;
a change to one of them goes into its port too.

| variable | tool | meaning |
|---|---|---|
| `FIRST_RUN_TOOLS_LOG` | all | the call log |
| `FIRST_RUN_TOOLS_DIR` | `npm` | this folder: `npm install -g` links `qmd` from here |
| `FIRST_RUN_TOOLS_STATE` | `claude` | a folder with the plugin state: `marketplace` (the folder of the Harness copy), `plugin-version` (the installed `worfy`; empty — not installed), `marketplaces` (the names of the other marketplaces, a line each), `plugins` (the ids of the other installed plugins, a line each) |
| `FAKE_CLAUDE_FAIL` | `claude` | a call whose arguments start with it prints an error and exits 1 (`plugin install mattpocock-skills@`) |
| `FAKE_CLAUDE_VERSION` | `claude` | what `claude --version` prints (default `2.1.289`) |
| `FAKE_GH_ACCOUNT` | `gh` | the signed-in account; empty — `gh auth status` exits 1, not signed in |
| `FAKE_NODE_VERSION` | `node` | what `node --version` prints, without `v` (default `22.11.0`) |
| `FAKE_NODE_REAL` | `node` | the real node: every call but `--version` goes to it, so a Harness script, which worfy starts as `node <script>`, runs; unset — such a call prints an error and exits 2 |
| `FAKE_NPM_FAIL` | `npm` | `npm install` prints it to stderr and exits 1 |
| `FAKE_NPM_BIN` | `npm` | where `npm install -g` puts `qmd` (a folder on the PATH) |
| `FAKE_NPM_PREFIX` | `npm` | what `npm prefix -g` prints |
| `FAKE_QMD_PULL_FAIL` | `qmd` | `qmd pull` prints it to stderr and exits 1 |

`gh auth login` prints `fake gh: auth login started` and exits 0: the e2e test looks for that line
in a Terminal Node. `claude plugin list | marketplace list | marketplace add | install | update |
uninstall` keep the state of the `worfy@worfy-harness` plugin and of the plugins it depends on in
`$FIRST_RUN_TOOLS_STATE`, as the stub `claude` of `test/e2e/harness-install.spec.ts` does:
`marketplace add <folder>` is the Harness copy, `marketplace add <owner>/<repo>` any other
marketplace, known by the repository's name; a plugin of a marketplace that was not added is not
installed (exit 1); every other plugin is listed with version `1.0.0`. Nothing reaches the network.
