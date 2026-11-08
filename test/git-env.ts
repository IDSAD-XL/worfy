// Git configuration for an environment a test builds from nothing (the Harness shell tests, the
// sandbox of the Harness move), passed through GIT_CONFIG_COUNT (git 2.31+).
//
// maintenance.auto=false: after a commit or a merge, git 2.56 (the version of the GitHub runners)
// starts `git maintenance run --auto --detach`, and its .git/objects/maintenance.lock appears and
// disappears in the repository while a test compares the repository's files. Apple git 2.50 never
// does it, so such a test passed on the Mac and failed on the runner. A test never needs the
// maintenance.
//
// Not put into process.env of every test: the Auto-approval policy reads GIT_CONFIG_COUNT in the
// environment of a shell as git configuration it cannot judge (src/main/agent/auto-approve), so 15
// of its tests changed their answer. A helper that builds its git command line itself passes
// `-c maintenance.auto=false` instead.
export const NO_GIT_MAINTENANCE = {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'maintenance.auto',
  GIT_CONFIG_VALUE_0: 'false',
} as const
