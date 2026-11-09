# 02 — Чтение PR inbox в main: поиск раз в 5 минут, детали, темп, кэш по аккаунту, группы, seen-state

Type: task
Status: open
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
- [ ] Contract test: поиск — раз в 5 минут; `GET /notifications` не вызывается ни разу.
- [ ] Contract test: `refresh(repo, number)` читает детали этого PR сразу, вне очереди поиска.
- [ ] Contract test: 504 на деталях — повтор с половиной страницы; ошибка подряд — удвоение интервала до 30 минут.
- [ ] Contract test: два Project-а одного аккаунта — один запрос деталей на PR.
- [ ] Contract test: `prInbox: false` — ни одного вызова gh для Project-а.
- [ ] Contract test: за N циклов чтения журнал stub-а не содержит ни одной записи — ни `--method` кроме `GET`, ни
      `mutation`.
- [ ] Contract test: `pr-inbox.json` после чтения — только id, sha и время; ни одного `body`.
- [ ] Unit test: группы по fixture-снимку (каждая из пяти, «via team», повторный запрос ревью после моего ревью).
- [ ] Test: ничего не пишется в репозитории Project-а и в Claude home (ADR-0005).
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
