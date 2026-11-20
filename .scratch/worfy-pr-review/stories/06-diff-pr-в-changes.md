# Code story — worfy-pr-review 06: Diff PR в Changes: предмет `pr`, локальный diff или diff из GitHub, нити ревью на строках, Amendment ADR-0110

Kind: pr · Epic: worfy-pr-review · Ticket: 06 · PR: - · Language: ru

## 1. Что было не так

Экран Changes знал только Ticket: каналы `changes.*` принимали поле `ticket`, diff считал git этой машины. Чтобы
ревьюить чужой PR (Review mode, Ticket 09), нужен diff PR-а: из своего checkout-а, если оба commit-а там есть, а иначе —
из GitHub. Fetch worfy не делает никогда (ADR-0110), поэтому второй путь — чтение GitHub, и ADR нужна поправка.

- Требование: [Что происходит](../issues/06-diff-pr-в-changes.md#что-происходит)

## 2. Где читать PR: свой checkout или GitHub

Code: `src/main/ipc/changes.ts:89-102` · key lines: 94, 96, 98, 101

```ts
async function prSource(deps: ChangesDeps, projectId: string, pr: ChangesPrRef): Promise<PrSource> {
  const { layout, checkouts } = await checkoutsOf(deps, projectId)
  const remotes = deps.remotes ?? (async (folder: string) => (await import('../github/inbox')).remoteRepos([folder]))
  for (const { path } of checkouts) {
    const slugs = await remotes(path).catch((): string[] => [])
    if (!slugs.some((slug) => slug.toLowerCase() === pr.repo.toLowerCase())) continue
    const probe = gitProbe(path, deps.git)
    if (!(await probe.exists(pr.headOid)) || !(await probe.exists(pr.baseOid))) continue
    const subject: RepoSubject = { repo: pr.repo, checkout: path, cwd: path, kind: 'pr', branch: `#${pr.number}`, head: pr.headOid, headSha: pr.headOid }
    return { kind: 'git', context: { subject, git: deps.git, facts: {}, workflowPrefix: workflowPrefixOf(layout, path), base: pr.baseOid } }
  }
  if (deps.gh === undefined) throw new Error(`This build cannot read ${pr.repo}#${pr.number} from GitHub`)
  return { kind: 'github', reader: { who: projectId, get: deps.gh(projectId) } }
}
```

- Что делает: ищет checkout Project-а, у которого `origin` — репозиторий PR-а и в котором есть оба commit-а
  (`cat-file -e` через тот же reading runner). Нашёл — PR читается как ветка, не взятая ни в один worktree, с базой
  `baseOid`. Не нашёл — GitHub; `gh` при этом ещё не вызывается: `deps.gh` отдаёт функцию, а аккаунт спрашивается только
  при чтении пути.
- Почему здесь: Ticket, «Что делаем», п. 2 и 3, и spec, раздел «Решения по реализации», 4. Ticket называет
  `src/main/ipc/changes.ts` среди своих файлов. `remoteRepos` берётся из `src/main/github/inbox.ts` (там его только
  читают) и импортируется лениво, чтобы загрузка handler-ов не тянула модуль inbox.
- Без него: PR своего репозитория без локальных commit-ов пришлось бы либо fetch-ить (запрещено ADR-0110), либо не
  показывать. Contract test «a head that is not in the repository is read from GitHub, never fetched» проверяет второй
  путь, «All changes: the PR's commits against the merge-base» — первый.
- Требование: [Что делаем](../issues/06-diff-pr-в-changes.md#что-делаем)
- Риски и пробелы test-ов: `origin` с GitHub Enterprise `remoteRepos` не называет — такой PR всегда идёт в GitHub
  (shortcut самого `remoteRepos`). Аккаунт Project-а в app (`accountAuth`) test не проверяет: contract test даёт `gh`
  напрямую через stand-in.

## 3. Patch GitHub — те же hunk-и, что у git

Code: `src/main/changes/github.ts:81-85` · key lines: 84

```ts
/** The hunks of a patch GitHub sent: hunks without the headers of git, read by parse.ts under a header of their own. */
export function patchHunks(patch: string): DiffHunk[] {
  const text = patch.endsWith('\n') ? patch : `${patch}\n`
  return parsePatch(`diff --git a/file b/file\n${text}`)[0]?.hunks ?? []
}
```

- Что делает: ставит перед `patch` из GitHub заголовок `diff --git` и отдаёт его `parsePatch` из
  `src/shared/changes/parse.ts`: строки, номера обеих сторон, «No newline at end of file» — как у локального diff-а.
- Почему здесь: Ticket, «Что делаем», п. 3: «разбор `patch` тем же `src/shared/changes/parse.ts` (hunk-и без
  заголовков git)»; spec называет адаптер в `src/main/changes/github.ts`. `parsePatch` начинает файл только со строки
  `diff --git`, поэтому без заголовка он не видит ни одного hunk-а.
- Без него: `patchHunks` вернул бы пустой список, и файл из GitHub показал бы «No lines changed». Unit test
  `test/unit/changes-github-patch.test.ts` («reads as hunks with the numbers of both sides») это ловит.
- Требование: [Что делаем](../issues/06-diff-pr-в-changes.md#что-делаем)
- Риски и пробелы test-ов: формы `patch`, кроме проверенных в unit test-е (hunk-и, удалённая строка вида заголовка,
  «No newline»), против настоящего GitHub не сверялись — fixture-ы по документации.

## 4. Файл без patch, binary и переименование

Code: `src/main/changes/github.ts:92-117` · key lines: 94, 96, 109, 112, 113

```ts
export function prFileOf(input: GithubFile): PrFile {
  const raw = githubFileSchema.parse(input)
  const status = STATUSES[raw.status] ?? 'M'
  const patch = raw.patch === undefined || raw.patch === '' ? null : raw.patch
  const binary = patch === null && raw.additions === 0 && raw.deletions === 0 && raw.status === 'modified'
  const additions = binary ? null : raw.additions
  const deletions = binary ? null : raw.deletions
  const file: ChangedFile = {
    path: raw.filename,
    oldPath: status === 'R' ? (raw.previous_filename ?? null) : null,
    status,
    additions,
    deletions,
    binary,
    oldMode: null,
    newMode: null,
    oldBlob: null,
    newBlob: status === 'D' ? null : (raw.sha ?? null),
    untracked: false,
    // Where the workflow lies in another repository is not known: no file of a PR is grouped as Workflow files.
    workflow: false,
    fold: patch === null ? null : foldOf({ path: raw.filename, additions, deletions, binary }),
    ...(raw.blob_url ? { url: raw.blob_url } : {}),
  }
  return { file, patch }
}
```

- Что делает: переводит файл `pulls/{n}/files` в `ChangedFile` экрана. Нет `patch` и нет строк у файла со статусом
  `modified` — файл считается binary, без счётчиков. Добавленный или удалённый пустой файл, смена mode и голое
  переименование — «No lines changed» (раунд ревью 1). Файл без `patch` не сворачивается: показывать у него нечего,
  кроме «Large diff · Open on GitHub». `sha` — blob id новой стороны (по нему Ticket 09 снимает Viewed), `blob_url` —
  ссылка «View file on GitHub».
- Почему здесь: Ticket, «Что делаем», п. 3 и 4. Что именно GitHub шлёт у binary и большого файла, документация не
  говорит (spec, «Факты GitHub API» → «Diff и файлы», «не проверено») — правило «нет patch и нет строк — binary» решено
  без владельца.
- Без него: файл без `patch` с `fold: 'large'` показал бы «Large diff · N lines · Show», и «Show» не дал бы ничего.
- Требование: [Что делаем](../issues/06-diff-pr-в-changes.md#что-делаем)
- Риски и пробелы test-ов: добавленный binary-файл (0 строк, без `patch`) GitHub не отличает от пустого — он прочтётся
  «No lines changed»; в заголовке остаётся «View file on GitHub». Если GitHub всё-таки шлёт `patch` у binary, файл
  покажет его как текст — не проверено на настоящем GitHub.

## 5. Страницы и предел 3 000 файлов

Code: `src/main/changes/github.ts:154-163` · key lines: 156, 160, 162

```ts
async function pages(get: GhGet, path: string, max: number, items: (answer: unknown) => unknown[]): Promise<{ items: unknown[]; full: boolean }> {
  const all: unknown[] = []
  for (let page = 1; all.length < max; page++) {
    const url = `${path}?per_page=${GITHUB_PAGE}&page=${page}`
    const got = items(json(await get(url), url))
    all.push(...got)
    if (got.length < GITHUB_PAGE) return { items: all.slice(0, max), full: false }
  }
  return { items: all.slice(0, max), full: true }
}
```

- Что делает: читает страницы по 100, пока страница не окажется короче или не наберётся `max` (3 000 файлов PR-а,
  250 commit-ов). `full: true` — список упёрся в предел, и ответ `changes.list` несёт `truncatedAt: 3000`, а дерево
  пишет «GitHub lists the first 3,000 files».
- Почему здесь: Ticket, «Что делаем», п. 3; пределы GitHub — spec, «Факты GitHub API» → «Diff и файлы».
- Без него: PR больше 100 файлов показал бы первую сотню без предупреждения. Contract test «a PR of more than 3,000
  files» ждёт ровно 30 вызовов и последнюю страницу 30.
- Требование: [Готово, когда](../issues/06-diff-pr-в-changes.md#готово-когда)
- Риски и пробелы test-ов: PR ровно из 3 000 файлов тоже получит строку о пределе — 31-ю страницу GitHub не отдаёт,
  отличить нечем.

## 6. Память по Project-у, head и base

Code: `src/main/changes/github.ts:222-235` · key lines: 223, 224, 232, 233

```ts
  private keep<T>(reader: GhReader, pr: ChangesPrRef, what: string, read: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([reader.who, pr.repo.toLowerCase(), pr.number, pr.headOid, pr.baseOid, what])
    const found = this.kept.get(key)
    if (found !== undefined) {
      // The newest use last: the oldest goes first.
      this.kept.delete(key)
      this.kept.set(key, found)
      return found as Promise<T>
    }
    const reading = read()
    this.kept.set(key, reading)
    reading.catch(() => {
      if (this.kept.get(key) === reading) this.kept.delete(key)
    })
```

- Что делает: держит в памяти main ответ GitHub по Project-у, PR-у, его head, base и scope-у; повторное чтение того
  же не вызывает `gh`. Другой Project читает заново — его аккаунт может не видеть репозиторий; PR, перенесённый на
  другую базу без push, тоже. Неудачное чтение не держится. Держится не больше 16 чтений, старое уходит первым.
- Почему здесь: Ticket, «Что делаем», п. 3: «Кэш в памяти main по head commit-у». Число 16 — решено без владельца.
- Без него: каждый `changes.file` (один на файл в окне diff-а) заново читал бы все страницы `pulls/{n}/files`.
  Contract test «the second read asks gh nothing» считает вызовы stand-in-а; «a new base … is read again» и «another
  Project is read again» — ключ.
- Требование: [Что делаем](../issues/06-diff-pr-в-changes.md#что-делаем)
- Риски и пробелы test-ов: вытеснение старых чтений (больше 16) test не проверяет.

## 7. Нити ревью на своих строках: сторона, строка, scope

Code: `src/renderer/changes/DiffPane.tsx:171-191` · key lines: 175, 176, 182, 186, 187, 188

```tsx
function placeThreads(threads: readonly ChangesThread[], hunks: readonly DiffHunk[] | null, sides: ReadonlySet<LineSide>): FileThreads {
  const shown = new Set<string>()
  for (const hunk of hunks ?? []) {
    for (const line of hunk.lines) {
      if (line.kind !== 'add' && line.oldLine !== null) shown.add(lineKey('old', line.oldLine))
      if (line.kind !== 'del' && line.newLine !== null) shown.add(lineKey('new', line.newLine))
    }
  }
  const onLine = new Map<string, ChangesThread[]>()
  const listed: ChangesThread[] = []
  for (const thread of threads) {
    if (thread.isOutdated || thread.line === null || !sides.has(threadSide(thread))) {
      listed.push(thread)
      continue
    }
    const key = lineKey(threadSide(thread), thread.line)
    if (shown.has(key)) onLine.set(key, [...(onLine.get(key) ?? []), thread])
    else if (hunks !== null) listed.push(thread)
  }
  return { onLine, listed }
}
```

- Что делает: раскладывает нити одного файла PR-а (как их читает PR inbox: `path`, `line`, `side`, `isOutdated`). Нить
  встаёт под свою строку, если scope нумерует эту сторону, как GitHub, и hunk-и эту строку показывают. Нить LEFT — под
  строкой старого файла, остальные — новой. Остальные нити — списком под заголовком файла, с подписью, где нить была.
  Пока файл читается, нить, которая ещё может найти строку, не показывается нигде. `sidesOf` решает по scope-у: All
  changes — обе стороны, Since my review — новая, Commit — ни одной. Reply — только при `onReply` и `viewerCanReply`:
  ответ идёт существующим черновиком PR inbox.
- Почему здесь: Ticket, «Что делаем», п. 5; Ticket называет `src/renderer/changes/DiffPane.tsx`. Сторону и scope
  добавил раунд ревью 1: нить на удалённой строке стояла под строкой нового файла, нить на строке вне hunk-ов терялась,
  а в Commit номера строк не те.
- Без него: нить не на своей строке или нигде. Unit test-ы в `test/unit/changes-view.test.tsx`: «a thread on a deleted
  line (LEFT)…», «a thread on a line the hunks do not have…», «a Commit has numbers of its own…».
- Требование: [Что делаем](../issues/06-diff-pr-в-changes.md#что-делаем)
- Риски и пробелы test-ов: многострочная нить ставится под свою последнюю строку (`line`); начало диапазона
  (`startLine`) не читается.

## 8. Что сознательно не меняли

Ни один экран ещё не открывает diff PR-а: Review mode во вкладке Pull requests — Ticket 09, он передаст `DiffPane` и
`FileTree` предмет `pr`, нити и `onReply`. Changes Node на Canvas по-прежнему показывает Ticket. `ScopeBar.tsx` не
менялся: подписи scope-ов PR-а (Since my review) — забота Review mode. Перевод страницы Feature — Ticket 12.
Из файлов Ticket-а 02 раунд ревью 1 тронул только сторону нити: `diffSide` в запросе `src/main/github/inbox.ts`
и поле `side` в `src/shared/ipc/pr-inbox.ts`.

## 9. Как проверено

Сначала test-ы, потом код: `test/unit/changes-github-patch.test.ts` и `test/contract/changes-pr.test.ts` были красными
(модуля `src/main/changes/github.ts` не было). Затем `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 (под временным
HOME), gate fast — `[gate] green (fast)`, exit 0; `pnpm test:e2e test/e2e/changes.spec.ts test/e2e/changes-comments.spec.ts`
под замком e2e — exit 0. Снимки экрана diff-а PR-а в светлой и тёмной теме сняты на fixture-данных.

## Проверить себя

1. Почему PR своего репозитория может читаться из GitHub, хотя checkout на месте?
   - Ответ: если хотя бы одного из двух commit-ов нет локально, worfy не делает fetch (ADR-0110) и читает GitHub.
   - Lines: `src/main/ipc/changes.ts:96`
2. Почему второй `changes.file` того же PR-а не вызывает `gh`?
   - Ответ: ответ `pulls/{n}/files` с patch-ами всех файлов держится в памяти по Project-у, PR-у, head, base и scope-у.
   - Lines: `src/main/changes/github.ts:223`
3. Чем у файла без patch отличается binary от слишком большого?
   - Ответ: у binary GitHub не считает строк (0 и 0), и статус — `modified`; у большого строки есть. Оба показывают
     «Large diff · Open on GitHub».
   - Lines: `src/main/changes/github.ts:96`

## 10. Что нашёл review и что осталось

> VERIFIED — worfy-pr-review 06 (the diff of a pull request in Changes), head 69d94d793cd0a47dbc2f5c5f98fa3b6997f1c347
>
> Gate (depth medium, two rounds): verifier (lens: implementer's report) VERIFIED on round 1; reviewer (lens: correctness) round 1 one med + four low, all fixed test-first; round 2 reviewer: all closed, no new findings.
>
> - Verifier (21581609): channels take subject ticket|pr (src/shared/ipc/changes.ts); local read only when origin matches and both commits exist, else gh api, never fetch, index unchanged (src/main/ipc/changes.ts:89-102; changes-pr.test.ts:183); patchHunks and no-patch/binary/rename shapes; 30 pages of 100 with truncatedAt 3000; head cache; threads, outdated list, Reply, View file on GitHub in DiffPane; FileTree note; ADR-0110 Amendment and changes.md section match. 11 of 12 mutants red.
> - Round 1 fixes: inbox.ts requests diffSide → thread side; All changes places both sides, Since my review only the new side, Commit none — every thread without a visible line goes to the list under the file header (never lost; side by side shows each once — reviewer's probe exit 0); cache key has Project, repo, number, head, base, scope; changesPrSchema refuses . and .. segments; binary only for status modified, empty file / mode change shows «No lines changed»; ghApiGet builds the args for the app and the test (['api', path]). Old inbox snapshots without side still parse.
> - Tests: Changes + PR inbox 21 files, 463 tests EXIT=0; lint, typecheck, check-feature-docs, story-check, evidence-check EXIT=0. Local gate fast not run: file-watcher tests red on this Mac (fseventsd). ci-ok pass on the head.
>
> Decided without the owner (to confirm): Since my review = compare scope with a commit, three dots; base.mergeBase '' for a PR read from GitHub; 16 reads in memory; Open on GitHub → blob_url; resolved threads shown; an added binary file reads «No lines changed» (GitHub does not tell it from an empty file); old-side threads in Since my review go to the list; no head check that pulls/{n}/files returned headOid. Compat: changes.* take subject; a Linked machine on an older build is refused.
>
> Consider [low]: pulls/{n}/files always returns the current head — after a push the inbox's older headOid keys newer data (noted in «Итог»).

Code: `src/main/ipc/changes.ts:89-102` · key lines: 89

```ts
async function prSource(deps: ChangesDeps, projectId: string, pr: ChangesPrRef): Promise<PrSource> {
  const { layout, checkouts } = await checkoutsOf(deps, projectId)
  const remotes = deps.remotes ?? (async (folder: string) => (await import('../github/inbox')).remoteRepos([folder]))
  for (const { path } of checkouts) {
    const slugs = await remotes(path).catch((): string[] => [])
    if (!slugs.some((slug) => slug.toLowerCase() === pr.repo.toLowerCase())) continue
    const probe = gitProbe(path, deps.git)
    if (!(await probe.exists(pr.headOid)) || !(await probe.exists(pr.baseOid))) continue
    const subject: RepoSubject = { repo: pr.repo, checkout: path, cwd: path, kind: 'pr', branch: `#${pr.number}`, head: pr.headOid, headSha: pr.headOid }
    return { kind: 'git', context: { subject, git: deps.git, facts: {}, workflowPrefix: workflowPrefixOf(layout, path), base: pr.baseOid } }
  }
  if (deps.gh === undefined) throw new Error(`This build cannot read ${pr.repo}#${pr.number} from GitHub`)
  return { kind: 'github', reader: { who: projectId, get: deps.gh(projectId) } }
}
```
