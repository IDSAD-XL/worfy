# Code story — worfy-auth-check 09: Документы: переводы страниц Feature, ADR Health check, Amendment к ADR-0042, термин в CONTEXT.md

Kind: pr · Epic: worfy-auth-check · Ticket: 09 · PR: - · Language: ru

## 1. Что было не так

Ticket-ы 03–05, 07 и 08 научили Health check уровням строк, состоянию `unknown`, строке GitHub access Project-а и
сообщениям фич о сбоях, но правили только английские страницы Feature (ADR-0088). Девять страниц `docs/features/ru/`
отстали. Решения об уровнях, состояниях и сообщениях не было ни в одном ADR, ADR-0042 (пункт 9) не говорил, откуда gh
берёт token при пустом `github.account`, а статья Health check в CONTEXT.md называла непроверенную строку «не проверено»,
хотя UI пишет «Couldn't check».

- Требование: [Что происходит](../issues/09-документы-перевод-adr-context.md#что-происходит)

## 2. ADR-0109: `unknown` никогда не critical, состояние выводится из кнопок

Code: `docs/adr/0109-health-check-row-levels-and-feature-reports.md:27-32` · key lines: 28, 30

```markdown
2. **Состояние строки.** К статусам добавлен `unknown`: строку не удалось проверить — нет сети, timeout, GitHub 5xx
   или его rate limit. `unknown` никогда не critical: `severityOf` даёт ему `non-critical`, а худший уровень отчёта его
   critical-уровень не учитывает (Q2). Что строка просит у человека, выводится, а не хранится (`checkState` в
   `src/shared/ipc/first-run.ts`): `ok`; `unknown`; `fixable` — у строки есть кнопка с пометкой `safe`, то есть она
   делает только обратимое и не трогает чужих данных; `needs-user` — шаг для человека. Безопасная кнопка показывается
   как **Fix** основным цветом. Сейчас такая кнопка одна — «Use <login>» строки GitHub access.
```

- Что делает: записывает решение Q2: строка, которую не удалось проверить, всегда non-critical, а `fixable | needs-user` не хранится, а выводится из того, есть ли у строки кнопка `safe` (`checkState`).
- Почему здесь: Ticket просит новый ADR с таблицей уровней и состояниями строки ([Что делаем, п. 2](../issues/09-документы-перевод-adr-context.md#что-делаем)); номер 0109 дал preflight.
- Без него: решение жило бы только в spec-е и в коде `src/shared/health/severity.ts`.
- Требование: [Что делаем, п. 2](../issues/09-документы-перевод-adr-context.md#что-делаем)
- Риски и пробелы test-ов: ADR пересказывает код; что каждая фраза верна коду, проверяет только чтение.

## 3. ADR-0109: сообщения фич и одна повторная проверка

Code: `docs/adr/0109-health-check-row-levels-and-feature-reports.md:39-48` · key lines: 40, 42, 44

```markdown
4. **Сообщения фич (Ticket-ы 03, 07, 08).** Фича, у которой сбой на своей строке, вызывает
   `healthReports().reportFailure(id, project, reason, step, actions?)` (`src/main/first-run/health-reports.ts`):
   строка сразу выходит из `ok` — `fail` с причиной и шагом, — без запроса в сеть, поэтому иконка краснеет сразу. Если у
   строки есть своя проверка (`registerRecheck`; сейчас только у `github-access`), за сообщением идёт одна проверка этой
   строки, не чаще раза в минуту на Project. `reportOk(id, project)` — фича снова работает — возвращает строку в `ok`
   без проверки. Побеждает самое новое: проверка, начатая после сообщения, его заменяет. Сообщают: о GitHub — PR inbox,
   PR badges, gate queue, Flight recorder, проба предложения ревью, Send черновиков ответов и старт Session Codex без
   `GH_TOKEN`; о Browser profile — истёкший вход страницы; о Linked machine — другой сертификат или отложенный файл
   секретов. О GitHub сообщается только отказ во входе (нет входа gh для аккаунта, HTTP 401, у gh нет token-а, SAML);
   нет сети, timeout, 5xx и rate limit строк не меняют.
```

- Что делает: описывает `reportFailure` / `reportOk`: строка выходит из `ok` без запроса в сеть, повторная проверка — только у строки со своей проверкой и не чаще раза в минуту на Project; перечисляет, какие фичи сообщают и о чём.
- Почему здесь: Ticket называет сообщения `reportFailure` / `reportOk` и «когда проверять» среди содержания ADR ([Что делаем, п. 2](../issues/09-документы-перевод-adr-context.md#что-делаем)).
- Без него: что повторная проверка есть только у `github-access` (`registerRecheck` в `src/main/ipc/first-run.ts`), было бы видно только в коде; spec говорит о ней для всех строк.
- Требование: [Что делаем, п. 2](../issues/09-документы-перевод-adr-context.md#что-делаем)
- Риски и пробелы test-ов: not recorded.

## 4. Amendment к ADR-0042: пустой `github.account` — `warn`, non-critical

Code: `docs/adr/0042-profile-on-machine-full-and-silent-modes.md:155-163` · key lines: 158, 160, 162

```markdown
  собранное из registry на Windows), если переменная задана и не пуста, и только потом активный аккаунт keyring. Строка
  Health check `GitHub access` Project-а называет источник — аккаунт из keyring, имя переменной окружения или активный
  аккаунт gh — и никогда не token (`src/main/github/auth-diagnosis.ts`, `src/main/first-run/checks.ts`). Пустой
  `github.account` при gh, который работает с тем token-ом, что берёт сам, — строка `warn`, non-critical: работает, но
  держится не на Profile. Если ровно один логин gh на github.com может делать push в каждый репозиторий Project-а,
  строка даёт кнопку «Use <login>»; щелчок пишет одно поле через `bin/profile-set --field github.account` (тот commit-ит
  изменение в Harness home) и только пока этот логин всё ещё единственный с push. Тихого перехода на аккаунт keyring нет
  (Q5 spec-а `worfy-auth-check`). Переменные окружения worfy не меняет никогда: команду, которая удаляет переменную,
  строка только даёт скопировать. Остальное решение в силе.
```

- Что делает: дописывает к пункту 9 порядок источников token-а и что делает строка GitHub access, когда `github.account` пуст: `warn`, non-critical, «Use <login>» по щелчку через `bin/profile-set`, переменные окружения worfy не меняет.
- Почему здесь: Ticket называет датированный Amendment к ADR-0042, пункт 9 ([Что делаем, п. 3](../issues/09-документы-перевод-adr-context.md#что-делаем)); изменение принятого ADR дописывается разделом `## Amendments` (правило ADR проекта).
- Без него: ADR-0042 говорил бы только о `gh auth token -u` и молчал о переменной окружения.
- Требование: [Что делаем, п. 3](../issues/09-документы-перевод-adr-context.md#что-делаем)
- Риски и пробелы test-ов: тикет говорит о «рабочем токене окружения»; код делает строку non-critical при пустом `github.account` и тогда, когда gh работает с активным аккаунтом keyring. Amendment записан по коду (`src/main/first-run/checks.ts`, конец `githubAccess`), расхождение отмечено в итоге тикета.

## 5. Перевод: таблица строки GitHub access

Code: `docs/features/ru/gate-and-github.md:715-720` · key lines: 719

```markdown

| Что нашла | Строка | Уровень | Кнопка |
|---|---|---|---|
| Аккаунт доходит до каждого репозитория | ok: логин, источник его token-а, репозитории | critical | — |
| `github.account` пуст, gh работает со своим token-ом | warn: `github.account is not set` и источник | non-critical | `Use <login>`, когда ровно один логин gh на github.com может делать push в каждый репозиторий |
| В gh нет входа для аккаунта | fail: `no gh login for <login>` | critical | `Sign in…`; при заданном `GH_TOKEN` — команда, которая запускает `gh auth login` без него, потому что gh отказывается входить, пока переменная задана |
```

- Что делает: один пример перевода: таблица случаев строки GitHub access из нового раздела `## GitHub access` русской страницы.
- Почему здесь: Ticket называет девять страниц `docs/features/ru/` ([Что делаем, п. 1](../issues/09-документы-перевод-adr-context.md#что-делаем)).
- Без него: русская страница не знала бы шестой Feature.
- Требование: [Готово, когда](../issues/09-документы-перевод-adr-context.md#готово-когда)
- Риски и пробелы test-ов: `scripts/check-feature-docs.mjs` русские страницы не читает; совпадение по смыслу проверяет только review.

## 6. Что сознательно не меняли

Английские страницы не тронуты, хотя две фразы в них устарели: `onboarding.md` говорит «Codex has no row», а строка
«Codex sign-in» есть (Ticket 08); `gate-and-github.md` называет notice Session Codex «более поздним Ticket-ом», а Ticket 08
влит. Перевод следует английской странице; это находка для линзы `documentation`. SSO-часть (Ticket 06) не входит.

## 7. Как проверено

`node scripts/check-personal.mjs`, `node scripts/check-feature-docs.mjs` — exit 0; `node scripts/feature-docs-lag.mjs`
больше не называет ни одной из девяти страниц. `pnpm lint`, `pnpm typecheck`, `pnpm test` и gate fast — в отчёте
implementer-а с exit code-ами.

Второй круг: verifier нашёл в `ru/onboarding.md` три пропущенных утверждения о worfy Guide. После этого четыре страницы с
прошлой меткой `same-pr` (`onboarding.md`, `app-shell.md`, `projects.md`, `browser.md`) перечитаны целиком против
английских на `5d1efe69`, абзац за абзацем; найденные пропуски и неточности переведены (список — в итоге тикета).

## Проверить себя

1. Почему строка, которую не удалось проверить, не красит иконку в красный, даже если её `severity` — `critical`?
   - Ответ: по решению Q2 `unknown` никогда не critical: `severityOf` даёт ему `non-critical`, а худший уровень отчёта его не учитывает.
   - Строки: `docs/adr/0109-health-check-row-levels-and-feature-reports.md:27-32`
2. Почему сообщение фичи о сбое Browser profile не запускает повторную проверку, а о GitHub — запускает?
   - Ответ: повторная проверка идёт только у строки со своей проверкой (`registerRecheck`), и она есть только у `github-access`.
   - Строки: `docs/adr/0109-health-check-row-levels-and-feature-reports.md:39-48`
3. Что делает worfy, когда `GH_TOKEN` окружения мешает, а `github.account` пуст?
   - Ответ: строка `warn`, non-critical; «Use <login>» пишет `github.account` по щелчку, а команду удаления переменной строка только даёт скопировать — сам worfy переменных не меняет.
   - Строки: `docs/adr/0042-profile-on-machine-full-and-silent-modes.md:155-163`
