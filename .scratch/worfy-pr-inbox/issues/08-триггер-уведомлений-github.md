# 08 — Триггер уведомлений GitHub: `GET /notifications` с `If-Modified-Since`, 304 — «без перемен»

Type: task
Status: done 2026-11-10T02:10Z
PR: #1761
Blocked by: 02
Source: [spec.md](../spec.md), «Как работает» → «Триггер уведомлений (Ticket 08; Q4)»; «Риски» («Rate limit», «Scope
токена»); «Ticket-ы», «Волны» (Wave 2); решение Q4; [критика](../../../docs/product/critic/worfy-pr-inbox-2026-11-09.md),
возражения 2 и 3; [ADR-0105](../../../docs/adr/0105-pr-reply-only-on-the-users-click.md), пункт 1

Платформенный Ticket: нет (main процесс, gh через существующий `ghRunner`). Глубина ревью — `high`.

Ticket 02 работает на одном поиске раз в 5 минут; этот Ticket только ускоряет его: изменённый PR читается сразу, а не
к следующему поиску. Без него вид полностью рабочий.

## Что происходит

- Читатель Ticket-а 02 (`src/main/github/inbox.ts`) ищет PR раз в 5 минут и даёт вход `refresh(repo, number)` — детали
  одного PR вне очереди.
- `ghRunner` (`src/main/github/prs.ts:117`): в режиме `stdout` ненулевой exit отклоняется короткой причиной; в режиме
  `all` — `GhExitError` с stdout и stderr вместе (`prs.ts:51-57`). Удвоение интервала после ошибки — правило читателя.
- gh на ответ 304 печатает `gh: HTTP 304` и выходит с кодом 1 (`pkg/cmd/api/api.go` в cli/cli: статус больше 299 —
  `serverError = "HTTP <код>"`, `SilentError`). Без особого разбора нормальный ответ «ничего не изменилось» выглядит
  как сбой: читатель удваивал бы интервал до 30 минут в тихий час или писал ошибку на каждом опросе.

## Что делаем

1. `src/main/github/inbox-notifications.ts` — опрос
   `gh api -i "notifications?participating=true" -H "If-Modified-Since: <Last-Modified>"` с `GH_TOKEN` аккаунта
   Project-а (`accountAuth`), через `ghRunner` в режиме `all`, чтобы ненулевой exit нёс вывод.
2. Как читается ответ:
   - `-i` печатает строку статуса и заголовки; из них берутся статус, `Last-Modified` и `X-Poll-Interval`;
   - **304** — gh выходит с кодом 1 и печатает `gh: HTTP 304`. Это «без перемен», не сбой: ни ошибки в снимке, ни
     удвоения интервала, ни вызова деталей; следующий опрос — через `X-Poll-Interval` (или 60 с);
   - **200** — тело — список уведомлений; берутся только `subject.type == "PullRequest"` в репозиториях Project-а;
     номер PR — из `subject.url`; каждый такой PR — `refresh(repo, number)` у читателя Ticket-а 02; новый
     `Last-Modified` — в seen-state;
   - **403** (fine-grained PAT, GitHub App, токен без scope `notifications`/`repo`) — триггер выключен до рестарта или
     смены аккаунта; `notice` снимка — «GitHub notifications unavailable for this token — checking every 5 minutes»;
     поиск идёт как был;
   - другой статус или gh не запустился — сбой: удвоение интервала триггера до 30 минут, поиск не трогается.
3. Только `GET`. Никогда `PATCH` уведомления («прочитано»): это inbox самого пользователя на сайте GitHub (Q4).
4. Темп: без фокуса окна — раз в 5 минут; с фокусом или открытым видом — `X-Poll-Interval` (обычно 60 с). Меньше 10 %
   rate limit (`x-ratelimit-remaining`) — пауза до `x-ratelimit-reset`.
5. Курсор `Last-Modified` — в `<Project data folder>/pr-inbox.json` (`src/main/projects/pr-inbox-state.ts` из
   Ticket-а 02); по аккаунту, как кэш читателя.
6. Stub gh (`test/fixtures/gh/gh-stub.mjs`) отвечает на `api -i notifications` из fixture-а: 200 со строкой статуса,
   заголовками и телом; 304 — как настоящий gh: `gh: HTTP 304` в stderr и **exit 1**; 403 — exit 1 и `gh: … (HTTP 403)`.
7. `docs/features/gate-and-github.md` — абзац о триггере уведомлений PR inbox: что читается, 304, 403, никогда
   «прочитано».

## Готово, когда

- [ ] Contract test: 304 (stub выходит с кодом 1, `gh: HTTP 304`) — ни одного чтения деталей, интервал не удвоен,
      ошибки в снимке нет.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox-notifications.test.ts` exit 0 · mac - · 57c6a1274f2e5c0c03af7f02cc7c52e4ba4a4262
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox-notifications.test.ts` exit 0 · mac - · 8661292870f4adc12bd0a429c2ac4f83ed6c5c88
- [ ] Contract test: 200 с уведомлением о PR Project-а — детали этого PR читаются сразу; уведомление о PR чужого
      репозитория и не-PR — ничего.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox-notifications.test.ts` exit 0 · mac - · 57c6a1274f2e5c0c03af7f02cc7c52e4ba4a4262
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox-notifications.test.ts` exit 0 · mac - · 8661292870f4adc12bd0a429c2ac4f83ed6c5c88
- [ ] Contract test: следующий опрос несёт `If-Modified-Since` из последнего `Last-Modified`; темп —
      `X-Poll-Interval`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox-notifications.test.ts` exit 0 · mac - · 57c6a1274f2e5c0c03af7f02cc7c52e4ba4a4262
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox-notifications.test.ts` exit 0 · mac - · 8661292870f4adc12bd0a429c2ac4f83ed6c5c88
- [ ] Contract test: 403 — триггер выключен, `notice` в снимке, поиск раз в 5 минут продолжается.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox-notifications.test.ts` exit 0 · mac - · 57c6a1274f2e5c0c03af7f02cc7c52e4ba4a4262
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox-notifications.test.ts` exit 0 · mac - · 8661292870f4adc12bd0a429c2ac4f83ed6c5c88
- [ ] Contract test: 500 — интервал триггера удвоен; поиск не тронут.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox-notifications.test.ts` exit 0 · mac - · 57c6a1274f2e5c0c03af7f02cc7c52e4ba4a4262
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox-notifications.test.ts` exit 0 · mac - · 8661292870f4adc12bd0a429c2ac4f83ed6c5c88
- [ ] Contract test: журнал stub-а — только `GET`; ни `PATCH`, ни `--method` кроме `GET`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox-notifications.test.ts` exit 0 · mac - · 57c6a1274f2e5c0c03af7f02cc7c52e4ba4a4262
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox-notifications.test.ts` exit 0 · mac - · 8661292870f4adc12bd0a429c2ac4f83ed6c5c88
- [ ] `docs/features/gate-and-github.md` описывает триггер.
  - evidence: commit pass · PR inbox: GitHub notifications as a trigger for the reader, a 304 (gh exit 1) read as unchanged · - - · 57c6a1274f2e5c0c03af7f02cc7c52e4ba4a4262
  - evidence: commit pass · PR inbox notifications: rate-limit 403/429 pause, 404 off, onChange on off, safe cursor write · - - · 8661292870f4adc12bd0a429c2ac4f83ed6c5c88
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 57c6a1274f2e5c0c03af7f02cc7c52e4ba4a4262
  - evidence: gate pass · `gate fast` exit 0 · mac - · 8661292870f4adc12bd0a429c2ac4f83ed6c5c88

## Тесты

- Contract `test/contract/pr-inbox-notifications.test.ts` (новый).
- Сначала падающий: 304 от stub-а с exit 1 — на ветке без разбора интервал удваивается.
- Ни настоящего GitHub, ни модели: gh — только stub через `WORFY_GH`, с настоящим кодом выхода 1 на 304;
  выдуманные владельцы, репозитории и login-ы.
- Ничего не публикуется без щелчка: триггер только читает, и test-ы проверяют это по журналу stub-а.

## Где в коде

- `src/main/github/inbox-notifications.ts` (новый)
- `src/main/github/inbox.ts`
- `src/main/projects/pr-inbox-state.ts`
- `test/fixtures/gh/gh-stub.mjs`
- `test/contract/pr-inbox-notifications.test.ts` (новый)
- `docs/features/gate-and-github.md`
