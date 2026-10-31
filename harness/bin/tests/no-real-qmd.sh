# Sourced by the tests of the qmd scripts, with T, WIN and onpath set: no case reaches a real qmd. A missing
# stand-in then shows as a failed case, and the machine's own `qmd update` and `qmd embed` do not run.
# - A folder of the PATH that has a qmd leaves the PATH. Elsewhere than on Windows its other files stay reachable
#   through links, because git or jq may lie there too (the bin folder of Homebrew).
# - When that is the folder of this node (a global install under nvm), this node moves to a folder of its own,
#   as a hard link or a copy: process.execPath then names that folder, which is first on the PATH of qmd.
# - The global folder of npm and ~/.nvm lie in T. A case that is about them sets its own.
has_qmd() { [ -e "$1/qmd" ] || [ -e "$1/qmd.cmd" ]; }
no_real_qmd() {
    local real node_dir name clean="" dir file kept n=0
    real="$(onpath "$(node -p process.execPath)")"
    node_dir="$(dirname "$real")"
    if has_qmd "$node_dir"; then
        name=node; [ "$WIN" = 1 ] && name=node.exe
        mkdir -p "$T/test-node"
        ln "$real" "$T/test-node/$name" 2>/dev/null || cp "$real" "$T/test-node/$name"
        if ! "$T/test-node/$name" --version >/dev/null 2>&1; then # a node that needs the files next to it
            rm -f "$T/test-node/$name"
            ln -s "$real" "$T/test-node/$name"
        fi
        clean="$(onpath "$T/test-node")"
    fi
    while IFS= read -r -d: dir; do
        [ -n "$dir" ] || continue
        if has_qmd "$dir"; then
            [ "$WIN" = 1 ] && continue
            n=$((n + 1)); kept="$T/path-$n"; mkdir -p "$kept"
            for file in "$dir"/*; do
                case "${file##*/}" in qmd | qmd.cmd | qmd.ps1) ;; *) ln -s "$file" "$kept/" 2>/dev/null ;; esac
            done
            dir="$kept"
        fi
        clean="${clean:+$clean:}$dir"
    done <<<"$PATH:"
    export PATH="$clean"
    mkdir -p "$T/home-default" "$T/npm-prefix-default/bin"
    export HOME="$T/home-default" QMD_NPM_PREFIX="$T/npm-prefix-default"
}
no_real_qmd
