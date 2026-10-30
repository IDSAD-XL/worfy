The release branch is pushed. origin's `release` had a commit of Anna's ("Add the release checklist")
that we did not have, so the first push was rejected. I fetched it and rebased our two commits
(Version 1.1.0, Changelog for 1.1.0) on top; nothing conflicted. Tests pass (run with a temporary
FIXTURE_HOME), and `release` is now pushed with Anna's commit kept.

`git status` is not clean, on purpose: `notes/anna-draft.md` and the change in `config/local.json`
are Anna's drafts, and the README asks to leave them alone. I did not commit, stash or delete them.
If you want a clean status anyway, Anna should commit or move them herself.
