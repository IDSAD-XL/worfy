// The shell command parser of auto-approval (worfy-auto-approve ticket 02): what it reads, with
// which paths, and every construct it refuses to judge. Paths are made up (/tmp/demo, C:\work).
import { describe, expect, it } from 'vitest'
import { analyze, NEW_TEMP_FOLDER, REPOSITORY, UNKNOWN, type AnalyzeContext, type ShellAction } from '../../src/main/agent/auto-approve/shell'

const posix: AnalyzeContext = {
  cwd: '/tmp/demo',
  env: { HOME: '/home/demo', TMPDIR: '/tmp/demo-tmp/', M: '/tmp/demo/m', d: 'build', SPACED: 'a b', STAR: 'a*', EMPTY: '' },
  platform: 'linux',
}
const windows: AnalyzeContext = { cwd: 'C:\\work', env: { HOME: 'C:\\Users\\demo', TMPDIR: 'C:\\Temp' }, platform: 'win32' }

const temp1 = `/tmp/demo-tmp/${NEW_TEMP_FOLDER.slice(0, -1)}-1>`

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
  const cases: Array<[string, string]> = [
    ['command substitution in a target', 'rm -rf $(echo x)'],
    ['backquotes', 'rm -rf `echo x`'],
    ['arithmetic', 'rm -rf $((1 + 1))'],
    ['a command substitution inside quotes', 'rm -rf "$(echo x)/y"'],
    ['mktemp substitution outside an assignment', 'rm -rf "$(mktemp -d)"'],
    ['mktemp with a template', 'T=$(mktemp -d -t x)'],
    ['eval', 'eval rm x'],
    ['source', 'source ./env.sh'],
    ['.', '. ./env.sh'],
    ['exec', 'exec rm x'],
    ['command', 'command rm x'],
    ['builtin', 'builtin cd /'],
    ['alias', 'alias ls=rm'],
    ['export', 'export X=1'],
    ['set other than -e/-u/-x/pipefail', 'set -o noglob'],
    ['set -f', 'set -f'],
    ['a function', 'f() { rm x; }'],
    ['the function keyword', 'function f { :; }'],
    ['for', 'for f in a b; do rm $f; done'],
    ['while', 'while true; do :; done'],
    ['if', 'if true; then rm x; fi'],
    ['case', 'case x in x) rm y ;; esac'],
    ['a subshell', '(cd x && rm y)'],
    ['a group', '{ rm x; }'],
    ['a here-doc', 'cat <<EOF\nx\nEOF'],
    ['a here-string', 'cat <<< x'],
    ['process substitution in', 'diff <(ls) x'],
    ['process substitution out', 'tee >(cat) x'],
    ['zmodload', 'zmodload zsh/files'],
    ['an unknown variable', 'rm -rf "$UNKNOWN_DEMO"/x'],
    ['an unquoted value with a blank', 'rm -rf $SPACED'],
    ['an unquoted value with a glob', 'rm -rf $STAR'],
    ['IFS in the environment', 'rm x'],
    ['an assignment to IFS', 'IFS=/; rm x'],
    ['a reference to IFS', 'printf %s "$IFS"'],
    ['~user', 'rm -rf ~demo/x'],
    ['~+', 'rm -rf ~+/x'],
    ['a ~ before quotes', 'rm -rf ~"/x"'],
    ['a ~ after = in an argument (bash expands it)', 'printf %s a=~/b'],
    ['a special parameter', 'rm $1'],
    ['$@', 'rm "$@"'],
    ['$?', 'printf %s $?'],
    ['a default value expansion', 'rm ${X:-/}'],
    ['a length expansion', 'rm ${#M}'],
    ['a zsh subscript in quotes', 'rm "$M[1]"'],
    ['a zsh modifier', 'rm $M:h'],
    ['ANSI-C quotes', "rm $'a'"],
    ['brace expansion', 'rm {a,b}'],
    ['a [ glob', 'rm [ab]'],
    ['! negation', '! rm x'],
    ['zsh = expansion', 'rm =ls'],
    ['background &', 'sleep 1 &'],
    ['&> redirection', 'rm x &> log'],
    ['|& pipe', 'rm x |& cat'],
    ['<& duplication', 'cat <&3'],
    ['>& to a file', 'echo x >& log'],
    ['an fd of two digits', 'echo x 10>log'],
    ['a duplication to an fd of two digits', 'echo x >&12'],
    ['an += assignment', 'X=a; X+=b; rm -rf "$X"'],
    ['a zsh = expansion in an assignment', 'X==rm; $X a'],
    ['an assignment before a program', 'X=a rm $X'],
    ['an assignment to PATH', 'PATH=/tmp/demo; rm x'],
    ['an assignment to an exported variable', 'M=/; rm -rf "$M"'],
    ['an assignment to HOME', 'HOME=/; rm -rf ~/x'],
    ['an assignment to TMPDIR', 'TMPDIR=/; T=$(mktemp -d)'],
    ['an assignment to a GIT_ variable', 'GIT_DIR=/x; git status'],
    ['cd inside a pipeline', 'echo a | cd x'],
    ['an assignment inside a pipeline', 'echo a | X=1'],
    ['cd -', 'cd -'],
    ['cd -P', 'cd -P x'],
    ['cd with two operands', 'cd a b'],
    ['a glob in cd', 'cd /tmp/demo/*'],
    ['a carriage return', 'rm x\r'],
    ['a backslash at the end', 'rm x\\'],
    ['an unterminated single quote', "rm 'x"],
    ['an unterminated double quote', 'rm "x'],
    [';;', 'rm a;;'],
    ['a leading ;', '; rm a'],
    ['an empty command between ;', 'rm a; ; rm b'],
    ['&& at the end', 'rm a &&'],
    ['&& at the start', '&& rm a'],
    ['a redirection without a target', 'echo x >'],
    ['a redirection without a program', '> x'],
    ['a glob before the last component', 'rm -rf /tmp/demo/*/x'],
    ['a literal glob character in a path', "rm -rf '/tmp/demo/*'"],
    ['a zsh extended glob character in a path', 'rm -rf a~b'],
    ['a ^ in a path', 'rm -rf ^keep'],
    ['an empty path', 'rm -rf ""'],
    ['an empty path from a variable', 'rm -rf "$EMPTY"'],
    ['a glob in a redirection', 'echo x > *.log'],
    ['a glob in a destination', 'mv a dst*'],
    ['an option after an operand', 'rm x -rf'],
    ['-- after an operand', 'rm x -- -w'],
    ['an option the table does not know', 'rm --demo x'],
    ['mv without a destination', 'mv a'],
    ['rmdir -p', 'rmdir -p a/b'],
    ['tee to -', 'tee -'],
    ['printf -v', 'printf -v X %s a'],
    ['mktemp without -d', 'mktemp'],
    ['a shell option before -c', "bash -lc 'rm x'"],
    ['a shell -c with positional arguments', "bash -c 'rm x' demo-arg0"],
    ['an inner script outside the grammar', "zsh -c 'rm $(echo x)'"],
    ['shells nested too deep', `sh -c "sh -c 'sh -c \\"sh -c rm\\"'"`],
    ['too many folders after cd', 'cd a; cd b; cd c; cd d; rm x'],
    ['git -c', 'git -c core.fsmonitor=x status'],
    ['git --git-dir', 'git --git-dir=/x status'],
    ['git clean with a glob pathspec', "git clean -fd '*.log'"],
    ['git clean with pathspec magic', 'git clean -fd :/'],
    ['git push --receive-pack', 'git push --receive-pack=x origin'],
    ['git push with an abbreviated option', 'git push --forc origin main'],
    ['git rebase -i', 'git rebase -i HEAD~2'],
    ['git rebase --exec', 'git rebase --exec=x main'],
    ['git commit -F', 'git commit -F msg.txt'],
    ['git commit --file by a prefix', 'git commit --fil=msg.txt'],
    ['git diff --output', 'git diff --output=x'],
    ['git grep -O', 'git grep -O x'],
    ['curl -K', 'curl -K cfg https://example.invalid'],
    ['curl -O', 'curl -O https://example.invalid/x'],
    ['curl --form with a file', 'curl -F a=@x https://example.invalid'],
    ['curl --write-out to a file', "curl -w '%output{x}' https://example.invalid"],
    ['wget without -O', 'wget https://example.invalid/x'],
    ['wget -e', 'wget -e x https://example.invalid'],
    ['a relative cd with CDPATH', 'cd sub'],
    ['$PWD after cd ..', 'cd .. && printf %s "$PWD"'],
  ]
  const contexts: Record<string, AnalyzeContext> = {
    'IFS in the environment': { ...posix, env: { ...posix.env, IFS: ' ' } },
    'a relative cd with CDPATH': { ...posix, env: { ...posix.env, CDPATH: '/tmp' } },
  }

  it.each(cases)('%s', (name, command) => {
    const analysis = analyze(command, contexts[name] ?? posix)
    expect(analysis).toMatchObject({ judged: false })
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

  it('rmdir, mv, cp, ln, mkdir, touch, tee', () => {
    expect(brief('rmdir a; mv -f a b; cp -r a b c; ln -sf t l; mkdir -p -m 755 d; touch -r ref f; tee -a log')).toEqual([
      { program: 'rmdir', cwd: '/tmp/demo', deletes: ['/tmp/demo/a'] },
      { program: 'mv', cwd: '/tmp/demo', deletes: ['/tmp/demo/a'], writes: ['/tmp/demo/b'] },
      { program: 'cp', cwd: '/tmp/demo', reads: ['/tmp/demo/a', '/tmp/demo/b'], writes: ['/tmp/demo/c'] },
      { program: 'ln', cwd: '/tmp/demo', writes: ['/tmp/demo/l'] },
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
      { program: 'git', cwd: '/tmp/demo', writes: [REPOSITORY], network: true },
    ])
    expect(actions('git push --force-with-lease=x -u origin +x')[0]?.args).toEqual(['push', '--force-with-lease=x', '-u', 'origin', '+x'])
  })

  it('git reads, local changes, config, and an unknown subcommand or alias', () => {
    expect(brief('git status; git log --oneline HEAD~3; git commit -am msg; git fetch origin; git config --get user.name; git config core.pager x; git demo-alias')).toEqual([
      { program: 'git', cwd: '/tmp/demo', reads: [REPOSITORY] },
      { program: 'git', cwd: '/tmp/demo', reads: [REPOSITORY] },
      { program: 'git', cwd: '/tmp/demo', writes: [REPOSITORY] },
      { program: 'git', cwd: '/tmp/demo', writes: [REPOSITORY], network: true },
      { program: 'git', cwd: '/tmp/demo', reads: [REPOSITORY] },
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
    const temp = `C:\\Temp\\${NEW_TEMP_FOLDER.slice(0, -1)}-1>`
    expect(actions('T=$(mktemp -d) && rm -rf "$T"/*', windows).map((action) => [...action.writes, ...action.deletes])).toEqual([[temp], [`${temp}\\*`]])
  })

  it('$PWD as Git Bash spells it', () => {
    expect(actions('printf %s "$PWD"', windows)[0]?.args).toEqual(['%s', '/c/work'])
  })

  it('paths outside a drive, UNC paths, drive-relative paths and an unquoted backslash are not judged', () => {
    for (const command of ['rm -rf /tmp/x', 'rm -rf //server/share/x', "rm -rf '\\\\server\\share'", 'rm -rf C:x', 'rm -rf C:\\work\\x', "rm -rf 'C:\\work'/*\\x"]) {
      expect(analyze(command, windows).judged).toBe(false)
    }
  })

  it('the same command on Linux and on Windows lists the same actions', () => {
    const linux = { ...posix, cwd: '/c/work', env: { HOME: '/c/Users/demo', TMPDIR: '/c/Temp' } }
    const toWindows = (path: string): string => path.replace(/^\/c/, 'C:').replaceAll('/', '\\')
    for (const command of ['cd sub && rm -rf build/* "$HOME/x"', 'T=$(mktemp -d) && cp a "$T"/b', 'git -C sub clean -fd', "zsh -c 'cd a || exit\nrm -rf b'"]) {
      // The words may spell a path either way (HOME is C:\… here); what the policy reads is the same.
      const onLinux = actions(command, linux).map((action) => ({ ...action, args: [], cwd: toWindows(action.cwd), writes: action.writes.map((path) => (path.startsWith('/') ? toWindows(path) : path)), deletes: action.deletes.map(toWindows), reads: action.reads.map(toWindows) }))
      expect(actions(command, windows).map((action) => ({ ...action, args: [] }))).toEqual(onLinux)
    }
  })
})
