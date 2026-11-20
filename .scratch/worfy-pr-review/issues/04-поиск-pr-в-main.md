# 04 — Поиск PR в main: сборка запроса, три области, `prSearch.run` и `prSearch.pull`, сохранённые поиски, Amendment-ы ADR-0105 и ADR-0005

Type: task
Status: claimed 2026-11-20T04:30Z
PR: #2074
Blocked by: 02
Source: [spec.md](../spec.md), «Ticket-ы», 4; «Факты GitHub API» → «Поиск PR»; «Решения по реализации», 1, 2, 9 и 10;
«Решения по test-ам», Seam 1 и 2; «Вопросы владельцу», Q1; [critic](../../../docs/product/critic/worfy-pr-review-2026-11-20.md),
возражение 2

Кто: агент.

Не платформенный Ticket (`src/main/`, `src/shared/`, ADR). Глубина ревью — `medium`.

## Что происходит

- PR inbox ищет двумя фиксированными запросами `review-requested:@me` и `involves:@me` по `repo:` каждого репозитория
  Project-а (`searchTerms`, `src/main/github/inbox.ts:83-86`); другой репозиторий в вызове не называется
  (`src/main/github/inbox.ts:5-6`). Строки поиска нет.
- ADR-0105, пункт 1: PR inbox читает GitHub из main только по репозиториям Project-а. Решение владельца 2026-11-20, Q1
  (а): три области — This Project (по умолчанию), организации владельцев репозиториев Project-а, All of GitHub; чтение
  шире Project-а требует Amendment ADR-0105.
- Строку результата собирает `rowOf` (`src/main/github/inbox.ts:697`, не экспортирован) из `PULL_FIELDS`; после
  Ticket-а 02 в строке есть `approvals` — поэтому `Blocked by: 02` (возражение 2 critic-а, принято владельцем).
- `PrInbox.refresh` (`src/main/github/inbox.ts:376`) читает только репозитории, которые читает какой-то Project, и для PR
  из результатов не годится.

## Что делаем

1. Чистая функция `src/shared/pr-search/query.ts` (новый): текст пользователя + `is:pr` (`is:issue` отбрасывается с
   notice) + область + `archived:false` по умолчанию + `sort:updated-desc`, если сортировку не задал пользователь.
   This Project — `repo:` каждого репозитория (`remoteRepos`, `src/main/github/inbox.ts:731`), при 256 символах и
   больше — несколько запросов; организации — `org:` или `user:` каждого владельца; All of GitHub — без ограничения.
   Предупреждение до Enter: длиннее 256 символов или больше 5 операторов AND/OR/NOT.
2. `src/main/github/pr-search.ts` (новый): GraphQL `search(type: ISSUE, query: $q, first: 30, after: $cursor)` с
   `issueCount`, через `ghRunner` с `accountAuth` (`src/main/github/prs.ts:118`, `:172`); только `query`, без
   `--method`, без `mutation`. Строка результата — `rowOf` и поля `PULL_FIELDS` из `inbox.ts` (экспорт, не копия);
   строка, которая есть в inbox, берётся из inbox. Повтор того же запроса моложе 60 с — из памяти. Предел 1 000 —
   notice. Пауза на rate limit — общая с PR inbox (порог 10 %).
3. `prSearch.pull` — один PR из результатов вне inbox, тем же запросом деталей; кэш в памяти по `repo#N` и `updatedAt`,
   не больше 200 PR, на диск не пишется; Mark seen не пишется.
4. Ошибки раздела 10 spec-а в `notice`: 404 («not visible to <account>»), 403 с `X-GitHub-SSO` и `partial-results`,
   `incomplete_results`, 422 с текстом GitHub, 401, rate limit.
5. Каналы в `src/shared/ipc/pr-search.ts` (новый) и `src/main/ipc/pr-search.ts` (новый): `prSearch.run`,
   `prSearch.pull` — `'project', 'read'`; `prSearch.saved` — `'project', 'read'`; `prSearch.save`, `prSearch.forget` —
   `'project', 'write'`.
6. Сохранённые поиски — `<Project data folder>/pr-searches.json` рядом с `pr-inbox.json`: имя, строка, область, не
   больше 20; два встроенных, которые нельзя удалить: «Review requested from me · All of GitHub» и «Reviewed by me ·
   open».
7. Amendment к ADR-0105, пункт 1 (поиск по запросу пользователя и чтение одного открытого PR могут назвать любой
   репозиторий, видимый аккаунту Project-а; это чтение) и Amendment к ADR-0005 (`pr-searches.json`).

## Готово, когда

- [ ] Unit `test/unit/pr-search-query.test.ts` (новый): `is:pr` всегда, три области, `archived:false`, сортировка,
      деление по 256 символам, предупреждение про 5 операторов, chip-квалификаторы раздела 1 spec-а. Красный до правки —
      в «Итог».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/pr-search-query.test.ts` exit 0 · mac - · b63f39113812ecffbdcb0dbf30f1ea8f521393e3
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/pr-search-query.test.ts` exit 0 · mac - · c5292719c3746a1189dec7a2b0befbb9006589ba
- [ ] Contract `test/contract/pr-search.test.ts` (новый) на gh stand-in (`WORFY_GH`): строка запроса каждой области,
      cursor и «Load more», 1 000, rate limit, 403 SSO и `partial-results`, 422, 404; строка из inbox не читается
      дважды; stand-in валит test на любом `--method` и `mutation` — ни одной записи на GitHub.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-search.test.ts` exit 0 · mac - · b63f39113812ecffbdcb0dbf30f1ea8f521393e3
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-search.test.ts` exit 0 · mac - · c5292719c3746a1189dec7a2b0befbb9006589ba
- [ ] Тот же contract: `prSearch.save` с Linked machine Read only — отказ; `prSearch.run` — разрешён; больше 20
      сохранённых — отказ; встроенные не удаляются.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-search.test.ts` exit 0 · mac - · b63f39113812ecffbdcb0dbf30f1ea8f521393e3
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-search.test.ts` exit 0 · mac - · c5292719c3746a1189dec7a2b0befbb9006589ba
- [ ] Amendment-ы ADR-0105 (пункт 1) и ADR-0005 влиты в этом PR.
  - evidence: commit pass · worfy-pr-review/04: PR search in main — query builder, three scopes, prSearch.run/pull, saved searches · - - · b63f39113812ecffbdcb0dbf30f1ea8f521393e3
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/shared/pr-search/query.ts` (новый)
- `src/main/github/pr-search.ts` (новый)
- `src/shared/ipc/pr-search.ts` (новый), `src/main/ipc/pr-search.ts` (новый)
- `src/main/github/inbox.ts` (экспорт `rowOf`, `PULL_FIELDS` уже экспортирован)
- `docs/adr/0105-pr-reply-only-on-the-users-click.md`, `docs/adr/0005-worfy-own-state-inventory.md`
- `test/unit/pr-search-query.test.ts` (новый), `test/contract/pr-search.test.ts` (новый)

Только читать: `src/main/github/prs.ts`, `src/main/projects/pr-inbox-state.ts`, `src/shared/ipc/channels.ts` (уровни
доступа каналов), `docs/adr/0066-read-only-access-for-a-linked-machine.md`.

## Вне скоупа

- Поле поиска и список в виде — Ticket 05. Поиск issues, кода, GitLab, GitHub Enterprise Server — вне Epic-а.

## Итог

- Красный до правки: `test/unit/pr-search-query.test.ts` написан первым и упал на импорте — модуля
  `src/shared/pr-search/query.ts` ещё не было (`vitest run --project node test/unit/pr-search-query.test.ts` exit 1,
  «Test Files 1 failed»). После `query.ts` — 20 из 20 зелёные. Contract `test/contract/pr-search.test.ts` написан
  вместе с `src/main/github/pr-search.ts`: 27 test-ов на gh stand-in.
- Замеры на GitHub (только чтение, `gh api graphql`, публичный cli/cli, 2026-11-20): `search(type: ISSUE)` стоит 1
  пункт; страница из 30 PR со всеми полями строки inbox — 17 пунктов и 10 s, из 10 PR — 6 пунктов и 3 s. Заголовок
  ответа — `X-Ratelimit-Resource: graphql`: GraphQL-поиск тратит общий лимит GraphQL аккаунта, отдельного счётчика
  `search` в ответе нет. GraphQL-поиск принял строку в 331 символ и 6 операторов OR без ошибки (422 — правило REST);
  предупреждение и деление по 256 оставлены, как велит Ticket. `org:` и `user:` дают одно и то же и для организации
  (cli), и для пользователя (torvalds).
- Решено без владельца, подтвердить:
  1. Поиск в два шага: лёгкий `search` (номер, `updatedAt`, репозиторий), затем запрос деталей inbox (`detailsArgs`,
     страницы по 10) только для PR, которых нет в inbox и в памяти с тем же `updatedAt`. Spec говорит «один вызов на
     страницу», но тогда PR из inbox читался бы второй раз; цена двух шагов по замеру почти та же (1 + 3 × 6 = 19 против 17
     пунктов за 30 PR).
  2. Область «организации» пишет `org:` для каждого владельца, без запроса, организация это или пользователь: GitHub
     понимает `org:` и для пользователя (замер выше).
  3. `repo:`, `org:` или `user:` в тексте пользователя заменяют область: в обычном поиске GitHub два `repo:` — это
     ИЛИ, и область Project-а расширила бы поиск пользователя. Notice `own-scope` говорит об этом.
  4. Деление и предупреждение: каждый запрос короче 256 символов; предупреждение — когда хоть один запрос длиннее 256
     (его нельзя разделить: одна область или текст пользователя слишком длинный). Деление касается и области
     организаций.
  5. Notice `partial-results` называет число скрытых организаций, а не их имена: GitHub отдаёт в заголовке только id.
  6. 20 — предел сохранённых поисков пользователя, два встроенных сверх него. Сохранение под тем же именем (без учёта
     регистра) заменяет поиск. Встроенный «Reviewed by me · open» — в области This Project, «Review requested from me»
     — All of GitHub, как в его имени.
  7. `prSearch.saved` — `'project', 'read'` (так в Ticket-е; spec в разделе 1 называет все три канала сохранённых
     поисков `write`, но в разделе 11 говорит «с доступом Read only читаются, но не меняются»).
  8. Курсор «Load more» — непрозрачная строка с курсором каждого из разделённых запросов; результаты нескольких
     запросов сливаются по `updatedAt`, если пользователь не задал свой `sort:`.
- Вне `## Где в коде`, но нужно для Ticket-а: `test/fixtures/gh/gh-stub.mjs` (stand-in отвечает на поиск из
  `search.json`, печатает статус и заголовки при `-i`, «скрытый» репозиторий для 404), `test/unit/link-access.test.ts`
  (пять новых каналов в списках read/write — test требует назвать каждый), экспорт `firstJson` в
  `src/main/github/inbox-notifications.ts`. В `src/main/github/inbox.ts` кроме экспорта `rowOf` — `readPull` и три
  метода общей паузы на rate limit (`accountPause`, `noteAccountRate`, `pauseAccount`): пауза общая с PR inbox, а
  живёт она в кэше аккаунта `PrInbox`.
- Проверка на head `b63f39113` (под временным HOME): `pnpm lint` и `pnpm typecheck` — exit 0; `pnpm test` — exit 1,
  gate fast — exit 2 (`[gate] red (fast): worfy/.:test`, lint и typecheck прошли). Красные только test-ы слежения за
  файлами (fs watch): `docs.test.ts`, `docs-watch-root.test.ts`, `cards-watch-edits.test.ts`, `product-watch.test.ts`,
  `profile-move.test.ts`, `workflow-reader.test.ts` (watcher), `workflow-read-from-main.test.ts`,
  `claude-home-registry.test.ts` (watching) — 30 test-ов, все ждут событие изменения файла и не дожидаются.
  `docs-watch-root.test.ts` красный и отдельно, и на чистом `origin/main` 0d5246cd4 (2 из 6) — это окружение Mac
  (fseventsd), не этот PR; ни один из этих файлов этот PR не трогает. Тесты Ticket-а и соседние test-ы PR inbox
  (9 файлов, 197 test-ов) — exit 0. Зелёный `ci-ok` решает CI.
- Раунд ревью 1 (commit c5292719c), каждый пункт — сначала красный test, потом правка:
  1. `-repo:`, `-org:`, `-user:` в тексте больше не снимают область (раньше поиск This Project уходил на весь
     GitHub) — unit «a negated -repo:, -org: or -user: only narrows».
  2. Память PR вне inbox — по аккаунту и `repo#N`: Project другого аккаунта читает PR своим токеном и не получает
     строку чужого аккаунта — contract «two Projects of two accounts…».
  3. Курсор «Load more» несёт hash строк поиска; курсор другого поиска отклоняется без вызова — contract «a cursor of
     another search is refused…».
  4. 403 с `X-GitHub-SSO` даёт notice SSO и при низком остатке лимита (проверка SSO раньше rate limit) — contract
     «403 with X-GitHub-SSO while the rate limit is low».
  5. Добавлены test-ы на ровно 256 символов (деление при `>=`) и на порядок по `updatedAt` при нескольких запросах.
  Mutant-ы (в своём дереве, восстановлены из копии): `>=` на `>`, сортировка выключена, отрицание как область, память
  без аккаунта, курсор без hash — все пять убиты (test exit 1). Test-ы `pr-search-query`, `pr-search`, `link-access`,
  `pr-inbox` — exit 0 (115 test-ов); `pnpm lint`, `pnpm typecheck` — exit 0. Gate fast не запускался: на этом Mac
  test-ы слежения за файлами красные из-за fseventsd (см. выше), прогон ничего бы не решил.
