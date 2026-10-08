# 09 — Задержка workflow.changed и двойное чтение истории

Type: task
Status: done — 2026-10-06, [PR #46](https://github.com/IDSAD-XL/worfy/pull/46)
Blocked by: 05, 29
Source: [spec.md](../spec.md), тема B; Ticket-ы 10 и 14 worfy-mvp

## Что делаем

Две задержки найдены по коду. Ни одна не измерена.

**1. `workflow.changed`.**

- Debounce в `src/main/workflow/watch.ts:141` — 300 мс.
- `schedule` (`:133`) сбрасывает таймер на каждое событие. При непрерывных записях в `.scratch`
  чтение откладывается без верхней границы.
- Когда таймер всё же срабатывает, `readOnce` (`:162`) запускает полный `epic-status --json`
  (`readCheckout`, `:171`), а затем `readBranches` (`:174`).

**2. Двойное чтение истории.** `refreshAll` в `src/renderer/claude-home/useClaudeHome.ts:88`
вызывает `claudeHome.sessions` (live и история) в трёх местах:

- при первом подключении (`:153`);
- из `refreshClaudeHome` (`:180`);
- из `refreshLive`, когда появилась новая Session (`:119-124`).

Поэтому новая Session читается дважды. Плюс к этому идёт опрос каждые `LIVE_POLL_MS = 2000` (`:21`,
`:80`).

**Первый шаг — замер на настоящем Auction, только чтение.** Числа идут в «Итог» до кода:

- время от записи файла Ticket-а до `workflow.changed` в renderer;
- время одного `epic-status --json`;
- число вызовов `claudeHome.sessions` на появление одной новой Session.

**Правки:**

- `watch.ts`: у debounce появляется max-wait — чтение не позже чем через X после первого события в
  серии. X выбирается по замеру.
- `useClaudeHome.ts`: ровно одно чтение истории на появление новой Session. Заголовок новой Session
  по-прежнему появляется после первого prompt-а. Комментарий в файле объясняет, зачем был повтор:
  запись в реестре появляется раньше транскрипта.
- Ответ старого запроса не затирает ответ более нового. Сейчас порядок ответов не проверяется.

Повторный замер после правок — в «Итог».

## Готово, когда

- [x] В «Итог» — замеры на Auction до и после: задержка `workflow.changed`, время `epic-status`, число чтений истории.
- [x] Непрерывный поток событий не откладывает чтение дольше max-wait (test с подставным `run` и фиксированными часами).
- [x] Появление новой Session даёт одно чтение `claudeHome.sessions` с историей. Заголовок после первого prompt-а есть.
- [x] Если ответы `claudeHome.sessions` пришли не по порядку, на экране остаётся ответ последнего запроса.
- [x] `~/.claude` и Auction только читаются.

## Тесты

- `test/contract/workflow-reader.test.ts` — max-wait, рядом с test-ами watcher-а (`:583-597`).
- `test/unit/claude-home-titles.test.tsx` — счёт `invoke('claudeHome.sessions')`; ответы не по порядку.
- Сначала падающий test: события каждые 200 мс в течение 3 с, и до конца серии `workflow.changed` не приходит ни разу.

## Где в коде

- `src/main/workflow/watch.ts`
- `src/renderer/claude-home/useClaudeHome.ts`
- `test/contract/workflow-reader.test.ts`
- `test/unit/claude-home-titles.test.tsx`

## Итог

Влит [PR #46](https://github.com/IDSAD-XL/worfy/pull/46), merge 0c53cf7, без круга доработки. Gate: `fast` и `GATE_SCOPE=all full` — exit 0, зелено.

- `src/main/workflow/watch.ts`: класс `Debounce` — тишина 300 мс, но чтение не позже `maxWaitMs` (по умолчанию 1000 мс) после первого события серии. Чтения по-прежнему не пересекаются.
- `src/renderer/claude-home/useClaudeHome.ts`: live Session из ответа `claudeHome.sessions` считается прочитанной, повторного чтения истории на следующем опросе нет. Session, которая есть только в ответе `claudeHome.live`, получает ровно одно чтение истории. Изменение транскрипта, пришедшее раньше ответа со своей Session, не теряется. У каждого запроса `claudeHome.sessions` / `claudeHome.live` номер: ответ старше показанного отбрасывается, отдельно для live и для истории.

**Замеры** — Auction (682 Ticket-а) только читался, записи шли в shallow clone в `/tmp`:

| | до | после |
|---|---|---|
| один `epic-status --json` по checkout | 746–915 мс (5 прогонов) | скрипт не менялся |
| полное чтение Auction (checkout + 6 снимков веток) | 2233–2649 мс | 2859–3223 мс (машина загружена сильнее; путь чтения не менялся) |
| одна запись → `onChange` в main | 1142, 1163, 1143 мс | 1184, 1314, 1662 мс |
| 15 записей через 200 мс (поток кончается на ~3,0 с): `onChange` на | только 3949 мс (во время потока — ничего) | 2216, 3234, 4132 мс |
| чтений истории на Session, впервые пришедшую в ответе `claudeHome.sessions` (unit-test) | 2 | 1 |

**Принятый риск.** Без повторного чтения истории Session, чья первая запись в транскрипт не даёт события в renderer, получит заголовок только после переподписки. Так бывает с worktree вне корня Project, созданным после подписки: список корней наблюдателя считается один раз при `watch` (`src/main/claude-home/registry.ts:468`).

### Долги из HANDOFF (2026-10-08)

- [low] Комментарий у `maxWaitMs` (`src/main/workflow/watch.ts:31-36`) не обосновывает 1000 мс и обещает
  первое изменение «within about 1.8 s», а замер дал 2216 мс.
- [low] В `useClaudeHome.ts` нет test-а на ответ с ошибкой, который отбрасывает более старый успешный.
