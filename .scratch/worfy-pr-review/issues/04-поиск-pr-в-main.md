# 04 — Поиск PR в main: сборка запроса, три области, `prSearch.run` и `prSearch.pull`, сохранённые поиски, Amendment-ы ADR-0105 и ADR-0005

Type: task
Status: claimed 2026-11-20T04:30Z
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
- [ ] Contract `test/contract/pr-search.test.ts` (новый) на gh stand-in (`WORFY_GH`): строка запроса каждой области,
      cursor и «Load more», 1 000, rate limit, 403 SSO и `partial-results`, 422, 404; строка из inbox не читается
      дважды; stand-in валит test на любом `--method` и `mutation` — ни одной записи на GitHub.
- [ ] Тот же contract: `prSearch.save` с Linked machine Read only — отказ; `prSearch.run` — разрешён; больше 20
      сохранённых — отказ; встроенные не удаляются.
- [ ] Amendment-ы ADR-0105 (пункт 1) и ADR-0005 влиты в этом PR.
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
