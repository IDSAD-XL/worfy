# Code story — worfy-pr-follow 03: Skill `/worfy:pr-fix`: режим `conflicts` — rebase и `--force-with-lease` в Full mode, merge commit в Silent mode

Kind: pr · Epic: worfy-pr-follow · Ticket: 03 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 02 skill `pr-fix` на режим `conflicts` отвечал «not supported yet», и кнопке Resolve conflicts было
некуда вести. PR добавляет режим: `git merge-tree` называет файлы конфликта, в Full mode — rebase и push только с
`--force-with-lease`, в Silent mode — merge commit без rebase и force-push. Заодно PR закрывает долг Ticket-а 02 по
guard-ам: склеенные формы `gh api` и `gh` в любой позиции команды.

- Требование: [Что происходит](../issues/03-skill-pr-fix-conflicts.md#что-происходит)

## 2. Сначала назвать конфликт, без конфликта — ничего не трогать

Code: `harness/skills/pr-fix/SKILL.md:141-156` · key lines: 146, 154, 156

````md
`mergeStateStatus` is what GitHub last computed; `git merge-tree` says whether the head conflicts with the head of the
base now. Name the files in conflict before any change:

```bash
git -C "<worktree>" cat-file -e "<baseRefOid>^{commit}"; echo "EXIT=$?"
git -C "<worktree>" merge-tree --write-tree --name-only "<baseRefOid>" HEAD; echo "EXIT=$?"
```

When the base commit is missing, fetch it once, `git -C "<checkout>" fetch origin "<baseRefName>"`; when that fails
too, stop and say why. `merge-tree` writes no file, no index and no ref: it prints the tree of the merge on its first
line and, on exit 1, the files in conflict, one per line. Another exit code: show its line and stop (git before 2.38
has no `--write-tree`).

- **Exit 0 — no conflict.** When `git -C "<worktree>" merge-base --is-ancestor "<baseRefOid>" HEAD` exits 0, the
  worktree holds the rebase or the merge of an earlier run: go on with step 6. Otherwise say that `<headRefName>` does
  not conflict with `<baseRefName>`, that nothing was changed, and stop: a base that moved on is no reason to rebase
````

- Что делает: `merge-tree` против head базы называет файлы конфликта до любой правки и ничего не пишет в worktree.
  Exit 0 — конфликта нет, skill ничего не меняет и останавливается.
- Почему здесь: Ticket требует назвать файлы конфликта до правки (п. 1.1); бриф напоминает ADR-0103 — PR с зелёным
  `ci-ok` вливается без rebase ради свежей базы.
- Без него: skill делал бы rebase на каждый сдвиг базы, а это новый head, новый CI и новое ревью без нужды.
- Требование: [Что делаем, п. 1.1](../issues/03-skill-pr-fix-conflicts.md#что-делаем)
- Риски и пробелы test-ов: contract test проверяет, что строка skill-а даёт exit 1 и `src/sum.mjs` на fixture
  конфликта и exit 0 на fixture `pr-fix-checks`. Что модель остановится при exit 0, проверяет только текст: eval-кейса
  без конфликта нет.

## 3. Политика по режиму: rebase в Full mode, merge commit в Silent mode

Code: `harness/skills/pr-fix/SKILL.md:168-192` · key lines: 173, 180, 185

````md
Then settle it by `_resolved.mode`:

- **Full mode — a rebase** onto the head of the base:

  ```bash
  git -C "<worktree>" rebase "<baseRefOid>"; echo "EXIT=$?"
  ```

  The rebase stops at each commit that conflicts. Settle each file in the worktree — keep what both sides meant, remove
  the markers — add them with `git -C "<worktree>" add <files>`, and go on with
  `git -C "<worktree>" -c core.editor=true rebase --continue`, until the rebase exits 0. A commit whose conflict needs
  a decision: `git -C "<worktree>" rebase --abort` puts the worktree back at `<headRefOid>`; then ask as above.
- **Silent mode — a merge commit.** A branch of a team repository may already be in a colleague's hands: no rebase and
  no force-push. `<message>` is "Merge <baseRefName> into <headRefName>" in `language.team`; check it first with
  `"${CLAUDE_PLUGIN_ROOT}/bin/silent-check" -C "<worktree>" "<message>"`:

  ```bash
  git -C "<worktree>" merge -m "<message>" "<baseRefOid>"; echo "EXIT=$?"
  ```

  The merge stops with the conflict. Settle each file as above, add them with `git -C "<worktree>" add <files>`, and
  `git -C "<worktree>" commit --no-edit --cleanup=strip` makes the merge commit with that message: `--cleanup=strip`
  drops the `# Conflicts:` lines git adds to it, which would otherwise reach the team's repository.

The rebase or the merge commit is the commit of this mode: go on with step 6, which checks it.
````

- Что делает: в Full mode — rebase на head базы в worktree. В Silent mode — merge commit с сообщением, которое сначала
  проверяет `silent-check`; rebase и force-push там запрещены.
- Почему здесь: spec, Q4 — политика по режиму Profile-а. В Silent mode ветку командного репозитория мог взять
  коллега, а responder Kiro никогда не делает rebase и force-push.
- Без него: в Silent mode rebase переписал бы историю, которую видит команда.
- Требование: [Что делаем, п. 1.2–1.3](../issues/03-skill-pr-fix-conflicts.md#что-делаем)
- Риски и пробелы test-ов: grader `no-publish-command` кейса `pr-fix-conflicts-silent` ловит любой `git rebase`;
  `merged-in-worktree` требует merge commit (`head=yes merges=1`), `rebased-in-worktree` — rebase (`head=no merges=0`).
  Разрешение конфликта, которому нужно решение о дизайне, eval не проверяет: в fixture конфликт механический.

## 4. Push после rebase — только с lease на head до rebase

Code: `harness/skills/pr-fix/SKILL.md:264-277` · key lines: 265, 271, 276

````md
Then, unless the person already answered "Not now", ask with AskUserQuestion "Push <n> commit(s) to <headRefName>?"
with the options "Push" and "Not now" — in mode `conflicts` in Full mode "Force-push (with lease) <n> commit(s) to
<headRefName>?", with the same options. Only on "Push", the first command; in mode `conflicts` in Full mode, the
second one instead, never a bare `--force`:

```bash
git -C "<worktree>" push origin "HEAD:refs/heads/<headRefName>"; echo "EXIT=$?"
git -C "<worktree>" push --force-with-lease="<headRefName>:<headRefOid>" origin "HEAD:refs/heads/<headRefName>"; echo "EXIT=$?"
```

A rejected push is never forced. Without the lease it means the branch moved on GitHub; with the lease it means the
branch is no longer at `<headRefOid>`: someone pushed to it after the head this run started from, and a force-push
would drop their commits. Push nothing else — no second lease on the new head, no `--force` — say so, and stop: whether
their commits stay is the person's decision, and this command with the new head starts over on it.
````

- Что делает: вопрос в Full mode называет force-push с lease. Push после rebase — только
  `--force-with-lease=<branch>:<head до rebase>`. Если lease отказал, skill больше ничего не пушит.
- Почему здесь: Ticket, п. 1.2 — «никогда голый `--force`»; spec, «Риски», «Force-push».
- Без него: голый `--force` стёр бы commit, который кто-то запушил в ветку после head этого прогона.
- Требование: [Риски](../spec.md#риски)
- Риски и пробелы test-ов: платный eval не может ответить «Push» на вопрос: AskUserQuestion в прогоне нет, а «Push»,
  написанный заранее, skill ответом не считает. Поэтому сам push проверяет contract test (шаг 5).

## 5. Lease отказывает, когда ветку сдвинули; голый `--force` бы прошёл

Code: `test/contract/harness-evals.test.ts:2214-2237` · key lines: 2216, 2223, 2230, 2235

```ts
    const marker = read(work, MARKER)
    const lease = fill(line('git -C "<worktree>" push --force-with-lease'), v)
    expect(words(lease)).toContain(`--force-with-lease=sum-all:${head}`)
    const atBare = (): string => git(work, home, `git --git-dir "${bare}" rev-parse refs/heads/sum-all`).stdout.trim()
    // A colleague pushed a commit to the branch after the head this run started from.
    const tree = git(work, home, `git --git-dir "${bare}" rev-parse ${head}^{tree}`).stdout.trim()
    const theirs = git(work, home, `git --git-dir "${bare}" commit-tree ${tree} -p ${head} -m colleague`).stdout.trim()
    expect(git(work, home, `git --git-dir "${bare}" update-ref refs/heads/sum-all ${theirs} ${head}`).status).toBe(0)
    const refused = git(work, home, lease)
    expect(refused.status, refused.stderr).not.toBe(0)
    expect(refused.stderr).toMatch(/stale info|rejected/)
    expect(atBare()).toBe(theirs)
    expect(published(CONFLICTS, work)).toBe(false)
    // A bare --force would have dropped it: the lease is what refuses.
    const forced = git(work, home, `git -C "${worktree}" push --force origin HEAD:refs/heads/sum-all`)
    expect(forced.status, forced.stderr).toBe(0)
    expect(git(work, home, `git --git-dir "${bare}" merge-base --is-ancestor ${theirs} refs/heads/sum-all`).status).toBe(1)
    // The branch still at the old head: the lease push lands, and the marker records it.
    expect(git(work, home, `git --git-dir "${bare}" update-ref refs/heads/sum-all ${head}`).status).toBe(0)
    writeFileSync(join(work, MARKER), marker)
    const landed = git(work, home, lease)
    expect(landed.status, landed.stderr).toBe(0)
    expect(atBare()).toBe(git(work, home, `git -C "${worktree}" rev-parse HEAD`).stdout.trim())
    expect(published(CONFLICTS, work)).toBe(true)
```

- Что делает: test запускает строку push из SKILL.md на fixture. Сначала коллега сдвигает `sum-all` в bare-репозитории:
  lease отказывает, marker не тронут. Голый `--force` в той же ситуации стирает чужой commit. Потом ветка снова на
  старом head, и lease push проходит, marker это записывает.
- Почему здесь: бриф требует, чтобы eval проверял отказ lease, когда ветку сдвинули; fixture этого Ticket-а —
  `pr-fix.cjs` в режиме `conflicts`.
- Без него: подмену lease на `--force` или lease без ожидаемого SHA поймал бы только текстовый test.
- Требование: [Готово, когда](../issues/03-skill-pr-fix-conflicts.md#готово-когда)
- Риски и пробелы test-ов: test пропущен на Windows, как и прочие test-ы push-ей этого набора.

## 6. Stand-in gh читает опции `gh api` так же, как gh

Code: `harness/evals/pr-fix-checks/fixture/gh.mjs:62-86` · key lines: 76, 82, 83

```js
/**
 * The method, the fields and the input of an `api` call, read as gh reads its options: `-X POST`, `-XPOST`,
 * `--method POST`, `--method=POST`; `-f k=v`, `-fk=v`, `-F`, `--field k=v`, `--field=k=v`, `--raw-field`; `--input f`,
 * `--input=f`; and short options glued after the boolean `-i` (`-iX POST`, `-ifk=v`). The last method counts, as in gh.
 */
const apiOptions = () => {
  const out = { methods: [], fields: [], input: false }
  const take = (flag, value) => {
    if (flag === 'X' || flag === '--method') out.methods.push(value ?? '')
    else if (flag === 'f' || flag === 'F' || flag === '--field' || flag === '--raw-field') out.fields.push(value ?? '')
    else if (flag === '--input') out.input = true
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const long = /^(--method|--field|--raw-field|--input)(?:=([\s\S]*))?$/.exec(arg)
    if (long !== null) {
      if (long[2] !== undefined) take(long[1], long[2])
      else take(long[1], args[++i])
      continue
    }
    const short = /^-i*([XfF])([\s\S]*)$/.exec(arg)
    if (short !== null && !arg.startsWith('--')) take(short[1], short[2] === '' ? args[++i] : short[2])
  }
  return out
}
```

- Что делает: метод, поля и `--input` stand-in читает во всех написаниях gh: `-fbody=x`, `-Fbody=x`, `--field=`,
  `--raw-field=`, `--input=`, `-iX`. Из нескольких `-X` берётся последний.
- Почему здесь: долг Ticket-а 02, пункт (1): раньше stand-in пропускал эти формы как чтения (`gh.mjs:114`, `:127`).
- Без него: `gh api …/comments -fbody=x` — настоящий POST — прошёл бы как чтение, marker остался бы на месте.
- Требование: [Готово, когда](../issues/03-skill-pr-fix-conflicts.md#готово-когда)
- Риски и пробелы test-ов: grader `no-publish-command` повторяет это правило своим regex-ом. Он теперь ловит `gh` в
  любой позиции как отдельное слово, в том числе после `time`, `env`, `xargs`, внутри `bash -c` и по абсолютному пути.
  Цена — ложная тревога на `echo gh pr merge`: она в безопасную сторону. Вызов через переменную (`$GH pr merge`) regex
  не видит.

## 7. Как проверено

- `vitest run` harness-evals, harness-evals-outcome, harness-evals-run, harness-evals-story, harness-migrate — exit 0
  (526 passed).
- `node scripts/eval-harness-coverage.mjs` — exit 0.
- `node scripts/eval-harness.mjs --dry-run --case <кейс>` для `pr-fix-checks`, `pr-fix-comments`, `pr-fix-conflicts`,
  `pr-fix-conflicts-silent` — exit 0 у каждого.
- `pnpm lint`, `pnpm typecheck`, `bash harness/bin/tests/plugin-neutral.test.sh` — exit 0.
- gate fast — exit 0 (`[gate] green (fast)`: lint, typecheck, test). `pnpm lint && pnpm typecheck && pnpm test` — exit 1:
  два test-а вне этого PR (`project-pulse.test.ts:257`, `terminal-ai-zle.test.ts:892`) упали под нагрузкой полного
  набора; эти два файла отдельно — exit 0.
- Mutant-ы (все красные): glued `-fk=v` не поле; первый `-X` вместо последнего; `--field=`/`--input=` не читаются;
  regex только с голыми `-f`/`-F`; regex с `gh` только в начале команды; regex без `\n` перед `gh`; regex, где
  подкоманда может начаться с оператора; push в SKILL.md через голый `--force`; lease без ожидаемого SHA; lease вместе
  с `--force`; lease на remote-tracking ref.
- Платный eval на 6f0f63a98 (запускал Orchestrator, 2 run-а на кейс, потолок 3 USD на кейс): `pr-fix-checks` 1.00
  (0.80 USD), `pr-fix-comments` 1.00 (1.20 USD), `pr-fix-conflicts` 0.96 (0.75 USD), `pr-fix-conflicts-silent` 1.00
  (0.83 USD); всего 3.58 USD.
- Раунд 2: contract test закрепляет три фразы, которые держат push безопасным (push только на «Push», отказ не
  форсится, без ответа и без человека push нет); mutant-ы «на любой ответ», «повтор с `--force`», «без человека —
  push» красные. Пути в командах git test-ов в кавычках: блок pr-fix зелёный с TMPDIR, где есть пробел. Merge commit в
  Silent mode — с `--cleanup=strip`: mutant без него красный, в сообщении остаются строки `# Conflicts:`.

## Проверить себя

1. Почему при exit 0 у `merge-tree` skill ничего не делает, хотя база ушла вперёд?
   - Ответ: rebase ради свежей базы даёт новый head, новый CI и новое ревью без нужды; PR с зелёными checks вливается как есть.
   - Строки: `harness/skills/pr-fix/SKILL.md:154-156`
2. Почему lease несёт SHA head-а до rebase, а не голый `--force-with-lease`?
   - Ответ: голый lease сравнивает с remote-tracking ref, которого в новом worktree может не быть или он устарел; явный SHA отказывает ровно тогда, когда ветку сдвинули после этого head.
   - Строки: `harness/skills/pr-fix/SKILL.md:271`, `test/contract/harness-evals.test.ts:2220-2225`

## 8. Что нашёл review и что осталось

> VERIFIED
> Rebase: range-diff e628ccbf4..6f0f63a98 vs 79e71bedd..61b4b2e9b — commits 1-2 identical (=), only 833915dad and 61b4b2e9b are new; main moved by one docs-only commit (.scratch/worfy-auth-check, CONTEXT.md, HANDOFF.md, docs/product/critic). Round-2 SKILL.md diff is only :91-93 (undo note) and :189-190 (`--cleanup=strip`).
> Act on 1 (Push branch decision + paid numbers): fixed — .scratch/worfy-pr-follow/issues/03-skill-pr-fix-conflicts.md:70-85 («Итог»: numbers 3.58 USD on 6f0f63a98; «Решено без владельца (подтвердить)»: lease by contract test, "nothing without Push" by eval).
> Act on 2 (push-safety sentences pinned): fixed — test/contract/harness-evals.test.ts:2595-2598 pin SKILL.md:266-267, :274-275, :279-280 (+ the undo note :91-92).
> Act on 3 (quoted paths): fixed — test/contract/harness-evals.test.ts:2092-2124, :2182-2183, :2217-2236, :2259-2268 quote every path; pushinsteadof prefixes now take the last word (:2111).
> Consider 4 (`# Conflicts:` in the merge commit): fixed — SKILL.md:189; test :2254-2260 now checks the whole body (%B) equals the message and that SKILL.md has the exact command.
> Consider 5 (undo command after "Not now" on a moved base): fixed — SKILL.md:91-93; listed among the skill's commands at test :2359.
> Consider 6 (coverage evidence): fixed — ticket :49 cites harness-evals-run.test.ts:635. Consider 7 (state.cjs:84 marker check): not addressed, low, not blocking.
> Noted [low]: SKILL.md:91 says "the rebase or the merge commit"; the merge commit of an earlier run comes after headRefOid, so SKILL.md:88 already takes that worktree ("work there") and only the rebase case reaches this note. Harmless.
> Noted [low]: the paid eval numbers are from 6f0f63a98; the round-2 SKILL.md edits (note + `--cleanup=strip`) were not re-run with a paid eval, as the brief accepts.
> git check (scratch repo, git 2.50.1): after a merge conflict MERGE_MSG holds "# Conflicts:\n#\tf"; `commit --no-edit --cleanup=strip` gives a body that is only the -m message; plain `--no-edit` keeps the "# Conflicts:" lines. Correct.
> Mutants (own copy /tmp/v2011r2-wt at 61b4b2e9b, `vitest run harness-evals.test.ts -t pr-fix`): baseline exit 0 (30 passed); "On any answer" exit 1; "retried with --force" exit 1; "with no person to answer, push" exit 1; `--cleanup=strip` dropped exit 1; undo note dropped exit 1 (2 failed). 5/5 killed, SKILL.md restored, copy removed.
> Checks: spaced TMPDIR '/tmp/v2011r2 sp' -t pr-fix exit 0 (30 passed), both with and without GIT_CONFIG_PARAMETERS; prf-03 at 61b4b2e9b: `env -u GIT_CONFIG_PARAMETERS TMPDIR=/tmp/v2011r2 pnpm exec vitest run test/contract/harness-evals.test.ts` exit 0 (234 passed); `bash harness/bin/tests/plugin-neutral.test.sh` exit 0 (37 passed).
> Not verified: CI on the new head, the paid eval on 61b4b2e9b, the Code story (outside this lens).

Code: `.scratch/worfy-pr-follow/issues/03-skill-pr-fix-conflicts.md:70-85` · key lines: 70

```md
## Итог

- Режим `conflicts` skill-а `pr-fix`: `git merge-tree` называет файлы конфликта до правки, без конфликта skill ничего не
  меняет. Full mode — rebase в worktree и push только `--force-with-lease=<branch>:<head до rebase>`; Silent mode —
  merge commit (`--cleanup=strip`), без rebase и force-push. Кейсы `pr-fix-conflicts` (Full mode) и
  `pr-fix-conflicts-silent`, PR #2011.
- Платный eval на 6f0f63a98, 2 run-а на кейс, потолок 3 USD на кейс: `pr-fix-checks` 1.00 (0.80 USD),
  `pr-fix-comments` 1.00 (1.20 USD), `pr-fix-conflicts` 0.96 (0.75 USD; судья ответа разделился 2:1 в обоих run-ах),
  `pr-fix-conflicts-silent` 1.00 (0.83 USD); всего 3.58 USD.
- Решено без владельца (подтвердить): ветку «Push» ни один eval не достаёт. В прогоне нет человека для
  AskUserQuestion, а «Push», написанный в prompt заранее, skill по правилу ответом не считает. Поэтому пункт 1 «Готово,
  когда» проверяется двумя частями: что без ответа «Push» ничего не уходит — eval-ом (`no-publish-command`,
  `nothing-published`); что push после rebase идёт только с lease и lease отказывает, когда ветку сдвинули, — contract
  test-ом, который запускает строку push из SKILL.md в настоящем git (`test/contract/harness-evals.test.ts`,
  «conflicts in Full mode, a run as SKILL.md says»).
- Один кейс на оба режима не вышел: у кейса один prompt и один scaffold, а режим — поле Profile-а. Поэтому кейсов два.
```

Code: `test/contract/harness-evals.test.ts:2595-2598` · key lines: 2595

```ts
    expect(skill).toContain('Only on "Push", the first command; in mode `conflicts` in Full mode, the second one instead, never a bare `--force`:')
    expect(skill).toContain('A rejected push is never forced. Without the lease it means the branch moved on GitHub; with the lease it means the branch is no longer at `<headRefOid>`')
    expect(skill).toContain('On "Not now", on no answer, and in a session with no person to answer, nothing is pushed: say that the commits wait in `<worktree>`')
    expect(skill).toContain('In mode `conflicts` that may be the rebase or the merge commit of an earlier run on an older base: then also say that `git -C "<it>" reset --hard "<headRefOid>"` puts that worktree back')
```

Code: `test/contract/harness-evals.test.ts:2092-2124` · key lines: 2092

```ts
      expect(git(work, home, `git -C "${worktree}" rev-parse HEAD`).stdout.trim()).toBe(head)
      const tests = (): number | null => spawnSync(scriptNode(), ['--test'], { cwd: worktree, env: harnessEnv(home), encoding: 'utf8', timeout: SCAFFOLD_TIMEOUT_MS }).status
      expect(tests(), name).toBe(name === CHECKS ? 1 : 0)
      const file = join(worktree, 'src', 'sum.mjs')
      writeFileSync(file, readFileSync(file, 'utf8').replace('let total = list[0]', 'let total = 0').replace('let i = 1', 'let i = 0'))
      expect(tests()).toBe(0)
      // Not committed yet: the grader wants the fix committed.
      expect(state(work, home)).toMatch(/ ahead=no clean=no tests=0 empty=0 checkout=untouched\n$/)
      expect(state(work, home)).not.toMatch(pattern(name, 'fixed-in-worktree.md'))
      for (const start of ['git -C "<worktree>" add', 'git -C "<worktree>" commit']) {
        const run = git(work, home, fill(line(start), { ...v, files: 'src/sum.mjs', message: 'Sum an empty list to 0' }))
        expect(run.status, run.stderr).toBe(0)
      }
      expect(state(work, home)).toMatch(pattern(name, 'fixed-in-worktree.md'))
      expect(published(name, work)).toBe(false)

      // Every push to a GitHub address reaches the bare repository and rewrites the marker; a fetch still meets https=never.
      // The addresses are the prefixes the fixture rewrites (https, http, ssh, the scp form), read from its config: the
      // last word of each entry, since the key holds the path of the fixture, which may have a space.
      const prefixes = git(work, home, 'git config --get-regexp ^url\\..*\\.pushinsteadof$').stdout.trim().split('\n').map((entry) => entry.slice(entry.lastIndexOf(' ') + 1))
      expect(prefixes.map((prefix) => prefix.replace(/[a-z]+\.[a-z]+[/:]$/, 'HOST'))).toEqual(['https://HOST', 'http://HOST', 'ssh://git@HOST', 'git@HOST'])
      const marker = read(work, MARKER)
      for (const push of [
        fill(line('git -C "<worktree>" push origin'), v),
        `git --no-pager -C "${worktree}" push origin HEAD:refs/heads/other`,
        ...prefixes.map((prefix, i) => `git -C "${worktree}" push ${prefix}octo-org/ledger${i % 2 === 0 ? '.git' : ''} HEAD:refs/heads/by-${i}`),
      ]) {
        writeFileSync(join(work, MARKER), marker)
        const run = git(work, home, push)
        expect(run.status, `${push}\n${run.stderr}`).toBe(0)
        expect(published(name, work), push).toBe(true)
      }
      expect(git(work, home, `git --git-dir "${join(work, BARE)}" rev-parse refs/heads/by-3`).stdout.trim()).toBe(git(work, home, `git -C "${worktree}" rev-parse HEAD`).stdout.trim())
```
