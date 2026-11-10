# 02 — Чтение PR inbox в main: поиск раз в 5 минут, детали, темп, кэш по аккаунту, группы, seen-state

Type: task
Status: done 2026-11-10T02:10Z
PR: #1755
Blocked by: —
Source: [spec.md](../spec.md), «Как работает» → «Чтение в main (Ticket 02; Q3, Q4, Q10)»; «Решено без владельца»;
«Риски» («Rate limit», «Следы в Silent mode»); «Ticket-ы», «Волны» (Wave 1); решения Q3, Q10;
[критика](../../../docs/product/critic/worfy-pr-inbox-2026-11-09.md), возражение 3 (триггер уведомлений — Ticket 08);
[ADR-0105](../../../docs/adr/0105-pr-reply-only-on-the-users-click.md), пункты 1, 6, 7

Платформенный Ticket: нет (main процесс, gh через существующий `ghRunner`). Глубина ревью — `high`.

## Что происходит

- `src/main/github/prs.ts:47` — `FIELDS` PR tracker-а без нитей ревью и `mergeStateStatus`; `src/main/ipc/checks.ts:5-7`
  — только ветки Ticket-ов. PR коллег и PR пользователя вне worfy не читаются.
- Готовые части: `accountAuth` (`prs.ts:171`), `ghRunner` с `WORFY_GH` (`prs.ts:93`, :117), `readGithubAccount`
  (`src/main/workflow/profile.ts:670`), репозитории Project-а (`layout.repos`, `checks.ts:135-136`), темп с удвоением
  (`src/main/github/gate-queue.ts:25-26`), признак rate limit (`prs.ts:440`).

## Что делаем

1. `src/main/github/inbox.ts` — читатель PR inbox по Project-у:
   - два GraphQL `search(type: ISSUE)` (`review-requested:@me` и `involves:@me` по `repo:` каждого репозитория
     Project-а), одна страница, `number, updatedAt, headRefOid`;
   - детали только для PR со сдвинутым `updatedAt`, по 10 PR (поля — spec, «Чтение в main»), без `diffHunk` и
     `files`; повтор на 502/503/504 и деление страницы пополам;
   - темп: поиск раз в 5 минут, с фокусом и без; ошибка — удвоение до 30 минут, первый успех возвращает 5 минут;
     меньше 10 % rate limit (`rateLimit { remaining resetAt }`) — пауза до `resetAt`;
   - вход «проверить PR сейчас» (`refresh(repo, number)`): детали этого PR вне очереди. Его зовёт триггер
     уведомлений Ticket-а 08; в этом Ticket-е — только test-ы;
   - кэш по аккаунту: два Project-а одного аккаунта не читают один PR дважды.
2. Группы (Needs my review, Needs my answer, Needs a fix, Ready, Waiting on others) — чистая функция над снимком, по
   правилам spec-а; запрос только через команду помечен `viaTeam`.
3. `src/main/projects/pr-inbox-state.ts` — seen-state в `<Project data folder>/pr-inbox.json`: по PR `seenAt`,
   `seenHeadOid`, id последнего увиденного комментария. Без текстов. Тексты нитей — только в
   памяти.
4. `src/shared/ipc/pr-inbox.ts` и `src/main/ipc/pr-inbox.ts`: `prInbox.get` (снимок Project-а: группы, строки, нити,
   время следующего поиска, причина ошибки, `notice` — строка для вида, которую заполняет Ticket 08; здесь всегда `null`), `prInbox.changed` (событие), `prInbox.markSeen` — каналы `project`: чтение
   `read`, `markSeen` — `write`. Linked machine получает снимок Machine Project-а; сама не опрашивает GitHub.
5. Поле `prInbox` в схеме `settings.json` Project-а (`projectSettingsSchema`,
   `src/shared/projects/action-templates.ts:176`): нет поля — включено, если у Project-а есть remote на GitHub;
   `false` — читатель Project-а не запускается.
6. Запуск в `src/main/index.ts`, рядом с gate queue (`installGateQueueNotifications`, `index.ts:183`).
7. stub gh (`test/fixtures/gh/gh-stub.mjs`) отвечает на `api graphql` (search, детали) из fixture-ов и пишет журнал
   вызовов.

## Готово, когда

- [ ] Contract test: Project из двух репозиториев — поиск называет оба `repo:`, детали спрашивают только PR со
      сдвинутым `updatedAt`; чужой репозиторий того же аккаунта не спрашивается.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox.test.ts` exit 0 · mac - · c975dda406e3e5c91aff3a08bef4ff1a4a4d7b5b
- [ ] Contract test: поиск — раз в 5 минут; `GET /notifications` не вызывается ни разу.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox.test.ts` exit 0 · mac - · c975dda406e3e5c91aff3a08bef4ff1a4a4d7b5b
- [ ] Contract test: `refresh(repo, number)` читает детали этого PR сразу, вне очереди поиска.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox.test.ts` exit 0 · mac - · c975dda406e3e5c91aff3a08bef4ff1a4a4d7b5b
- [ ] Contract test: 504 на деталях — повтор с половиной страницы; ошибка подряд — удвоение интервала до 30 минут.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox.test.ts` exit 0 · mac - · c975dda406e3e5c91aff3a08bef4ff1a4a4d7b5b
- [ ] Contract test: два Project-а одного аккаунта — один запрос деталей на PR.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox.test.ts` exit 0 · mac - · c975dda406e3e5c91aff3a08bef4ff1a4a4d7b5b
- [ ] Contract test: `prInbox: false` — ни одного вызова gh для Project-а.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox.test.ts` exit 0 · mac - · c975dda406e3e5c91aff3a08bef4ff1a4a4d7b5b
- [ ] Contract test: за N циклов чтения журнал stub-а не содержит ни одной записи — ни `--method` кроме `GET`, ни
      `mutation`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox.test.ts` exit 0 · mac - · c975dda406e3e5c91aff3a08bef4ff1a4a4d7b5b
- [ ] Contract test: `pr-inbox.json` после чтения — только id, sha и время; ни одного `body`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox.test.ts` exit 0 · mac - · c975dda406e3e5c91aff3a08bef4ff1a4a4d7b5b
- [ ] Unit test: группы по fixture-снимку (каждая из пяти, «via team», повторный запрос ревью после моего ревью).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/pr-inbox-groups.test.ts` exit 0 · mac - · c975dda406e3e5c91aff3a08bef4ff1a4a4d7b5b
- [ ] Test: ничего не пишется в репозитории Project-а и в Claude home (ADR-0005).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox.test.ts` exit 0 · mac - · c975dda406e3e5c91aff3a08bef4ff1a4a4d7b5b
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- Contract `test/contract/pr-inbox.test.ts` (новый), unit `test/unit/pr-inbox-groups.test.ts` (новый).
- Сначала падающий: поиск по Project-у из двух репозиториев на `main` — модуля нет.
- Ни настоящего GitHub, ни модели: gh — только stub через `WORFY_GH`; владельцы, репозитории и login-ы в fixture-ах
  выдуманные.
- Ничего не публикуется без щелчка: читатель не делает записей вовсе, и test-ы это проверяют по журналу stub-а.

## Где в коде

- `src/main/github/inbox.ts` (новый)
- `src/main/projects/pr-inbox-state.ts` (новый)
- `src/shared/ipc/pr-inbox.ts` (новый)
- `src/main/ipc/pr-inbox.ts` (новый)
- `src/main/index.ts`
- `src/shared/projects/action-templates.ts` (поле `prInbox` схемы `settings.json`)
- `test/fixtures/gh/gh-stub.mjs`
- `test/contract/pr-inbox.test.ts` (новый)
- `test/unit/pr-inbox-groups.test.ts` (новый)

## Итог

- Сначала падающий: оба новых файла test-ов красные до реализации — модуля `src/main/github/inbox.ts` нет.
- Читатель — класс `PrInbox` (`src/main/github/inbox.ts`). Оба `search(type: ISSUE)` идут в одном вызове
  `gh api graphql` (два поля с alias-ами `review` и `involves`), вместе с `viewer { login }` и
  `rateLimit { limit remaining resetAt }`. Узел поиска несёт ещё `repository { nameWithOwner }`: без него у Project-а из
  нескольких репозиториев нельзя понять, чей PR.
- Вызовов gh за один поиск Project-а с N PR: `gh auth token -u <account>` (1, когда Profile называет аккаунт) + поиск
  (1) + детали `ceil(M / 10)`, где M — PR со сдвинутым `updatedAt` (при первом поиске M = N) плюс не больше 10 PR из
  кэша, у которых CI ещё идёт или `mergeStateStatus` пуст или `UNKNOWN`: конец CI и новый конфликт `updatedAt` не
  сдвигают. Повтор на 503 — до 2 раз; 502/504 делит страницу пополам до одного PR. PR, который GitHub не находит
  («Could not resolve to a PullRequest», gh выходит с кодом 1 на всю страницу), — страница читается по одному PR,
  этот PR уходит из кэша, ошибки у Project-а нет. Кроме gh — `bin/profile` (аккаунт) и `git remote get-url origin` на
  каждый репозиторий, только когда поиск Project-а подошёл по времени.
- Детали — alias-ы `pN: repository(owner: $oN, name: $nN) { pullRequest(number: $kN) { … } }` с переменными `-f`/`-F`,
  без подстановки имён в текст запроса. CI — `commits(last: 1) { … statusCheckRollup { state } }`. Номер комментария
  для REST — GraphQL `databaseId` как есть (null, если GitHub его не дал); догадка первого раунда, что он переполняется,
  была неверной, и разбор `url` убран.
- Кэш — по аккаунту (логин или `''` для своего аккаунта gh); PR, которых не нашёл ни один поиск, из кэша уходят.
  Project, которого больше нет в списке, теряет своё состояние на следующем тике, и его PR уходят из кэша.
  Пауза ниже 10 % rate limit — тоже на аккаунт: ни поиск, ни `refresh` не идут до `resetAt`, интервал не удваивается.
- Группы — `groupOf`/`groupPulls` в отдельном модуле `src/main/github/inbox-groups.ts`, порядок правил: Needs my review → Needs my answer → Needs a fix → Ready → Waiting
  on others, первая подходящая. Needs my answer — также нерешённая нить на чужом PR, где я писал, а последний
  комментарий не мой. Чужой PR без моего хода не показывается. Ready без CI (`ci: null`) считается зелёным. Needs my
  review — сначала старые по `createdAt`, остальные группы — сначала старые по `updatedAt`. Когда `reviewDecision`
  пуст (правило защиты ветки не требует review), решение берётся из `latestOpinionatedReviews`: чьё-то
  CHANGES_REQUESTED, иначе APPROVED. `lastActivityAt` строки — время последнего комментария или review, иначе
  `updatedAt`.
- «N new since you looked» — комментарии не мои новее `seenAt`; без записи — все не мои. `pr-inbox.json` пишется только
  по `prInbox.markSeen`: чтение файл не создаёт.
- `prInbox: false` читается из `settings.json` без остальной схемы (`prInboxSetting`), файл не переносится и не
  переписывается. Вне «Где в коде»: `src/main/projects/settings.ts` — сохранение без `prInbox` (Save диалога Project
  settings его не шлёт) держит сохранённое значение, как `humanReview`; test — в `test/contract/projects.test.ts`.
  `test/unit/link-access.test.ts` — `prInbox.get` в списке `read`, `prInbox.markSeen` в списке `write`.
  `docs/features/storage-and-diagnostics.md` — строка `pr-inbox.json` и поле `prInbox` в таблице папки Project-а.
- Запуск — `startPrInbox()` в `src/main/index.ts` рядом с gate queue: таймер раз в 30 с смотрит, чей поиск подошёл;
  первый `prInbox.get` читает Project сразу.
- Mutation testing — в отдельной копии (`git worktree add --detach`), по одному mutant-у на каждый новый test: 29 из 29
  убиты (13 contract, 15 unit, 1 в `projects.test.ts`); каждый mutant роняет ровно свой test при запуске `-t`.
- Проверки: `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (718 файлов test-ов), gate fast — exit 0, `[gate] green`.
