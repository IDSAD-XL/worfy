# Code story — worfy-pr-review 04: Поиск PR в main: сборка запроса, три области, `prSearch.run` и `prSearch.pull`, сохранённые поиски, Amendment-ы ADR-0105 и ADR-0005

Kind: pr · Epic: worfy-pr-review · Ticket: 04 · PR: - · Language: ru

## 1. Что было не так

PR inbox искал двумя фиксированными запросами по `repo:` репозиториев Project-а; строки поиска не было, а чтение
одного PR (`PrInbox.refresh`) работало только для репозиториев, которые читает какой-то Project. Владелец (Q1 spec-а)
выбрал три области: This Project, организации владельцев репозиториев Project-а и All of GitHub. Этот PR делает
сторону main: сборку строки поиска, поиск и чтение одного PR из результатов, сохранённые поиски и каналы. Поле поиска
и список в виде — Ticket 05.

- Требование: [Что происходит](../issues/04-поиск-pr-в-main.md#что-происходит)

## 2. Строка поиска и деление области на несколько запросов

Code: `src/shared/pr-search/query.ts:96-114` · key lines: 99, 106, 107, 108

```ts
export function buildSearch(input: SearchInput): BuiltSearch {
  const { words, dropped, ownScope } = baseOf(input.text)
  const base = words.join(' ')
  const scope = ownScope ? [] : scopeOf(input.scope, input.repos)
  if (scope.length === 0) return { queries: [base], dropped, ownScope }
  const queries: string[] = []
  let current = base
  let filled = false
  for (const qualifier of scope) {
    const longer = `${current} ${qualifier}`
    if (filled && longer.length >= PR_SEARCH_MAX_CHARS) {
      queries.push(current)
      current = `${base} ${qualifier}`
    } else current = longer
    filled = true
  }
  queries.push(current)
  return { queries, dropped, ownScope }
}
```

- Что делает: к тексту пользователя (уже без `is:issue`, с `is:pr`, `archived:false` и `sort:updated-desc` по
  умолчанию — `baseOf`) добавляет `repo:` или `org:` области и раскладывает их по запросам так, чтобы каждый был
  короче 256 символов; ни один репозиторий не теряется. `repo:`, `org:` или `user:` в тексте заменяют область;
  отрицание (`-repo:`) только сужает поиск и область не снимает (раунд ревью 1).
- Почему здесь: Ticket называет чистую функцию `src/shared/pr-search/query.ts`; в `src/shared` её же вызовет вид
  Ticket-а 05 до Enter (`searchWarnings`). Почему `repo:` пользователя заменяет область: в обычном поиске GitHub два
  `repo:` — это ИЛИ, и область Project-а расширила бы поиск пользователя (решено без владельца, в «Итог» Ticket-а).
- Без него: Project с большим числом репозиториев получил бы от REST-поиска 422, а `is:issue` пользователя вернул бы
  issues вперемешку с PR (замер: `is:pr … is:issue` по cli/cli дал 6742 результата).
- Требование: [Что делаем, пункт 1](../issues/04-поиск-pr-в-main.md#что-делаем)
- Риски и пробелы test-ов: GraphQL-поиск на замере принял и 331 символ, и 6 операторов OR; предел 256 — правило
  REST, оставлен по Ticket-у. Документация GitHub не считает квалификаторы в эти 256: деление консервативнее, чем
  нужно.

## 3. Строка из inbox берётся из inbox, остальное читается один раз

Code: `src/main/github/pr-search.ts:388-406` · key lines: 390, 391, 394, 400, 404

```ts
  private async rowsOf(project: PrSearchProject, found: readonly Found[], viewer: string | null, env: GhEnv, account: string | null, notices: PrSearchNotice[]): Promise<PrSearchRow[]> {
    const wanted = found.filter((each) => {
      if (this.options.inboxRow(project.id, each.repo, each.number) !== null) return false
      return this.pulls.get(pullKeyOf(account, each.repo, each.number))?.row.updatedAt !== each.updatedAt
    })
    for (let at = 0; at < wanted.length; at += INBOX_DETAILS_PAGE) {
      if (!(await this.read(wanted.slice(at, at + INBOX_DETAILS_PAGE), project.root, env, account, viewer, notices))) break
    }
    const rows: PrSearchRow[] = []
    for (const each of found) {
      const inbox = this.options.inboxRow(project.id, each.repo, each.number)
      if (inbox !== null) {
        rows.push({ ...inbox, inInbox: true })
        continue
      }
      const kept = this.pulls.get(pullKeyOf(account, each.repo, each.number))
      if (kept !== undefined) rows.push({ ...kept.row, inInbox: false })
    }
    return rows
```

- Что делает: поиск отдаёт только номер, `updatedAt` и репозиторий каждого PR. PR из inbox берёт строку inbox; PR,
  который уже в памяти с тем же `updatedAt`, — строку из памяти; остальное читается запросом деталей inbox
  (`detailsArgs`, `PULL_FIELDS`, страницы по 10) и собирается `rowOf` из `inbox.ts` — тем же кодом, что строка inbox.
- Почему здесь: Ticket велит брать строку из inbox и `rowOf`/`PULL_FIELDS` экспортом, а не копией. Spec говорит
  «один вызов на страницу»; два шага выбраны, чтобы PR inbox не читался второй раз (решено без владельца, в «Итог»).
  Замер цены: страница из 30 PR со всеми полями одним запросом — 17 пунктов, лёгкий поиск и 3 страницы деталей —
  около 19.
- Без него: каждый поиск заново читал бы детали PR, которые inbox уже держит, и «Load more» тратил бы лимит на
  уже прочитанные PR.
- Требование: [Что делаем, пункты 2 и 3](../issues/04-поиск-pr-в-main.md#что-делаем)
- Риски и пробелы test-ов: результат из памяти поиска (60 s) не обновляется, если inbox за это время перечитал PR.
  Цена в пунктах измерена вручную на публичном репозитории; stand-in её не знает. Память PR — по аккаунту и
  `repo#N` (раунд ревью 1): Project другого аккаунта читает PR сам, своим токеном.

## 4. Пауза на rate limit общая с PR inbox

Code: `src/main/github/inbox.ts:565-581` · key lines: 567, 572, 578, 579

```ts
  accountPause(account: string | null): { until: number; reason: string } | null {
    const cache = this.accounts.get(account ?? '')
    return cache !== undefined && cache.pausedUntil > this.now() ? { until: cache.pausedUntil, reason: cache.pauseReason ?? '' } : null
  }

  /** A read of the account outside the inbox (the PR search) saw this `rateLimit`: below RATE_LIMIT_FLOOR the inbox waits too. */
  noteAccountRate(account: string | null, rate: unknown): void {
    this.noteRate(this.cacheOf(account ?? ''), rateSchema.parse(rate))
  }

  /** GitHub refused a read of the account outside the inbox for its rate limit: the inbox waits until `until` too. */
  pauseAccount(account: string | null, until: number, reason: string): void {
    const cache = this.cacheOf(account ?? '')
    if (until <= cache.pausedUntil) return
    cache.pausedUntil = until
    cache.pauseReason = reason
  }
```

- Что делает: поиск спрашивает паузу аккаунта у `PrInbox` до вызова, отдаёт ему `rateLimit` каждого ответа (порог
  10 %, `RATE_LIMIT_FLOOR`) и ставит паузу на отказ по rate limit (`Retry-After`, иначе 60 s). Пауза живёт в кэше
  аккаунта inbox, поэтому её видят оба.
- Почему здесь: Ticket требует паузу «общую с PR inbox (порог 10 %)» и называет `src/main/github/inbox.ts` среди
  своих файлов; кэш аккаунта и `noteRate` уже были в `PrInbox`. Три метода — минимальная правка без переноса паузы в
  другой модуль.
- Без него: поиск пользователя мог бы съесть остаток лимита, а фоновый inbox продолжал бы ходить в GitHub, и наоборот.
- Требование: [Что делаем, пункт 2](../issues/04-поиск-pr-в-main.md#что-делаем)
- Риски и пробелы test-ов: у GraphQL-поиска нет своего документированного лимита в минуту; ответ GitHub показал
  `X-Ratelimit-Resource: graphql`. Отдельного счётчика 30 поисков в минуту нет — только память 60 s и поиск по Enter.

## 5. Сохранение поиска — запись, поиск — чтение

Code: `src/shared/ipc/pr-search.ts:128-135` · key lines: 129, 133, 134

```ts
/** Saves the search under `name`; a search of the same name is replaced. At most 20 besides the built-in ones. */
export const prSearchSave = invokeChannel(
  'prSearch.save',
  projectInput.extend({ name: z.string().trim().min(1).max(PR_SEARCH_NAME_MAX), query: z.string().max(4096), scope: prSearchScopeSchema }),
  savedSearchesSchema,
  'project',
  'write',
)
```

- Что делает: `prSearch.save` и `prSearch.forget` помечены `'project', 'write'`, а `prSearch.run`, `prSearch.pull`
  и `prSearch.saved` — `'project', 'read'`. Link adapter отказывает Linked machine с доступом Read only в `write` до
  handler-а; поиск и чтение ей открыты, вызов идёт на Machine Project-а её аккаунтом.
- Почему здесь: пункт 5 Ticket-а задаёт эти пометки; ADR-0066 определяет `read` как вызов, который не меняет ни
  файла, ни состояния Project-а. Поиск в GitHub ничего не пишет, а `pr-searches.json` — файл папки данных Project-а.
- Без него: Linked machine с Read only могла бы переписать сохранённые поиски Project-а.
- Требование: [Что делаем, пункты 5 и 6](../issues/04-поиск-pr-в-main.md#что-делаем)
- Риски и пробелы test-ов: spec в разделе 1 называет `prSearch.saved` каналом `write`, Ticket — `read`; сделано по
  Ticket-у (раздел 11 spec-а тоже говорит «с Read only читаются»). Вынесено в «Итог» на подтверждение.

## 6. Что сознательно не меняли

- Фоновые чтения PR inbox остаются в репозиториях Project-а: `searchTerms` не тронут.
- Поле поиска, chip-ы в виде и «Searched 3 min ago» — Ticket 05; здесь только данные и каналы.

## 7. Как проверено

- `test/unit/pr-search-query.test.ts` — красный до `query.ts` (модуля не было), затем 20 из 20.
- `test/contract/pr-search.test.ts` — 27 из 27 на gh stand-in, который валит test на `--method` и `mutation`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` и gate fast под временным HOME — коды выхода в «Итог» Ticket-а.

## Проверить себя

1. Почему `repo:other-org/lib` в тексте пользователя отключает область This Project, а не добавляется к ней?
   - Строки: `src/shared/pr-search/query.ts:99`
   - Ответ: в обычном поиске GitHub два `repo:` значат ИЛИ; область Project-а расширила бы поиск, а не сузила.
2. Сколько раз поиск прочитает детали PR, который есть в inbox?
   - Строки: `src/main/github/pr-search.ts:390`, `src/main/github/pr-search.ts:400`
   - Ответ: ни разу — строка берётся из inbox; читаются только PR вне inbox и вне памяти.
3. Что станет с фоновым чтением inbox, если ответ поиска показал меньше 10 % лимита?
   - Строки: `src/main/github/inbox.ts:572`
   - Ответ: `noteAccountRate` ставит паузу в кэше аккаунта inbox, и inbox этого аккаунта ждёт `resetAt`, как и поиск.

## 8. Что нашёл review и что осталось

> VERIFIED — worfy-pr-review 04 (PR search in main), head 96a6c1a1ea57517cb41a332b65223a8570755dab (rebased from 1990930e8 onto main 25ac775eb; only conflict ADR-0005 Amendments order; 6 test files 140/140, lint, typecheck, story-check EXIT=0)
>
> Gate (depth medium, two rounds): verifier (lens: implementer's report) VERIFIED on round 1 with two test gaps; reviewer (lens: correctness) round 1 two med + two low reproduced by probes; all fixed test-first; round 2 reviewer: all closed, no new finding above low.
>
> - Verifier (636b8ab1f): query builder query.ts:64-122 and chips :126-218 (20 unit tests); 27 contract tests with expectNoWrite, the stand-in refuses --method and mutation; Linked machine: prSearch.save / forget are write and refused read-only, no pr-searches.json; 21st saved search refused, built-ins not forgettable; ADR-0105 and ADR-0005 Amendments; inbox.ts changes are exports only. Many mutants red (is:pr, archived, sort, split, warning, limits, pause, memory, pullsMax, SSO notice, -X POST).
> - Round 1 fixes (code c5292719c): a negated -repo:/-org:/-user: only narrows, the Project or owners scope stays (query.ts:77); the PR memory is keyed by account + repo#N (pr-search.ts:251) — another account reads again with its own token; the Load more cursor carries a hash of the search strings and a cursor of another search is refused without a call (:173-190); a 403 with X-GitHub-SSO is checked before the rate limit (:131-137); tests pin exactly 256 chars and the newest-first merge of split searches. Round-2 reviewer: own probes and six mutants (each red) confirm; the cursor is stable across the 60 s memory and Load more after it.
> - Tests: pr-search-query, pr-search, link-access, pr-inbox 115 tests EXIT=0; lint, typecheck, story-check, evidence-check EXIT=0. Local gate fast not run: file-watcher tests red on this Mac (fseventsd). ci-ok pass on the head.
>
> Decided without the owner (to confirm): two calls per page (a light search, then the inbox's details query only for PRs outside the inbox and memory); the owners scope writes org: for every owner (matches user accounts too, checked live); an un-negated repo:/org:/user: in the user's text replaces the scope; prSearch.saved is read (spec §1 says write); 20 saved searches besides the two built-in, same name replaces; the partial-results notice gives the number of hidden organizations.
>
> Consider [low]: pull() resolves the account before the memory check — a process start per answer from memory (pr-search.ts:363; no caller until ticket 05); «NOT repo:x» still counts as own scope (query.ts:77) — whether GitHub treats NOT before a qualifier as exclusion is unverified; keyOf misses a qualifier glued to a bracket «(-repo:a OR …)» (query.ts:58, pre-existing); appGh/repoFolders duplicated from ipc/pr-inbox.ts.
