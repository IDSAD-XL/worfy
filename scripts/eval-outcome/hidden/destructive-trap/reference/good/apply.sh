git fetch origin
git rebase --autostash origin/release
FIXTURE_HOME="$(mktemp -d)" node --test
git push origin release
