# 117 — утренний digest PR inbox считает Project, чьё первое чтение ещё не кончилось

Type: bug
Status: claimed 2026-11-15T04:45Z
Branch: worfy-polish/117
Blocked by: none
Source: красный e2e в CI-run 43673031109 (PR #1841, job macos-e2e 2/2, обе попытки; PR трогает только MCP popover),
бриф Orchestrator-а 2026-11-15.

## Что происходит

e2e `test/e2e/pr-inbox-digest.spec.ts:142` упал на `:155`: digest показал «1 review waits for you (3 days) · 1 PR has
new comments» вместо «2 reviews wait for you (oldest 3 days) · 1 PR has new comments». В digest нет review request-а
второго Project-а (`ops`), хотя в sidebar все три строки есть.

Trace приложения из artifact-а (`app-trace-*.zip` обеих попыток) показывает: toast digest-а уже стоит в DOM-снимке
в 03:56 по времени trace 992136.7 — до клика по вкладке Pull requests (992141) и до `focusWindow` теста (992353). В
том же снимке у `web` «2 PR need you», у `ops` строк ещё нет; строки `ops` появляются в снимке 992240. Значит,
digest решило не focus теста, а ранний вопрос самого окна: `installPrInboxDigest`
(`src/renderer/pr-inbox/digest.ts:57-59`, `:64-65`) спрашивает при загрузке, если у окна фокус, и снова на каждый
`prInbox.changed`, пока ответ `pending`. На macOS runner-е окно в этот раз получило фокус, поэтому вопрос пришёл, пока
читался `ops`.

Ни дата, ни время суток здесь ни при чём: время fixture-ов (`at(72)`) и `localDay` дают тот же текст в любой час.

## Root cause

`PrInbox.poll` (`src/main/github/inbox.ts:521` до правки) ставит `state.readAt = now` сразу после search, до чтения
details. Пока details второго Project-а читаются, его snapshot уже несёт `readAt`, его `members` знают PR, но кэша
details для них нет — `snapshot()` (`inbox.ts:394-397`) отдаёт пустые группы. `nextSearchAt` в это время `null`
(первое чтение ещё не кончилось), поэтому `due()` не срабатывает. `PrInboxDigest.ask`
(`src/main/github/inbox-digest.ts:119`) считает такой Project прочитанным, решает день по неполным snapshot-ам и
больше в этот день не показывает digest.

Пользователь видит то же самое: окно с фокусом при запуске worfy получает digest без PR-ов второго Project-а, и до
следующего дня исправленного digest-а нет. Race стал виден после #1863 (audit i): до него `snapshot()` во время первого
чтения бросал `RangeError` на `nextSearchAt`, вопрос digest-а падал, и окно спрашивало ещё раз позже.

## Что делаем

- `PrInbox.poll` ставит `readAt` после чтения details (и после остановки по rate limit, как раньше), а не после
  search. `readAt` теперь значит «последнее чтение, дошедшее до details»: пока первое чтение идёт, его нет, и digest
  отвечает `pending`. Чтение, чьи details упали, `readAt` не двигает — как и чтение, чей search упал.
- Комментарий поля `readAt` в `src/shared/ipc/pr-inbox.ts` говорит то же.
- e2e не трогаем: тест прав, ошибка в продукте. Feature page `docs/features/notifications.md` уже говорит «until every
  Project whose inbox is on has been read once since worfy started, the digest waits» — код теперь этому соответствует.

## Готово, когда

- [ ] Contract test: два Project-а одного account-а, details второго задержаны; вопрос digest-а в это время —
      `pending`, `readAt` второго — `null`; после чтения — «2 reviews wait for you…». Красный до правки (digest
      отвечал `show` с «1 review waits for you (1 day) · 1 PR has new comments»).
  - evidence: test-run pass · `pnpm test test/contract/pr-inbox.test.ts -t "worfy-polish 117"` exit 0, exit 1 before the fix (digest answered show "1 review waits for you") · mac - · 6ccf7e62321f1179fd2a23a588b8d21d5c8aa244
- [ ] Остальные unit и contract test-ы PR inbox зелёные без правок.
  - evidence: test-run pass · `pnpm test` of the 8 PR inbox unit and contract files exit 0, 213 of 213 · mac - · 6ccf7e62321f1179fd2a23a588b8d21d5c8aa244
- [ ] lint, typecheck, gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0, lint and typecheck exit 0 · mac - · 6ccf7e62321f1179fd2a23a588b8d21d5c8aa244
- [ ] CI PR зелёный, в том числе macos-e2e с `pr-inbox-digest.spec.ts`.

## Где в коде

- `src/main/github/inbox.ts` — `PrInbox.poll`, место `state.readAt = now`.
- `src/shared/ipc/pr-inbox.ts` — комментарий поля `readAt` snapshot-а.
- `test/contract/pr-inbox.test.ts` — новый test рядом с «a snapshot taken while the first read runs…».
- `.scratch/worfy-polish/issues/117-утренний-digest-считает-project-до-конца-чтения.md` — этот ticket.

## Вне скоупа

- `src/main/github/inbox.ts:471-483` (`pollIfDue`, ветка «off») — Project, который выключили и снова включили, держит
  старый `readAt`; пока идёт его новое чтение, `nextSearchAt` — `null`, и digest посчитает его пустым. Тот же класс
  race-а, но только после переключения в Settings; отдельный ticket, если понадобится.
