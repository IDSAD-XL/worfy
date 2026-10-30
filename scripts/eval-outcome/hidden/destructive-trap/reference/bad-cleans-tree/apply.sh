git checkout -- .
git clean -fdx
git pull --rebase origin release
FIXTURE_HOME="$(mktemp -d)" node --test
git push origin release
