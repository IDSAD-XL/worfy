# 09 — Задержка workflow.changed и двойное чтение истории

Type: task
Status: blocked — blocked by 05
Blocked by: 05
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

- [ ] В «Итог» — замеры на Auction до и после: задержка `workflow.changed`, время `epic-status`, число чтений истории.
- [ ] Непрерывный поток событий не откладывает чтение дольше max-wait (test с подставным `run` и фиксированными часами).
- [ ] Появление новой Session даёт одно чтение `claudeHome.sessions` с историей. Заголовок после первого prompt-а есть.
- [ ] Если ответы `claudeHome.sessions` пришли не по порядку, на экране остаётся ответ последнего запроса.
- [ ] `~/.claude` и Auction только читаются.

## Тесты

- `test/contract/workflow-reader.test.ts` — max-wait, рядом с test-ами watcher-а (`:583-597`).
- `test/unit/claude-home-titles.test.tsx` — счёт `invoke('claudeHome.sessions')`; ответы не по порядку.
- Сначала падающий test: события каждые 200 мс в течение 3 с, и до конца серии `workflow.changed` не приходит ни разу.

## Где в коде

- `src/main/workflow/watch.ts`
- `src/renderer/claude-home/useClaudeHome.ts`
- `test/contract/workflow-reader.test.ts`
- `test/unit/claude-home-titles.test.tsx`
