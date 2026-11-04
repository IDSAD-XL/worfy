// The shell command parser of auto-approval (worfy-auto-approve ticket 02): what it reads, with
// which paths, and every construct it refuses to judge. Paths are made up (/tmp/demo, C:\work).
import { describe, expect, it } from 'vitest'
import { analyze, isNewTempFolder, newTempFolderName, REPOSITORY, UNKNOWN, type AnalyzeContext, type ShellAction } from '../../src/main/agent/auto-approve/shell'

const posix: AnalyzeContext = {
  cwd: '/tmp/demo',
  env: { HOME: '/home/demo', TMPDIR: '/tmp/demo-tmp/', M: '/tmp/demo/m', d: 'build', SPACED: 'a b', STAR: 'a*', EMPTY: '', NEWLINE: 'a\nb', QUESTION: 'a?' },
  platform: 'linux',
}
const windows: AnalyzeContext = { cwd: 'C:\\work', env: { HOME: 'C:\\Users\\demo', TMPDIR: 'C:\\Temp' }, platform: 'win32' }

const temp1 = `/tmp/demo-tmp/${newTempFolderName(1)}`

function actions(command: string, context: AnalyzeContext = posix): ShellAction[] {
  const analysis = analyze(command, context)
  if (!analysis.judged) throw new Error(`not judged: ${analysis.why}`)
  return analysis.actions
}

/** program, cwd and the paths of each action, without the empty lists. */
function brief(command: string, context: AnalyzeContext = posix): Array<Record<string, unknown>> {
  return actions(command, context).map((action) => {
    const out: Record<string, unknown> = { program: action.program, cwd: action.cwd }
    if (action.writes.length > 0) out['writes'] = action.writes
    if (action.deletes.length > 0) out['deletes'] = action.deletes
    if (action.reads.length > 0) out['reads'] = action.reads
    if (action.network) out['network'] = true
    if (action.stdinFrom !== null) out['stdinFrom'] = action.stdinFrom
    return out
  })
}

describe('the examples of the spec', () => {
  it('cd <tmp> && rm -rf *: the glob in the folder cd entered', () => {
    expect(brief('cd /tmp/demo-tmp/x && rm -rf *')).toEqual([
      { program: 'cd', cwd: '/tmp/demo' },
      { program: 'rm', cwd: '/tmp/demo-tmp/x', deletes: ['/tmp/demo-tmp/x/*'] },
    ])
  })

  it('rm -rf "$M/$d": both variables from the environment', () => {
    expect(brief('rm -rf "$M/$d"')).toEqual([{ program: 'rm', cwd: '/tmp/demo', deletes: ['/tmp/demo/m/build'] }])
  })

  it('T=$(mktemp -d); rm -rf "$T"/*: inside the new folder, and / when mktemp failed', () => {
    expect(brief('T=$(mktemp -d); rm -rf "$T"/*')).toEqual([
      { program: 'mktemp', cwd: '/tmp/demo', writes: [temp1] },
      { program: 'rm', cwd: '/tmp/demo', deletes: [`${temp1}/*`] },
      { program: 'rm', cwd: '/tmp/demo', deletes: ['/*'] },
    ])
  })

  it('T=$(mktemp -d) && rm -rf "$T"/*: only inside the new folder', () => {
    expect(brief('T="$(mktemp -d)" && rm -rf "$T"/*')).toEqual([
      { program: 'mktemp', cwd: '/tmp/demo', writes: [temp1] },
      { program: 'rm', cwd: '/tmp/demo', deletes: [`${temp1}/*`] },
    ])
  })

  it('T=$(mktemp -d) || exit 1; rm -rf "$T"/*: only inside the new folder', () => {
    expect(brief('T=$(mktemp -d) || exit 1; rm -rf "$T"/*')).toEqual([
      { program: 'mktemp', cwd: '/tmp/demo', writes: [temp1] },
      { program: 'exit', cwd: '/tmp/demo' },
      { program: 'rm', cwd: '/tmp/demo', deletes: [`${temp1}/*`] },
    ])
  })

  it('a multi-line zsh -c script with rm: each line, with the folder of the line before', () => {
    const script = "zsh -c 'cd /tmp/demo/w || exit 1\nrm -rf build/*\nrm -f \"$HOME/.cache/demo\"\n'"
    expect(brief(script)).toEqual([
      { program: 'zsh', cwd: '/tmp/demo' },
      { program: 'cd', cwd: '/tmp/demo' },
      { program: 'exit', cwd: '/tmp/demo' },
      { program: 'rm', cwd: '/tmp/demo/w', deletes: ['/tmp/demo/w/build/*'] },
      { program: 'rm', cwd: '/tmp/demo/w', deletes: ['/home/demo/.cache/demo'] },
    ])
  })

  it('a cd that may fail before ; lists the next command in both folders', () => {
    expect(brief('cd sub; rm a')).toEqual([
      { program: 'cd', cwd: '/tmp/demo' },
      { program: 'rm', cwd: '/tmp/demo/sub', deletes: ['/tmp/demo/sub/a'] },
      { program: 'rm', cwd: '/tmp/demo', deletes: ['/tmp/demo/a'] },
    ])
  })
})

describe('outside the grammar: judged false', () => {
  const cases: Array<[string, string, string]> = [
    ['command substitution in a target', 'rm -rf $(echo x)', 'a command substitution'],
    ['backquotes', 'rm -rf `echo x`', 'a command substitution'],
    ['arithmetic', 'rm -rf $((1 + 1))', 'an arithmetic expansion'],
    ['a command substitution inside quotes', 'rm -rf "$(echo x)/y"', 'a command substitution'],
    ['mktemp substitution outside an assignment', 'rm -rf "$(mktemp -d)"', 'a command substitution'],
    ['mktemp with a template', 'T=$(mktemp -d -t x)', 'a command substitution'],
    ['eval', 'eval rm x', 'a shell built-in that changes the shell or runs code'],
    ['source', 'source ./env.sh', 'a shell built-in that changes the shell or runs code'],
    ['.', '. ./env.sh', 'a shell built-in that changes the shell or runs code'],
    ['exec', 'exec rm x', 'a shell built-in that changes the shell or runs code'],
    ['command', 'command rm x', 'a shell built-in that changes the shell or runs code'],
    ['builtin', 'builtin cd /', 'a shell built-in that changes the shell or runs code'],
    ['alias', 'alias ls=rm', 'a shell built-in that changes the shell or runs code'],
    ['export', 'export X=1', 'a shell built-in that changes the shell or runs code'],
    ['set other than -e/-u/pipefail', 'set -o noglob', 'a shell built-in that changes the shell or runs code'],
    ['set -f', 'set -f', 'a shell built-in that changes the shell or runs code'],
    ['a function', 'f() { rm x; }', 'a subshell, a function or a glob group'],
    ['the function keyword', 'function f { :; }', 'a brace expansion or a group'],
    ['for', 'for f in a b; do rm $f; done', 'a reserved word: if, for, while, case, a function or a group'],
    ['while', 'while true; do :; done', 'a reserved word: if, for, while, case, a function or a group'],
    ['if', 'if true; then rm x; fi', 'a reserved word: if, for, while, case, a function or a group'],
    ['case', 'case x in x) rm y ;; esac', 'a subshell, a function or a glob group'],
    ['a subshell', '(cd x && rm y)', 'a subshell, a function or a glob group'],
    ['a group', '{ rm x; }', 'a brace expansion or a group'],
    ['a here-doc', 'cat <<EOF\nx\nEOF', 'a here-doc or a here-string'],
    ['a here-string', 'cat <<< x', 'a here-doc or a here-string'],
    ['process substitution in', 'diff <(ls) x', 'a process substitution'],
    ['process substitution out', 'tee >(cat) x', 'a process substitution'],
    ['zmodload', 'zmodload zsh/files', 'a shell built-in that changes the shell or runs code'],
    ['an unknown variable', 'rm -rf "$UNKNOWN_DEMO"/x', 'an unknown variable'],
    ['an unquoted value with a blank', 'rm -rf $SPACED', 'an unquoted variable whose value splits or globs'],
    ['an unquoted value with a glob', 'rm -rf $STAR', 'an unquoted variable whose value splits or globs'],
    ['IFS in the environment', 'rm x', 'IFS in the environment'],
    ['an assignment to IFS', 'IFS=/; rm x', 'an assignment to a variable the shell gives a meaning to'],
    ['a reference to IFS', 'printf %s "$IFS"', 'a reference to IFS'],
    ['~user', 'rm -rf ~demo/x', 'a ~user or ~+ expansion'],
    ['~+', 'rm -rf ~+/x', 'a ~user or ~+ expansion'],
    ['a ~ before quotes', 'rm -rf ~"/x"', 'a ~ before quoted text'],
    ['a ~ after = in an argument (bash expands it)', 'printf %s a=~/b', 'a ~ after = or :'],
    ['a special parameter', 'rm $1', "a special parameter, $'\u2026' or a lone $"],
    ['$@', 'rm "$@"', "a special parameter, $'\u2026' or a lone $"],
    ['$?', 'printf %s $?', "a special parameter, $'\u2026' or a lone $"],
    ['a default value expansion', 'rm ${X:-/}', 'a parameter expansion other than ${NAME}'],
    ['a length expansion', 'rm ${#M}', 'a parameter expansion other than ${NAME}'],
    ['a zsh subscript in quotes', 'rm "$M[1]"', 'a zsh subscript or modifier'],
    ['a zsh modifier', 'rm $M:h', 'a zsh subscript or modifier'],
    ['ANSI-C quotes', "rm $'a'", "a special parameter, $'\u2026' or a lone $"],
    ['brace expansion', 'rm {a,b}', 'a brace expansion or a group'],
    ['a [ glob', 'rm [ab]', 'a [ glob'],
    ['! negation', '! rm x', 'a ! negation or history expansion'],
    ['zsh = expansion', 'rm =ls', 'a zsh = expansion'],
    ['background &', 'sleep 1 &', 'a background & or an &> redirection'],
    ['&> redirection', 'rm x &> log', 'a background & or an &> redirection'],
    ['|& pipe', 'rm x |& cat', 'a |& pipe'],
    ['<& duplication', 'cat <&3', 'a <& or <> redirection'],
    ['>& to a file', 'echo x >& log', 'a >& to a file'],
    ['an fd of two digits', 'echo x 10>log', 'an fd of more than one digit'],
    ['a duplication to an fd of two digits', 'echo x >&12', 'a >& to a file'],
    ['an += assignment', 'X=a; X+=b; rm -rf "$X"', 'an += assignment'],
    ['a zsh = expansion in an assignment', 'X==rm; $X a', 'a zsh = expansion'],
    ['an assignment before a program', 'X=a rm $X', 'an assignment before a program'],
    ['an assignment to PATH', 'PATH=/tmp/demo; rm x', 'an assignment to a variable the shell gives a meaning to'],
    ['an assignment to an exported variable', 'M=/; rm -rf "$M"', 'an assignment to an exported variable'],
    ['an assignment to HOME', 'HOME=/; rm -rf ~/x', 'an assignment to an exported variable'],
    ['an assignment to TMPDIR', 'TMPDIR=/; T=$(mktemp -d)', 'an assignment to an exported variable'],
    ['an assignment to a GIT_ variable', 'GIT_DIR=/x; git status', 'an assignment to a variable the shell gives a meaning to'],
    ['cd inside a pipeline', 'echo a | cd x', 'a cd inside a pipeline'],
    ['an assignment inside a pipeline', 'echo a | X=1', 'an assignment inside a pipeline'],
    ['cd -', 'cd -', 'a cd option or cd -'],
    ['cd -P', 'cd -P x', 'a cd with more than one operand'],
    ['cd with two operands', 'cd a b', 'a cd with more than one operand'],
    ['a glob in cd', 'cd /tmp/demo/*', 'a glob in a path that must name one file'],
    ['a carriage return', 'rm x\r', 'a control character in the command'],
    ['a backslash at the end', 'rm x\\', 'a backslash at the end of the command'],
    ['an unterminated single quote', "rm 'x", 'an unterminated quote'],
    ['an unterminated double quote', 'rm "x', 'an unterminated quote'],
    [';;', 'rm a;;', 'a case terminator'],
    ['a leading ;', '; rm a', 'a missing command'],
    ['an empty command between ;', 'rm a; ; rm b', 'a missing command'],
    ['&& at the end', 'rm a &&', 'a command ends with && or ||'],
    ['&& at the start', '&& rm a', 'a missing command'],
    ['a redirection without a target', 'echo x >', 'a redirection without a target'],
    ['a redirection without a program', '> x', 'a redirection without a program'],
    ['a glob before the last component', 'rm -rf /tmp/demo/*/x', 'a glob before the last component of a path'],
    ['a literal glob character in a path', "rm -rf '/tmp/demo/*'", 'a literal * or ? in a path'],
    ['a zsh extended glob character in a path', 'rm -rf a~b', 'a zsh extended glob character in a path'],
    ['a ^ in a path', 'rm -rf ^keep', 'a zsh extended glob character in a path'],
    ['an empty path', 'rm -rf ""', 'an empty path'],
    ['an empty path from a variable', 'rm -rf "$EMPTY"', 'an empty path'],
    ['a glob in a redirection', 'echo x > *.log', 'a glob in a path that must name one file'],
    ['a glob in a destination', 'mv a dst*', 'a glob in a path that must name one file'],
    ['an option after an operand', 'rm x -rf', 'an option after an operand'],
    ['-- after an operand', 'rm x -- -w', 'an option after an operand'],
    ['an option the table does not know', 'rm --demo x', 'an option the table does not know'],
    ['mv without a destination', 'mv a', 'a missing destination'],
    ['rmdir -p', 'rmdir -p a/b', 'an option the table does not know'],
    ['tee to -', 'tee -', 'a tee to -'],
    ['printf -v', 'printf -v X %s a', 'a printf -v assignment'],
    ['mktemp without -d', 'mktemp', 'a mktemp other than mktemp -d'],
    ['a shell option before -c', "bash -lc 'rm x'", 'a shell option other than -e, -u before -c'],
    ['a shell -c with positional arguments', "bash -c 'rm x' demo-arg0", 'a shell -c without exactly one script'],
    ['an inner script outside the grammar', "zsh -c 'rm $(echo x)'", 'inner script: a command substitution'],
    ['shells nested too deep', `sh -c "sh -c 'sh -c \\"sh -c rm\\"'"`, 'inner script: inner script: inner script: shells nested too deep'],
    ['too many folders after cd', 'cd a; cd b; cd c; cd d; rm x', 'too many folders the command may run in'],
    ['git -c', 'git -c core.fsmonitor=x status', 'a git option that names programs or another repository'],
    ['git --git-dir', 'git --git-dir=/x status', 'a git option that names programs or another repository'],
    ['git clean with a glob pathspec', "git clean -fd '*.log'", 'a git pathspec with a glob or magic'],
    ['git clean with pathspec magic', 'git clean -fd :/', 'a git pathspec with a glob or magic'],
    ['git push --receive-pack', 'git push --receive-pack=x origin', 'an option the table does not know'],
    ['git push with an abbreviated option', 'git push --forc origin main', 'an option the table does not know'],
    ['git rebase -i', 'git rebase -i HEAD~2', 'a git option that reads a file or runs a program'],
    ['git rebase --exec', 'git rebase --exec=x main', 'a git option that reads a file or runs a program'],
    ['git commit -F', 'git commit -F msg.txt', 'a git option that reads a file or runs a program'],
    ['git commit --file by a prefix', 'git commit --fil=msg.txt', 'a git option that reads a file or runs a program'],
    ['git diff --output', 'git diff --output=x', 'a git option that writes a file or runs a program'],
    ['git grep -O', 'git grep -O x', 'a git option that writes a file or runs a program'],
    ['curl -K', 'curl -K cfg https://example.invalid', 'an option the table does not know'],
    ['curl -O', 'curl -O https://example.invalid/x', 'an option the table does not know'],
    ['curl --form with a file', 'curl -F a=@x https://example.invalid', 'a curl --form that sends a file'],
    ['curl --write-out to a file', "curl -w '%output{x}' https://example.invalid", 'a curl --write-out that writes a file'],
    ['wget without -O', 'wget https://example.invalid/x', 'a wget whose file is named by the server'],
    ['wget -e', 'wget -e x https://example.invalid', 'an option the table does not know'],
    ['a relative cd with CDPATH', 'cd sub', 'a relative cd with CDPATH set'],
    ['$PWD after cd ..', 'cd .. && printf %s "$PWD"', 'a $PWD after a cd with . or ..'],
    ['PS4 with set -x', "PS4='$(touch x)'; set -x; true", 'an assignment to a variable the shell gives a meaning to'],
    ['set -x', 'set -x', 'a shell built-in that changes the shell or runs code'],
    ['set -o xtrace', 'set -o xtrace', 'a shell built-in that changes the shell or runs code'],
    ['bash -xc', "bash -xc 'true'", 'a shell option other than -e, -u before -c'],
    ['zsh path', 'path=/tmp/demo/bin; git status', 'an assignment to a variable the shell gives a meaning to'],
    ['zsh cdpath', 'cdpath=/tmp; cd demo && rm -rf build', 'an assignment to a variable the shell gives a meaning to'],
    ['GLOBIGNORE', 'GLOBIGNORE=x; rm -rf ./*', 'an assignment to a variable the shell gives a meaning to'],
    ['EXECIGNORE', 'EXECIGNORE=x; true', 'an assignment to a variable the shell gives a meaning to'],
    ['POSIXLY_CORRECT', 'POSIXLY_CORRECT=1; true', 'an assignment to a variable the shell gives a meaning to'],
    ['an assignment to _', '_=x; true', 'an assignment to a variable the shell gives a meaning to'],
    ['an assignment to a BASH_ name', 'BASH_XTRACEFD=1; true', 'an assignment to a variable the shell gives a meaning to'],
    ['an assignment to an LD_ name', 'LD_PRELOAD=/tmp/x; true', 'an assignment to a variable the shell gives a meaning to'],
    ['a prefix assignment of GIT_DIR', 'GIT_DIR=/x git clean -fdx', 'an assignment before a program'],
    ['a zsh numeric glob', 'rm <1-9>x', 'a zsh numeric glob'],
    ['a zsh numeric glob inside a word', 'rm -f a<1-9>b', 'a zsh numeric glob'],
    ['a zsh <-> glob', 'rm <->', 'a zsh numeric glob'],
    ['exit with a redirection', 'exit > nosuchdir/x; rm -rf ~', 'an exit that may not exit'],
    ['exit with two operands', 'exit 1 2; rm -rf ~', 'an exit that may not exit'],
    ['exit with a word', 'exit x; rm -rf ~', 'an exit that may not exit'],
    ['a glob that may be an option to git grep', 'git grep -e TODO *', 'a glob that may expand into an option'],
    ['a glob that may be an option to git rebase', 'git rebase *', 'a glob that may expand into an option'],
    ['a glob that may be an option to cp', 'cp * /tmp/demo/d', 'a glob that may expand into an option'],
    ['a glob that may be an option to mv', 'mv * /tmp/demo/d', 'a glob that may expand into an option'],
    ['a glob that may be an option to curl', 'curl * https://example.invalid', 'a glob that may expand into an option'],
    ['a zsh ^ glob that may be an option', 'cat ^x', 'a glob that may expand into an option'],
    ['a ? glob that may be an option', 'cat ?', 'a glob that may expand into an option'],
    ['curl does not end options at --', 'curl -- * https://example.invalid', 'a glob that may expand into an option'],
    ['test does not end options at --', 'test -- *', 'a glob that may expand into an option'],
    ['ln', 'ln ~/.zshrc z', 'a link'],
    ['ln -s', 'ln -s ~/.ssh s', 'a link'],
    ['cp -l', 'cp -l a b', 'an option the table does not know'],
    ['cp -s', 'cp -s a b', 'an option the table does not know'],
    ['cp --link', 'cp --link a b', 'an option the table does not know'],
    ['cp --symbolic-link', 'cp --symbolic-link a b', 'an option the table does not know'],
    ['mv -b', 'mv -b a b', 'an option the table does not know'],
    ['cp -b', 'cp -b a b', 'an option the table does not know'],
    ['test -v', "test -v 'a[$(touch x)]'", 'a test -v or -R'],
    ['[ -v', "[ -v 'a[$(touch x)]' ]", 'a test -v or -R'],
    ['test -R', 'test -R x', 'a test -v or -R'],
    ['sh -c with a glob script', 'sh -c "rm -f "*.tmp', 'a glob in a shell -c script'],
    ['sh -c with a zsh glob script', 'sh -c rm^x', 'a glob in a shell -c script'],
    ['a line continuation inside a variable name', 'H=/tmp/demo/x; rm -rf "$H\\\nOME"', 'a line continuation inside a word'],
    ['a line continuation inside an unquoted word', 'rm -rf $H\\\nOME', 'a line continuation inside a word'],
    ['git commit without a message', 'git commit -a', 'a git command that starts an editor or gpg'],
    ['git commit -c', 'git commit -c HEAD', 'a git command that starts an editor or gpg'],
    ['git commit --amend without a message', 'git commit --amend', 'a git command that starts an editor or gpg'],
    ['git tag --sign', 'git tag --sign v1 -m x', 'a git command that starts an editor or gpg'],
    ['git tag -u', 'git tag -u KEY v1 -m x', 'a git command that starts an editor or gpg'],
    ['git tag --local-user', 'git tag --local-user=KEY v1 -m x', 'a git command that starts an editor or gpg'],
    ['git tag -a without a message', 'git tag -a v1', 'a git command that starts an editor or gpg'],
    ['git pull --rebase=interactive', 'git pull --rebase=interactive', 'a git command that starts an editor or gpg'],
    ['git rebase --continue', 'git rebase --continue', 'a git command that starts an editor or gpg'],
    ['git branch -m', 'git branch -m old new', 'a git branch rename or copy'],
    ['git branch --copy', 'git branch --copy a b', 'a git branch rename or copy'],
    ['/dev/tcp', 'cat < /dev/tcp/example.invalid/80', 'a /dev/tcp or /dev/udp redirection'],
    ['/dev/udp', 'echo x > /dev/udp/example.invalid/53', 'a /dev/tcp or /dev/udp redirection'],
    ['chdir', 'chdir /tmp', 'a shell built-in that changes the shell or runs code'],
    ['a backquote in double quotes', 'rm "`echo x`"', 'a command substitution'],
    ['OLDPWD', 'rm "$OLDPWD"', 'a reference to OLDPWD'],
    ['$PWD after cd into a double slash', 'cd a//b && printf %s "$PWD"', 'a $PWD after a cd with . or ..'],
    ['an unquoted value with a newline', 'rm $NEWLINE', 'an unquoted variable whose value splits or globs'],
    ['an unquoted value with ?', 'rm $QUESTION', 'an unquoted variable whose value splits or globs'],
    ['a quoted value with a glob character in a path', 'rm "$STAR"', 'a literal * or ? in a path'],
    ['a glob character in HOME', 'rm ~/x', 'a literal * or ? in a path'],
    ['a ~ after : in an argument', 'printf %s a:~/b', 'a ~ after = or :'],
    ['a ~ after : in an assignment', 'X=a:~/b', 'a ~ after :'],
    ['a # in a path', 'rm a#b', 'a zsh extended glob character in a path'],
    ['a flag option with a value', 'rm --force=x y', 'an option the table does not know'],
    ['set -o errexit without a name', 'set -o', 'a shell built-in that changes the shell or runs code'],
    ['bash -l -c', "bash -l -c 'rm x'", 'a shell option other than -e, -u before -c'],
    ['mktemp -d -t x', 'mktemp -d -t x', 'a mktemp other than mktemp -d'],
    ['mktemp without TMPDIR', 'T=$(mktemp -d)', 'mktemp without TMPDIR'],
    ['a DEL character', 'rm x\x7f', 'a control character in the command'],
    ['too many actions', 'true;'.repeat(201), 'too many actions'],
    ['a glob in the program name', '*x a', 'a glob in the program name'],
    ['a quoted glob in the program name', "'r*' a", 'a glob in the program name'],
    ['a zsh glob in the program name', 'r^m a', 'a glob in the program name'],
    ['git --version is fine, other globals are not', 'git --exec-path=/x status', 'a git option that names programs or another repository'],
    ['git worktree remove with two paths', 'git worktree remove a b', 'a git worktree remove without one path'],
    ['git worktree move with one path', 'git worktree move a', 'a git worktree move without two paths'],
    ['git worktree add without a path', 'git worktree add', 'a git worktree add without a path'],
    ['git clean with an unquoted glob', 'git clean -fd -e keep -- *.log', 'a git pathspec with a glob or magic'],
    ['git rebase -x', 'git rebase -x true main', 'a git option that reads a file or runs a program'],
    ['git with GIT_WORK_TREE', 'git status', 'a GIT_ variable that moves the repository'],
    ['git commit --output', 'git commit -m x --output=y', 'a git option that reads a file or runs a program'],
    ['git diff --ext-diff', 'git diff --ext-diff', 'a git option that writes a file or runs a program'],
    ['git diff --textconv by a prefix', 'git diff --textc', 'a git option that writes a file or runs a program'],
    ['curl -o with #', "curl -o 'f#1' https://example.invalid/[1-2]", 'a [ glob'],
    ['wget -n with another letter', 'wget -nz -O f https://example.invalid', 'an option the table does not know'],
    [';&', 'echo a ;& echo b', 'a case terminator'],
    ['<>', 'cat <> x', 'a <& or <> redirection'],
    ['>>&', 'echo a >>& x', 'a >>&, >>( or >>| redirection'],
    ['>>(', 'echo a >>(cat)', 'a >>&, >>( or >>| redirection'],
    ['>>|', 'echo a >>| x', 'a >>&, >>( or >>| redirection'],
    ['>& to a word after a digit', 'echo a >&2x', 'a >& to a file'],
    ['a redirection to an operator', 'echo a > ;', 'a redirection without a target'],
    ['a newline after an escape is a continuation, a backslash before EOF is not', 'echo a\\', 'a backslash at the end of the command'],
    ['a UNC path on Windows', "rm '\\\\server\\share'", 'a UNC path'],
    ['a stray control operator', 'echo a & & echo b', 'a background & or an &> redirection'],
    ['a pipe ending the command', 'echo a |', 'a missing command'],
    ['a >& to a word after fd 2', 'echo a 2>&x', 'a >& to a file'],
    ['a { inside a word', 'printf %s a{b', 'a brace expansion or a group'],
    ['an unclosed command substitution', 'rm $(x', 'a command substitution'],
    ['a working folder on Windows that is not absolute', 'rm x', 'a working folder that is not absolute'],
    ['a glob in a short option', 'rm -*', 'a glob in an option'],
    ['a glob in a long option', 'rm --f*', 'a glob in an option'],
    ['a short option without its value', 'head -n', 'an option without its value'],
    ['an option without its value at the end', 'mkdir -m', 'an option without its value'],
    ['a long option without its value', 'curl --output', 'an option without its value'],
    ['curl -o named from a URL glob', "curl -o 'f#1' https://example.invalid/x", 'a curl output named from a URL glob'],
    ['a git option denied in every subcommand', 'git commit -m x --receive-pack=y', 'a git option that reads a file or runs a program'],
    ['a git option longer than a denied one', 'git commit -m x --templatex', 'a git option that reads a file or runs a program'],
    ['git -C with an empty folder', 'git -C "" status', 'an option without its value'],
    ['a relative TMPDIR', 'T=$(mktemp -d)', 'a TMPDIR that is not absolute'],
    ['a relative TMPDIR on Windows', 'T=$(mktemp -d)', 'a TMPDIR that is not absolute'],
    ['a command that expands to nothing', '$EMPTY', 'a command without a program after expansion'],
    ['exit inside a pipeline', 'echo | exit', 'an exit inside a pipeline'],
    ['[ does not end options at --', '[ -- * ]', 'a glob that may expand into an option'],
    ['a -- that is the value of git grep -e, before -O', "git grep -e -- '-Otouch demo'", 'a git option that writes a file or runs a program'],
    ['a -- that is the value of git grep -e, before --open-files-in-pager', "git grep -e -- '--open-files-in-pager=touch demo'", 'a git option that writes a file or runs a program'],
    ['a -- that is the message of git commit, before -e', 'git commit -m -- -e', 'a git option that reads a file or runs a program'],
    ['a -- that is the message of git tag, before --sign', 'git tag -m -- --sign v9', 'a git command that starts an editor or gpg'],
    ['git branch --delete by a prefix', 'git branch --del --force feat', 'an option the table does not know'],
    ['git branch --move by a prefix', 'git branch --mov a b', 'an option the table does not know'],
    ['a -- that is the value of git push -o, before a glob', 'git push -o -- ./inner *', 'a glob that may expand into an option'],
    ['git tag --sign by a prefix', 'git tag --sig v1', 'a git command that starts an editor or gpg'],
    ['git tag --annotate by a prefix without a message', 'git tag --ann v1', 'a git command that starts an editor or gpg'],
    ['git commit --continue by a prefix', 'git commit -m x --cont', 'a git command that starts an editor or gpg'],
    ['a git commit whose -m comes after --', 'git commit -- -m x', 'a git command that starts an editor or gpg'],
    ['an m inside the value of another commit option', 'git commit -unormal', 'a git command that starts an editor or gpg'],
    ['git pull --rebase=interactive by a prefix', 'git pull --reb=i', 'a git command that starts an editor or gpg'],
    ['a -- right after an option, before a glob', 'cat -n -- *', 'a glob that may expand into an option'],
    ['git commit -c beside a message', 'git commit -m x -c HEAD', 'a git command that starts an editor or gpg'],
    ['a long git branch option outside a listing', 'git branch --no-color x', 'an option the table does not know'],
    ['git diff with a path outside the repository', 'git diff /dev/null ~/.ssh/id_rsa', 'a git read outside the repository'],
    ['git diff --no-index', 'git diff --no-index ~/.ssh/id_rsa /dev/null', 'a git read outside the repository'],
    ['git diff --no-index by a prefix', 'git diff --no-i a b', 'a git read outside the repository'],
    ['git blame --contents outside the repository', 'git blame --contents=/home/demo/.ssh/id_rsa f', 'a git read outside the repository'],
    ['git log with a path outside the repository', 'git log --pretty=x ~/.ssh', 'a git read outside the repository'],
    ['git diff with a .. path', 'git diff HEAD ../secret', 'a git read outside the repository'],
    ['a value glued to a short git option that may name a file', 'git diff -O/tmp/order', 'a git option whose value may name a file'],
    ['git config --global', 'git config --get --global user.name', 'a git config outside the repository'],
    ['git config --system by a prefix', 'git config --sys --get x', 'a git config outside the repository'],
    ['git config --file', 'git config --file=/tmp/x --get a.b', 'a git config outside the repository'],
    ['git config -f', 'git config -f x --get a.b', 'a git config outside the repository'],
    ['git config --blob', 'git config --blob=HEAD:x --get a.b', 'a git config outside the repository'],
    ['git diff with a .? glob that bash 3.2 expands to ..', 'git diff . .?', 'a glob in a path component that starts with a dot'],
    ['git diff -- with a .? glob', 'git diff -- . .?', 'a glob in a path component that starts with a dot'],
    ['git diff with a ./.? glob', 'git diff . ./.?', 'a glob in a path component that starts with a dot'],
    ['git diff with a sub/.? glob', 'git diff . sub/.?', 'a glob in a path component that starts with a dot'],
    ['ls with a .? glob', 'ls .?', 'a glob in a path component that starts with a dot'],
    ['cat with a .? glob', 'cat .?', 'a glob in a path component that starts with a dot'],
    ['cp -r with a .? glob', 'cp -r .? /tmp/t/x', 'a glob in a path component that starts with a dot'],
    ['a .* glob', 'cat .*', 'a glob in a path component that starts with a dot'],
    ['a ..? glob', 'cat ..?', 'a glob in a path component that starts with a dot'],
    ['a .??* glob', 'rm -rf .??*', 'a glob in a path component that starts with a dot'],
    ['a .? glob in a middle component', 'cat sub/.?/x', 'a glob before the last component of a path'],
    ['a .[.] glob', 'cat .[.]', 'a [ glob'],
  ]
  const contexts: Record<string, AnalyzeContext> = {
    'a working folder on Windows that is not absolute': { ...windows, cwd: 'work' },
    'a relative TMPDIR': { ...posix, env: { ...posix.env, TMPDIR: 'tmp' } },
    'a relative TMPDIR on Windows': { ...windows, env: { TMPDIR: 'tmp' } },
    'IFS in the environment': { ...posix, env: { ...posix.env, IFS: ' ' } },
    'a relative cd with CDPATH': { ...posix, env: { ...posix.env, CDPATH: '/tmp' } },
    'a glob character in HOME': { ...posix, env: { ...posix.env, HOME: '/home/de*mo' } },
    'mktemp without TMPDIR': { ...posix, env: { HOME: '/home/demo' } },
    'git with GIT_WORK_TREE': { ...posix, env: { ...posix.env, GIT_WORK_TREE: '/x' } },
    'a UNC path on Windows': { cwd: 'C:\\work', env: {}, platform: 'win32' },
  }

  it.each(cases)('%s', (name, command, why) => {
    expect(analyze(command, contexts[name] ?? posix)).toEqual({ judged: false, why })
  })

  it('the first failing test of the ticket: a command substitution in the target of rm', () => {
    expect(analyze('rm -rf $(echo x)', posix)).toEqual({ judged: false, why: 'a command substitution' })
  })

  it('says why in its own words, never with a piece of the command', () => {
    for (const command of ['rm -rf $(echo demo-secret)', 'rm "$DEMO_SECRET_VAR"', "zsh -c 'rm $(demo-secret)'", 'demo-secret() { :; }']) {
      const analysis = analyze(command, posix)
      if (analysis.judged) throw new Error('judged')
      expect(analysis.why).not.toMatch(/demo-secret|DEMO_SECRET/)
    }
  })

  it('a bash -c with BASH_ENV in the environment', () => {
    expect(analyze("bash -c 'rm x'", { ...posix, env: { ...posix.env, BASH_ENV: '/tmp/demo/env' } }).judged).toBe(false)
  })

  it('git with GIT_DIR in the environment', () => {
    expect(analyze('git status', { ...posix, env: { ...posix.env, GIT_DIR: '/tmp/demo/.git' } }).judged).toBe(false)
  })

  it('a working folder that is not absolute', () => {
    expect(analyze('rm x', { ...posix, cwd: 'demo' }).judged).toBe(false)
  })
})

describe('words', () => {
  const words = (command: string): string[][] => actions(command).map((action) => [action.program, ...action.args])

  it('quotes, escapes and line continuations', () => {
    expect(words(`printf %s 'a b' "c d" e\\ f "g\\$h" "i\\qj" 'k'"l"m \\\nn`)).toEqual([['printf', '%s', 'a b', 'c d', 'e f', 'g$h', 'i\\qj', 'klm', 'n']])
  })

  it('variables from the environment and from assignments, an empty one dropped unquoted', () => {
    expect(words('X=/tmp/demo/x; printf %s "$X" ${X}/y $EMPTY "$EMPTY" a$EMPTY')).toEqual([['printf', '%s', '/tmp/demo/x', '/tmp/demo/x/y', '', 'a']])
  })

  it('an assignment does not change the words of the program before it', () => {
    expect(words("X=a; X=b; printf %s $X")).toEqual([['printf', '%s', 'b']])
  })

  it('~ at the start of a word, and literal elsewhere', () => {
    expect(words('printf %s ~ ~/x HEAD~1 a#b')).toEqual([['printf', '%s', '/home/demo', '/home/demo/x', 'HEAD~1', 'a#b']])
  })

  it('a comment', () => {
    expect(words('printf %s a # rm -rf /\nprintf %s b')).toEqual([['printf', '%s', 'a'], ['printf', '%s', 'b']])
  })

  it('a lone [ and = are words', () => {
    expect(words('[ "$M" = /tmp/demo/m ]')).toEqual([['[', '/tmp/demo/m', '=', '/tmp/demo/m', ']']])
  })

  it('$PWD follows cd', () => {
    expect(words('cd sub && printf %s "$PWD"')).toEqual([['cd', 'sub'], ['printf', '%s', '/tmp/demo/sub']])
  })
})

describe('the table', () => {
  it('a redirection writes, /dev/null aside; < reads', () => {
    expect(brief('echo hi > out.txt 2>/dev/null >> log 2>&1 < in.txt')).toEqual([{ program: 'echo', cwd: '/tmp/demo', writes: ['/tmp/demo/out.txt', '/tmp/demo/log'], reads: ['/tmp/demo/in.txt'] }])
  })

  it('relative, absolute and home paths, . and .. kept for the resolution', () => {
    expect(brief('rm -rf -- ./x ../y /abs ~/z -w')).toEqual([{ program: 'rm', cwd: '/tmp/demo', deletes: ['/tmp/demo/./x', '/tmp/demo/../y', '/abs', '/home/demo/z', '/tmp/demo/-w'] }])
  })

  it('rmdir, mv, cp, mkdir, touch, tee', () => {
    expect(brief('rmdir a; mv -f a b; cp -r a b c; mkdir -p -m 755 d; touch -r ref f; tee -a log')).toEqual([
      { program: 'rmdir', cwd: '/tmp/demo', deletes: ['/tmp/demo/a'] },
      { program: 'mv', cwd: '/tmp/demo', deletes: ['/tmp/demo/a'], writes: ['/tmp/demo/b'] },
      { program: 'cp', cwd: '/tmp/demo', reads: ['/tmp/demo/a', '/tmp/demo/b'], writes: ['/tmp/demo/c'] },
      { program: 'mkdir', cwd: '/tmp/demo', writes: ['/tmp/demo/d'] },
      { program: 'touch', cwd: '/tmp/demo', reads: ['/tmp/demo/ref'], writes: ['/tmp/demo/f'] },
      { program: 'tee', cwd: '/tmp/demo', writes: ['/tmp/demo/log'] },
    ])
  })

  it('a program outside the table writes anything; so does a program given by its path', () => {
    expect(brief('node x.js; /bin/rm x; sh script.sh')).toEqual([
      { program: 'node', cwd: '/tmp/demo', writes: [UNKNOWN] },
      { program: '/bin/rm', cwd: '/tmp/demo', writes: [UNKNOWN] },
      { program: 'sh', cwd: '/tmp/demo', writes: [UNKNOWN] },
    ])
  })

  it('programs without effects', () => {
    expect(brief('true && false || : ; pwd; echo a; printf %s b; test -f x; set -eu -o pipefail')).toEqual(
      ['true', 'false', ':', 'pwd', 'echo', 'printf', 'test', 'set'].map((program) => ({ program, cwd: '/tmp/demo' })),
    )
  })

  it('readers read their operands', () => {
    expect(brief('cat a; head -n 5 b; tail -f c; wc -l d; ls; ls -la e')).toEqual([
      { program: 'cat', cwd: '/tmp/demo', reads: ['/tmp/demo/a'] },
      { program: 'head', cwd: '/tmp/demo', reads: ['/tmp/demo/b'] },
      { program: 'tail', cwd: '/tmp/demo', reads: ['/tmp/demo/c'] },
      { program: 'wc', cwd: '/tmp/demo', reads: ['/tmp/demo/d'] },
      { program: 'ls', cwd: '/tmp/demo', reads: ['/tmp/demo'] },
      { program: 'ls', cwd: '/tmp/demo', reads: ['/tmp/demo/e'] },
    ])
  })

  it('git clean: the folder git works in, or its pathspecs; -C moves it', () => {
    expect(brief('git -C /tmp/demo/w clean -fdx; git clean -fd -e keep -- build')).toEqual([
      { program: 'git', cwd: '/tmp/demo/w', deletes: ['/tmp/demo/w'] },
      { program: 'git', cwd: '/tmp/demo', deletes: ['/tmp/demo/build'] },
    ])
  })

  it('git worktree remove and add, branch -D and listing, push', () => {
    expect(brief('git worktree remove --force /tmp/demo/w; git worktree add -b x ../w2; git branch -D x; git branch -a; git push --force-with-lease=x -u origin +x')).toEqual([
      { program: 'git', cwd: '/tmp/demo', writes: [REPOSITORY], deletes: ['/tmp/demo/w'] },
      { program: 'git', cwd: '/tmp/demo', writes: [REPOSITORY, '/tmp/demo/../w2'] },
      { program: 'git', cwd: '/tmp/demo', writes: [REPOSITORY] },
      { program: 'git', cwd: '/tmp/demo', reads: [REPOSITORY] },
      { program: 'git', cwd: '/tmp/demo', writes: [REPOSITORY, '/tmp/demo/origin'], network: true },
    ])
    expect(actions('git push --force-with-lease=x -u origin +x')[0]?.args).toEqual(['push', '--force-with-lease=x', '-u', 'origin', '+x'])
  })

  it('git reads, local changes, config, and an unknown subcommand or alias', () => {
    expect(brief('git status; git log --oneline HEAD~3; git commit -am msg; git fetch origin; git config --get user.name; git config core.pager x; git demo-alias')).toEqual([
      { program: 'git', cwd: '/tmp/demo', reads: [REPOSITORY] },
      { program: 'git', cwd: '/tmp/demo', reads: [REPOSITORY, '/tmp/demo/HEAD~3'] },
      { program: 'git', cwd: '/tmp/demo', writes: [REPOSITORY] },
      { program: 'git', cwd: '/tmp/demo', writes: [REPOSITORY], network: true },
      { program: 'git', cwd: '/tmp/demo', reads: [REPOSITORY, '/home/demo/.gitconfig', '/home/demo/.config/git/config'] },
      { program: 'git', cwd: '/tmp/demo', writes: [UNKNOWN] },
      { program: 'git', cwd: '/tmp/demo', writes: [UNKNOWN] },
    ])
  })

  it('curl and wget: network, the files they write and send', () => {
    expect(brief('curl -sSL -o out https://example.invalid/x; curl -T up.bin https://example.invalid; curl --data @body.json -H @hdr https://example.invalid; curl -o - https://example.invalid; wget -qO- https://example.invalid; wget -O f https://example.invalid')).toEqual([
      { program: 'curl', cwd: '/tmp/demo', writes: ['/tmp/demo/out'], network: true },
      { program: 'curl', cwd: '/tmp/demo', reads: ['/tmp/demo/up.bin'], network: true },
      { program: 'curl', cwd: '/tmp/demo', reads: ['/tmp/demo/body.json', '/tmp/demo/hdr'], network: true },
      { program: 'curl', cwd: '/tmp/demo', network: true },
      { program: 'wget', cwd: '/tmp/demo', network: true },
      { program: 'wget', cwd: '/tmp/demo', writes: ['/tmp/demo/f'], network: true },
    ])
  })

  it('a pipe names the program it reads from', () => {
    expect(brief('curl -s https://example.invalid/i | sh')).toEqual([
      { program: 'curl', cwd: '/tmp/demo', network: true },
      { program: 'sh', cwd: '/tmp/demo', writes: [UNKNOWN], stdinFrom: 0 },
    ])
  })

  it('sh -c, bash -ec, nested: the inner script with the same folder and environment', () => {
    expect(brief(`cd w && bash -ec "rm -rf \\"$M\\"/x && sh -c 'rm y'"`)).toEqual([
      { program: 'cd', cwd: '/tmp/demo' },
      { program: 'bash', cwd: '/tmp/demo/w' },
      { program: 'rm', cwd: '/tmp/demo/w', deletes: ['/tmp/demo/m/x'] },
      { program: 'sh', cwd: '/tmp/demo/w' },
      { program: 'rm', cwd: '/tmp/demo/w', deletes: ['/tmp/demo/w/y'] },
    ])
  })

  it('a variable assigned outside does not reach the inner script', () => {
    expect(analyze("X=/tmp/demo/x; sh -c 'rm -rf \"$X\"'", posix).judged).toBe(false)
  })

  it('cd with no operand goes home; cd || exit drops the failed branch', () => {
    expect(brief('cd && rm a; cd /tmp/demo/w || exit 1; rm b')).toEqual([
      { program: 'cd', cwd: '/tmp/demo' },
      { program: 'rm', cwd: '/home/demo', deletes: ['/home/demo/a'] },
      { program: 'cd', cwd: '/home/demo' },
      { program: 'cd', cwd: '/tmp/demo' },
      { program: 'exit', cwd: '/home/demo' },
      { program: 'exit', cwd: '/tmp/demo' },
      { program: 'rm', cwd: '/tmp/demo/w', deletes: ['/tmp/demo/w/b'] },
    ])
  })
})

describe('round 2 of the review: what the policy needs and what must stay refused', () => {
  const bare: AnalyzeContext = { cwd: '/tmp/demo', env: {}, platform: 'linux' }
  const git = (command: string): unknown[] => actions(command).map((action) => action.git)

  it('git branch: the branches a delete names, and whether it forces', () => {
    expect(git('git branch -D a b; git branch -d -r origin/x; git branch --delete --force c; git branch -df e; git branch')).toEqual([
      { subcommand: 'branch', branchDelete: { branches: ['a', 'b'], force: true } },
      { subcommand: 'branch', branchDelete: { branches: ['origin/x'], force: false } },
      { subcommand: 'branch', branchDelete: { branches: ['c'], force: true } },
      { subcommand: 'branch', branchDelete: { branches: ['e'], force: true } },
      { subcommand: 'branch' },
    ])
  })

  it('git push: the remote, the refspecs, force, delete and pushes of many refs', () => {
    const push = (remote: string | null, refspecs: string[], flags: { force?: boolean; delete?: boolean; many?: boolean } = {}) => ({
      subcommand: 'push',
      push: { remote, localPath: remote === null ? null : `/tmp/demo/${remote}`, refspecs, force: flags.force ?? false, delete: flags.delete ?? false, many: flags.many ?? false },
    })
    expect(git('git push; git push origin; git push -f origin main; git push origin :old; git push origin +main; git push --delete origin a b; git push --all origin; git push --mirror x; git push --tags; git push origin main:refs/heads/x; git push --force-with-lease origin main; git push --prune origin')).toEqual([
      push(null, []),
      push('origin', []),
      push('origin', ['main'], { force: true }),
      push('origin', [':old'], { delete: true }),
      push('origin', ['+main'], { force: true }),
      push('origin', ['a', 'b'], { delete: true }),
      push('origin', [], { many: true }),
      push('x', [], { force: true, delete: true, many: true }),
      push(null, [], { many: true }),
      push('origin', ['main:refs/heads/x']),
      push('origin', ['main'], { force: true }),
      push('origin', [], { delete: true }),
    ])
  })

  it('git commands with a message, and -- after a value, stay judged', () => {
    expect(git('git commit -am x; git commit -m x -- file; git commit -m --; git tag -a v1 -m x; git commit -qm x')).toEqual(['commit', 'commit', 'commit', 'tag', 'commit'].map((subcommand) => ({ subcommand })))
  })

  it('git push to a bare word may write a folder of that name; Windows paths with \\ are paths', () => {
    expect(brief('git push sibdir main')).toEqual([{ program: 'git', cwd: '/tmp/demo', writes: [REPOSITORY, '/tmp/demo/sibdir'], network: true }])
    expect(actions("git push '..\\other' main", windows)[0]?.git).toMatchObject({ push: { remote: '..\\other', localPath: 'C:\\work\\..\\other' } })
    expect(actions('git push https://example.invalid/r main; git push host:r main').map((action) => action.writes)).toEqual([[REPOSITORY], [REPOSITORY]])
    expect(actions('git push C:/r main', windows)[0]?.writes).toEqual([REPOSITORY, 'C:\\r'])
    expect(git('git branch -d --remotes origin/x')).toEqual([{ subcommand: 'branch', branchDelete: { branches: ['origin/x'], force: false } }])
  })

  it('git read subcommands list the files their words may name; git config the user files it reads', () => {
    expect(brief('git diff HEAD -- src/a.ts; git blame --contents=draft f; git show HEAD:../x')).toEqual([
      { program: 'git', cwd: '/tmp/demo', reads: [REPOSITORY, '/tmp/demo/HEAD', '/tmp/demo/src/a.ts'] },
      { program: 'git', cwd: '/tmp/demo', reads: [REPOSITORY, '/tmp/demo/draft', '/tmp/demo/f'] },
      { program: 'git', cwd: '/tmp/demo', reads: [REPOSITORY, '/tmp/demo/HEAD:../x'] },
    ])
    expect(actions('git log main^ HEAD~3')[0]?.reads).toEqual([REPOSITORY, '/tmp/demo/main^', '/tmp/demo/HEAD~3'])
    expect(analyze('git log HEAD~3/x', posix)).toEqual({ judged: false, why: 'a zsh extended glob character in a path' })
    expect(brief('git config --local --get a.b; git config --get a.b', { ...posix, env: { ...posix.env, XDG_CONFIG_HOME: '/tmp/demo-xdg' } })).toEqual([
      { program: 'git', cwd: '/tmp/demo', reads: [REPOSITORY] },
      { program: 'git', cwd: '/tmp/demo', reads: [REPOSITORY, '/home/demo/.gitconfig', '/tmp/demo-xdg/git/config'] },
    ])
    expect(actions('git config --get a.b', windows)[0]?.reads).toEqual([REPOSITORY, 'C:\\Users\\demo\\.gitconfig', 'C:\\Users\\demo\\.config\\git\\config'])
    expect(analyze('git config --get a.b', { ...posix, env: {} })).toEqual({ judged: false, why: 'a git config read without HOME' })
  })

  it('git push to a local path writes that path', () => {
    expect(brief('git push ../other main; git push file:///tmp/demo/r main; git push /abs/r; git push ./r; git push host:path main')).toEqual([
      { program: 'git', cwd: '/tmp/demo', writes: [REPOSITORY, '/tmp/demo/../other'], network: true },
      { program: 'git', cwd: '/tmp/demo', writes: [REPOSITORY, '/tmp/demo/r'], network: true },
      { program: 'git', cwd: '/tmp/demo', writes: [REPOSITORY, '/abs/r'], network: true },
      { program: 'git', cwd: '/tmp/demo', writes: [REPOSITORY, '/tmp/demo/./r'], network: true },
      { program: 'git', cwd: '/tmp/demo', writes: [REPOSITORY], network: true },
    ])
    expect(actions('git push ../other main')[0]?.git).toMatchObject({ push: { remote: '../other', localPath: '/tmp/demo/../other' } })
    expect(actions('git push ../other main', windows)[0]?.writes).toEqual([REPOSITORY, 'C:\\work\\..\\other'])
  })

  it('git commands that start no editor and no gpg stay judged', () => {
    expect(git('git commit -m x; git commit -C HEAD; git commit --amend --no-edit; git commit --message=x; git tag v1; git tag -a v1 -m x; git pull --rebase; git pull --rebase=merges; git rebase main')).toEqual(
      ['commit', 'commit', 'commit', 'commit', 'tag', 'tag', 'pull', 'pull', 'rebase'].map((subcommand) => ({ subcommand })),
    )
  })

  it('a git worktree subcommand outside the table writes anything', () => {
    expect(brief('git worktree frobnicate x')).toEqual([{ program: 'git', cwd: '/tmp/demo', writes: [UNKNOWN] }])
  })

  it('git worktree move deletes its source and writes its destination', () => {
    expect(brief('git worktree move a b')).toEqual([{ program: 'git', cwd: '/tmp/demo', writes: [REPOSITORY, '/tmp/demo/b'], deletes: ['/tmp/demo/a'] }])
  })

  it('curl and wget options that write files', () => {
    expect(brief('curl -D h -c j --trace t -o o https://example.invalid; wget -P d -O f https://example.invalid; wget -a l -O g https://example.invalid')).toEqual([
      { program: 'curl', cwd: '/tmp/demo', writes: ['/tmp/demo/h', '/tmp/demo/j', '/tmp/demo/t', '/tmp/demo/o'], network: true },
      { program: 'wget', cwd: '/tmp/demo', writes: ['/tmp/demo/d', '/tmp/demo/f'], network: true },
      { program: 'wget', cwd: '/tmp/demo', writes: ['/tmp/demo/l', '/tmp/demo/g'], network: true },
    ])
  })

  it('an unquoted < after curl -F is a redirection of the input', () => {
    expect(brief('curl -F a=<x https://example.invalid')).toEqual([{ program: 'curl', cwd: '/tmp/demo', reads: ['/tmp/demo/x'], network: true }])
    expect(analyze("curl -F 'a=<x' https://example.invalid", posix)).toEqual({ judged: false, why: 'a curl --form that sends a file' })
  })

  it('a pipeline that fails or succeeds runs what follows ||, &&', () => {
    for (const command of ['echo a | cat || rm x', 'echo a | cat && rm x']) {
      expect(brief(command)).toEqual([
        { program: 'echo', cwd: '/tmp/demo' },
        { program: 'cat', cwd: '/tmp/demo', stdinFrom: 0 },
        { program: 'rm', cwd: '/tmp/demo', deletes: ['/tmp/demo/x'] },
      ])
    }
  })

  it('a pipe inside an inner script names the inner program it reads from', () => {
    expect(brief("echo a; sh -c 'cat < in | wc -l'")).toEqual([
      { program: 'echo', cwd: '/tmp/demo' },
      { program: 'sh', cwd: '/tmp/demo' },
      { program: 'cat', cwd: '/tmp/demo', reads: ['/tmp/demo/in'] },
      { program: 'wc', cwd: '/tmp/demo', stdinFrom: 2 },
    ])
  })

  it('exit with no operand or a number ends the command', () => {
    expect(brief('exit 0; rm x')).toEqual([{ program: 'exit', cwd: '/tmp/demo' }])
    expect(brief('exit; rm x')).toEqual([{ program: 'exit', cwd: '/tmp/demo' }])
  })

  it('the reads and forms the mutation run found untested', () => {
    expect(actions('printf %s "a\\`b"')[0]?.args).toEqual(['%s', 'a`b'])
    expect(brief('$EMPTY x')).toEqual([{ program: 'x', cwd: '/tmp/demo', writes: [UNKNOWN] }])
    expect(brief('curl -d @a --data-raw @b -w @fmt https://example.invalid')).toEqual([{ program: 'curl', cwd: '/tmp/demo', reads: ['/tmp/demo/a', '/tmp/demo/fmt'], network: true }])
    expect(brief('curl --data-urlencode n@f --data-urlencode a=b@c --data-urlencode @g --data-urlencode m@h=i -b jar -b a=b https://example.invalid')).toEqual([
      { program: 'curl', cwd: '/tmp/demo', reads: ['/tmp/demo/f', '/tmp/demo/g', '/tmp/demo/h=i', '/tmp/demo/jar'], network: true },
    ])
    expect(brief('wget --input-file=list -O f https://example.invalid; wget -i - -O f https://example.invalid')).toEqual([
      { program: 'wget', cwd: '/tmp/demo', writes: ['/tmp/demo/f'], reads: ['/tmp/demo/list'], network: true },
      { program: 'wget', cwd: '/tmp/demo', writes: ['/tmp/demo/f'], network: true },
    ])
    expect(brief('git config --list; set -o errexit; set +o nounset')).toEqual([
      { program: 'git', cwd: '/tmp/demo', reads: [REPOSITORY, '/home/demo/.gitconfig', '/home/demo/.config/git/config'] },
      { program: 'set', cwd: '/tmp/demo' },
      { program: 'set', cwd: '/tmp/demo' },
    ])
  })

  it('exactly as many actions as the limit is judged', () => {
    expect(actions('true;'.repeat(199) + 'true')).toHaveLength(200)
  })

  it('a glob may stand where no option is read: rm, rmdir, echo, printf operands, after --', () => {
    expect(brief('cd x && rm -rf *')).toEqual([{ program: 'cd', cwd: '/tmp/demo' }, { program: 'rm', cwd: '/tmp/demo/x', deletes: ['/tmp/demo/x/*'] }])
    expect(brief('rm *; rmdir *; echo *; printf %s *; git grep -e TODO -- *; cat -- *')).toEqual([
      { program: 'rm', cwd: '/tmp/demo', deletes: ['/tmp/demo/*'] },
      { program: 'rmdir', cwd: '/tmp/demo', deletes: ['/tmp/demo/*'] },
      { program: 'echo', cwd: '/tmp/demo' },
      { program: 'printf', cwd: '/tmp/demo' },
      { program: 'git', cwd: '/tmp/demo', reads: [REPOSITORY, '/tmp/demo/TODO', '/tmp/demo/*'] },
      { program: 'cat', cwd: '/tmp/demo', reads: ['/tmp/demo/*'] },
    ])
    expect(analyze('printf *', posix)).toEqual({ judged: false, why: 'a glob that may expand into an option' })
  })

  it('test and [ without -v or -R', () => {
    expect(brief('test -n x; [ -f x ]')).toEqual([{ program: 'test', cwd: '/tmp/demo' }, { program: '[', cwd: '/tmp/demo' }])
  })

  it('cp and mv without the options that link, back up or name the target first', () => {
    for (const command of ['cp -t dir a', 'mv -t dir a', 'ln -b a b', 'cp --backup a b']) {
      expect(analyze(command, posix).judged).toBe(false)
    }
  })

  it('every shell built-in that changes the shell or runs code', () => {
    const builtins = ['eval', 'source', '.', 'exec', 'builtin', 'command', 'alias', 'unalias', 'set', 'shopt', 'setopt', 'unsetopt', 'emulate', 'export', 'readonly', 'local', 'declare', 'typeset', 'integer', 'float', 'unset', 'trap', 'read', 'mapfile', 'readarray', 'let', 'getopts', 'pushd', 'popd', 'dirs', 'zmodload', 'autoload', 'enable', 'disable', 'hash', 'rehash', 'unhash', 'fc', 'history', 'r', 'return', 'break', 'continue', 'shift', 'wait', 'jobs', 'fg', 'bg', 'disown', 'functions', 'unfunction', 'noglob', 'nocorrect', '-', 'ulimit', 'umask', 'limit', 'unlimit', 'bindkey', 'zle', 'zstyle', 'zparseopts', 'zpty', 'zsocket', 'ztcp', 'sched', 'vared', 'compdef', 'compinit', 'zcompile', 'caller', 'complete', 'compgen', 'compopt', 'suspend', 'logout', 'times', 'ttyctl', 'pushln', 'chdir']
    for (const name of builtins) expect([name, analyze(`${name} x`, posix)]).toEqual([name, { judged: false, why: 'a shell built-in that changes the shell or runs code' }])
  })

  it('every reserved word', () => {
    for (const word of ['if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'while', 'until', 'do', 'done', 'in', 'function', 'select', 'time', 'coproc', 'repeat', 'foreach', 'end', ']]']) {
      expect([word, analyze(`${word} x`, posix)]).toEqual([word, { judged: false, why: 'a reserved word: if, for, while, case, a function or a group' }])
    }
  })

  it('every variable the shell gives a meaning to, by name and by prefix; other names are free', () => {
    const special = [
      'IFS', 'PATH', 'CDPATH', 'HOME', 'PWD', 'OLDPWD', 'TMPDIR', 'TMPPREFIX', 'TMPSUFFIX', 'ENV', 'SHELL', 'SHELLOPTS', 'SHLVL', 'POSIXLY_CORRECT', 'GLOBIGNORE', 'GLOBSORT', 'EXECIGNORE', 'FIGNORE', 'FCEDIT', 'EDITOR', 'VISUAL', 'PAGER',
      'MAIL', 'MAILCHECK', 'MAILPATH', 'MANPATH', 'MODULE_PATH', 'FPATH', 'NULLCMD', 'READNULLCMD', 'STTY', 'TMOUT', 'TIMEFORMAT', 'TIMEFMT', 'REPORTTIME', 'REPORTMEMORY', 'KEYTIMEOUT', 'WORDCHARS', 'WATCH', 'WATCHFMT', 'LOGCHECK', 'SAVEHIST', 'LISTMAX', 'DIRSTACKSIZE', 'CORRECT_IGNORE', 'CORRECT_IGNORE_FILE', 'SPROMPT', 'RPROMPT', 'RPROMPT2', 'RPS1', 'RPS2', 'POSTEDIT', 'PSVAR', 'ZDOTDIR', 'ZBEEP', 'KEYBOARD_HACK', 'TERM', 'TERMINFO', 'TERMINFO_DIRS', 'LANG', 'LINES', 'COLUMNS', 'BAUD', 'CHILD_MAX', 'FUNCNEST', 'HOSTFILE', 'INPUTRC', 'IGNOREEOF', 'EMACS', 'INSIDE_EMACS', 'auto_resume', 'histchars', 'HISTCHARS',
      'OPTIND', 'OPTARG', 'OPTERR', 'REPLY', 'LINENO', 'RANDOM', 'SRANDOM', 'SECONDS', 'EPOCHSECONDS', 'EPOCHREALTIME', 'PPID', 'UID', 'EUID', 'GID', 'EGID', 'GROUPS', 'HOSTNAME', 'HOSTTYPE', 'MACHTYPE', 'OSTYPE', 'CPUTYPE', 'VENDOR', 'HOST', 'LOGNAME', 'USERNAME', 'TTY', 'TTYIDLE', 'ERRNO', 'ARGV0', 'PIPESTATUS', 'FUNCNAME', 'DIRSTACK', 'COPROC', 'MAPFILE', 'MATCH', 'MBEGIN', 'MEND', 'CURSOR', 'BUFFER', 'LBUFFER', 'RBUFFER', 'MARK', 'CONTEXT', 'KEYS', 'NUMERIC', 'WIDGET', 'LASTWIDGET', 'PREBUFFER', 'PREDISPLAY', 'POSTDISPLAY', 'BUFFERLINES', 'HISTNO',
      'path', 'cdpath', 'fpath', 'manpath', 'module_path', 'mailpath', 'fignore', 'psvar', 'prompt', 'watch', 'argv', 'status', 'pipestatus', 'signals', 'match', 'mbegin', 'mend', 'reply', 'options', 'parameters', 'commands', 'functions', 'aliases', 'galiases', 'saliases', 'builtins', 'history', 'historywords', 'jobdirs', 'jobstates', 'jobtexts', 'modules', 'nameddirs', 'userdirs', 'usergroups', 'reswords', 'dirstack', 'funcstack', 'funcfiletrace', 'funcsourcetrace', 'functrace', 'widgets', 'keymaps', 'mapfile', 'errnos', 'sysparams', 'termcap', 'terminfo', 'patchars', 'epochtime', 'langinfo', 'killring', 'region_highlight', 'zsh_eval_context', 'zsh_scheduled_events', '_',
    ]
    const prefixed = ['BASH_X', 'ZSH_X', 'zsh_x', 'ZLE_X', 'zle_x', 'HISTX', 'PS9', 'PROMPTX', 'COMPX', 'READLINEX', 'LC_X', 'GIT_X', 'LD_X', 'DYLD_X', 'dis_x', 'ZFTPX', 'zftp_x', 'ztcpx', 'ISEARCHX', 'YANKX', 'TRY_BLOCKX']
    for (const name of [...special, ...prefixed]) {
      expect([name, analyze(`${name}=x`, bare)]).toEqual([name, { judged: false, why: 'an assignment to a variable the shell gives a meaning to' }])
    }
    for (const name of ['X', 'x', 'build_dir', 'aPS1', 'xBASH', 'XGIT_']) expect([name, analyze(`${name}=x`, bare).judged]).toEqual([name, true])
  })

  it('a new temporary folder is recognised by its name, nothing else is', () => {
    expect(isNewTempFolder(newTempFolderName(1))).toBe(true)
    expect(isNewTempFolder(newTempFolderName(12))).toBe(true)
    for (const name of ['<new-temp-folder-0>', '<new-temp-folder-01>', '<new-temp-folder->', 'x<new-temp-folder-1>', '<new-temp-folder-1>x', 'new-temp-folder-1', UNKNOWN]) {
      expect([name, isNewTempFolder(name)]).toEqual([name, false])
    }
    expect(actions('A=$(mktemp -d) && B=$(mktemp -d) && rm -rf "$A" "$B"')[2]?.deletes).toEqual([`/tmp/demo-tmp/${newTempFolderName(1)}`, `/tmp/demo-tmp/${newTempFolderName(2)}`])
  })
})

describe('Windows (Git Bash)', () => {
  const deletes = (command: string): string[] => actions(command, windows).flatMap((action) => action.deletes)

  it('C:\\…, C:/… and /c/… are one path, separators \\', () => {
    for (const command of ["rm -rf 'C:\\work\\sub\\x'", 'rm -rf C:/work/sub/x', 'rm -rf /c/work/sub/x', 'rm -rf sub/x', "rm -rf 'sub\\x'"]) {
      expect(deletes(command)).toEqual(['C:\\work\\sub\\x'])
    }
  })

  it('the case of the letters stays as written; the drive letter is upper case', () => {
    expect(deletes('rm -rf /c/Work/X c:/work/x')).toEqual(['C:\\Work\\X', 'C:\\work\\x'])
  })

  it('cd and a glob, ~, mktemp: the same actions as on Linux', () => {
    expect(actions('cd /c/work/sub && rm -rf *', windows).map((action) => [action.cwd, action.deletes])).toEqual([
      ['C:\\work', []],
      ['C:\\work\\sub', ['C:\\work\\sub\\*']],
    ])
    expect(deletes('rm ~/x')).toEqual(['C:\\Users\\demo\\x'])
    const temp = `C:\\Temp\\${newTempFolderName(1)}`
    expect(actions('T=$(mktemp -d) && rm -rf "$T"/*', windows).map((action) => [...action.writes, ...action.deletes])).toEqual([[temp], [`${temp}\\*`]])
  })

  it('$PWD, $HOME and $TMPDIR as Git Bash spells them', () => {
    expect(actions('printf %s "$PWD" "$HOME" "$TMPDIR" "$TMP" "$TEMP"', { ...windows, env: { ...windows.env, TMP: 'D:\\t', TEMP: 'C:/t', OTHER: 'C:\\o' } })[0]?.args).toEqual(['%s', '/c/work', '/c/Users/demo', '/c/Temp', '/d/t', '/c/t'])
    expect(actions('printf %s "$OTHER"', { ...windows, env: { OTHER: 'C:\\o' } })[0]?.args).toEqual(['%s', 'C:\\o'])
  })

  it('paths outside a drive, UNC paths, drive-relative paths and an unquoted backslash are not judged', () => {
    for (const command of ['rm -rf /tmp/x', 'rm -rf //server/share/x', "rm -rf '\\\\server\\share'", 'rm -rf C:x', 'rm -rf C:\\work\\x', "rm -rf 'C:\\work'/*\\x"]) {
      expect(analyze(command, windows).judged).toBe(false)
    }
  })

  it('the same command on Linux and on Windows lists the same actions', () => {
    const linux = { ...posix, cwd: '/c/work', env: { HOME: '/c/Users/demo', TMPDIR: '/c/Temp' } }
    const toWindows = (path: string): string => path.replace(/^\/c/, 'C:').replaceAll('/', '\\')
    for (const command of ['cd sub && rm -rf build/* "$HOME/x"', 'T=$(mktemp -d) && cp a "$T"/b', 'git -C sub clean -fd', "zsh -c 'cd a || exit\nrm -rf b'", 'rm -rf ~/x/*']) {
      // The words may spell a path either way; what the policy reads is the same.
      const onLinux = actions(command, linux).map((action) => ({ ...action, args: [], cwd: toWindows(action.cwd), writes: action.writes.map((path) => (path.startsWith('/') ? toWindows(path) : path)), deletes: action.deletes.map(toWindows), reads: action.reads.map(toWindows) }))
      expect(actions(command, windows).map((action) => ({ ...action, args: [] }))).toEqual(onLinux)
    }
  })
})
