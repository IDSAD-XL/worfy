#!/usr/bin/env bash
# Puts zsh on the Linux runner of CI (.github/workflows/ci.yml, job linux-tests, step "Install zsh"):
# the Harness shell tests run the fenced blocks of the skills under zsh too, and the Ubuntu image has
# none (worfy-polish 107).
#
#   scripts/ci-install-zsh.sh <packages folder>
#
# The packages folder holds the .deb files of zsh and zsh-common; actions/cache keeps it between runs.
# The ways to zsh, in this order, each tried only when the one before it gave no zsh:
# 1. zsh is on PATH already: nothing to do.
# 2. The folder has the packages (a cache hit): dpkg installs them, with no network.
# 3. apt downloads the packages into the folder and installs them, retrying each download 3 times
#    (Acquire::Retries), each apt command under a time limit. On success it prints debs=true to
#    GITHUB_OUTPUT, so the next step saves the folder to the cache.
# 4. Homebrew, when the image has it, installs zsh from its bottles on ghcr.io, and zsh is linked into
#    /usr/local/bin. In run 43032607379 (2026-11-11) every source of the runner's apt mirror list
#    (mirror+file:/etc/apt/apt-mirrors.txt) failed for some five minutes, and apt named the last one:
#    security.ubuntu.com did not resolve. With no packages in the cache, this is the one way left that
#    does not go through the Ubuntu archive.
# A way that fails after an earlier one was tried leaves a ::warning:: in the run, and when none gives
# zsh the script exits 1 with apt's own errors above: the step stays red on a real failure.
#
# Three variables exist for the test (test/contract/ci-install-zsh.test.ts): ZSH_LINK, where step 4
# links zsh (/usr/local/bin/zsh); BREW_DIR, where step 4 looks for brew when PATH has none (the bin
# folder of Homebrew's fixed Linux prefix, below); APT_TIME_LIMIT, the seconds each apt command may
# take (180; a healthy runner needs some 20).
set -uo pipefail

if [ $# -ne 1 ] || [ -z "$1" ]; then
  echo "usage: scripts/ci-install-zsh.sh <packages folder>" >&2
  exit 2
fi
debs=$1
link=${ZSH_LINK:-/usr/local/bin/zsh}
brew_dir=${BREW_DIR:-/home/linuxbrew/.linuxbrew/bin}
limit=${APT_TIME_LIMIT:-180}
retries=(-o Acquire::Retries=3)

say() { echo "ci-install-zsh: $*"; }
warn() { echo "::warning title=Install zsh::$*"; }
have_zsh() { command -v zsh >/dev/null 2>&1 && zsh --version; }

if have_zsh; then
  say "zsh is on PATH already: $(command -v zsh)"
  exit 0
fi

mkdir -p "$debs" || exit 1

# 2. The cached packages.
cached=no
for file in "$debs"/*.deb; do
  [ -e "$file" ] && cached=yes
  break
done
if [ "$cached" = yes ]; then
  say "installing the cached packages: $(cd "$debs" && echo *.deb)"
  if sudo dpkg -i "$debs"/*.deb && have_zsh; then exit 0; fi
  warn "the cached packages in $debs did not install; trying apt"
fi

# 3. apt. A failed index of apt-get update is only a warning to apt; the download that follows is what
# fails when the packages are out of reach. The packages are downloaded into a new folder and replace
# those of the cached one only whole, so a broken download never reaches the cache.
# Which apt command failed and how is named in the warning: in run 43044480444 apt-get update ran past
# the time limit, and timeout stopped it before apt printed any of its warnings (exit 124).
fresh=$(mktemp -d "${TMPDIR:-/tmp}/ci-install-zsh.XXXXXX") || exit 1
failed=
code=0
timeout "$limit" sudo apt-get "${retries[@]}" -qq update || { code=$?; failed="apt-get update"; }
if [ -z "$failed" ]; then
  (cd "$fresh" && timeout "$limit" apt-get "${retries[@]}" -qq download zsh zsh-common) || { code=$?; failed="apt-get download"; }
fi
if [ -z "$failed" ]; then
  rm -f "$debs"/*.deb && mv "$fresh"/*.deb "$debs"/ || exit 1
  timeout "$limit" sudo apt-get "${retries[@]}" -y -qq install "$debs"/*.deb || { code=$?; failed="apt-get install"; }
fi
if [ -z "$failed" ]; then
  if have_zsh; then
    if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "debs=true" >>"$GITHUB_OUTPUT"; fi
    exit 0
  fi
  failed="apt-get install"
  code="0 but no zsh on PATH"
fi
if [ -r /etc/apt/apt-mirrors.txt ]; then
  say "the apt mirror list of this runner:"
  cat /etc/apt/apt-mirrors.txt
fi
if [ "$code" = 124 ]; then
  warn "$failed ran past $limit s and was stopped; trying Homebrew"
else
  warn "$failed failed (exit $code, apt's errors above); trying Homebrew"
fi

# 4. Homebrew.
# The image keeps Homebrew off PATH, in BREW_DIR.
brew=$(command -v brew || true)
if [ -z "$brew" ] && [ -x "$brew_dir/brew" ]; then brew=$brew_dir/brew; fi
if [ -z "$brew" ]; then
  echo "ci-install-zsh: no zsh: apt failed and this image has no Homebrew" >&2
  exit 1
fi
if HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_ENV_HINTS=1 "$brew" install zsh; then
  if prefix=$("$brew" --prefix zsh) && sudo ln -sf "$prefix/bin/zsh" "$link" && have_zsh; then
    warn "zsh came from Homebrew ($link), not from apt"
    exit 0
  fi
fi
echo "ci-install-zsh: no zsh: neither apt nor Homebrew installed it" >&2
exit 1
