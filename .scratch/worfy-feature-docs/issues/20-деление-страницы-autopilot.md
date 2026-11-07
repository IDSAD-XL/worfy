# 20 — Деление страницы Autopilot: Fault scenarios и восстановление на своей странице

Type: task
Status: claimed 2026-11-07T06:06Z
Blocked by: —
Source: «Как устроено» [spec.md](../spec.md) (страница больше примерно 400 строк делится на две), решение владельца 2026-10-30, Q9; решение владельца 2026-11-05 (деление после приёмки worfy-faults); Epic [worfy-faults](../../worfy-faults/spec.md), Q6; [ADR-0088](../../../docs/adr/0088-feature-pages-in-english.md) (английский как основной язык Feature page)

## Что происходит

- `docs/features/autopilot.md` — 518 строк на `main` 16a0932d, перевод `docs/features/ru/autopilot.md` — 479. Правило
  Epic-а — больше примерно 400 строк делится на две.
- Страница выросла с Epic-ом worfy-faults: Ticket worfy-faults 07 дописал в `#### Tests` шесть строк test-ов сбоев и
  блок **Fault scenarios** (что такое Fault scenario, `checkRecovery`, правила I1–I8, `faultRun()` и
  `test/e2e/autopilot-world.ts`). Ticket-ы worfy-retry 14 и 10 правят ту же страницу ещё раз.
- На разделы страницы ссылаются другие страницы: `#during-a-run` (4 ссылки), `#the-journal-file`,
  `#the-run-mode-the-start-window-and-the-budget`.

## Что делаем

1. Ждёт приёмки worfy-faults (Ticket 08), решение владельца 2026-11-05. После приёмки Orchestrator
   переводит этот Ticket в `open` инструментом `ticket`.
2. Читает страницу и код из свежего `origin/main`. Новая страница `docs/features/autopilot-faults.md` получает часть о
   сбоях и восстановлении: блок **Fault scenarios** с правилами I1–I8 и строки test-ов сбоев из `#### Tests`. Если
   `autopilot.md` и после этого больше примерно 400 строк, вместе с ними уходят разделы Behaviour о том, как Run
   останавливается и что после остановки («Stopping», «After any other stop», «Why a run stops»); выбор — в `## Итог`.
3. Новая страница — по шаблону Epic-а: **Behaviour**, **How it works**, **Implementation**; без номеров строк, без
   changelog. `autopilot.md` ссылается на неё одной строкой там, где была перенесённая часть.
4. Перевод `docs/features/ru/autopilot-faults.md` с шапкой `> Перевод [английской версии](../autopilot-faults.md), commit `same-pr`.`
   под заголовком; из `docs/features/ru/autopilot.md` уходит та же часть.
5. Строка новой страницы в индексе `docs/features/README.md` и `docs/features/ru/README.md`. Ссылки других страниц на
   перенесённые разделы ведут на новую страницу.

Не входит: правка содержания перенесённой части, кроме ссылок и одной вводной фразы.

## Готово, когда

- [ ] `docs/features/autopilot.md` и `docs/features/autopilot-faults.md` — каждая не больше примерно 400 строк; что
      перенесено и почему — в `## Итог`.
- [x] Перевод обеих страниц в `docs/features/ru/` с шапкой.
  - evidence: commit pass · docs(features): move Autopilot waits, stops and Fault scenarios to their own page (worfy-feature-docs 20) · - - · 547d8c402549315ecff890b802d34211a49e25b4
- [x] Индекс на обоих языках называет новую страницу; ни одна ссылка `docs/` на перенесённый раздел не ведёт в пустоту.
  - evidence: commit pass · docs(features): move Autopilot waits, stops and Fault scenarios to their own page (worfy-feature-docs 20) · - - · 547d8c402549315ecff890b802d34211a49e25b4
- [ ] `node scripts/check-feature-docs.mjs` и `pnpm lint` — exit 0; `ci-ok` зелёный. Gate full не нужен: код не меняется.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs && pnpm lint` exit 0 · mac - · 547d8c402549315ecff890b802d34211a49e25b4
  - evidence: gate pass · `gate fast` exit 0 · mac - · 547d8c402549315ecff890b802d34211a49e25b4
- [ ] Review: один агент уровня `low` проверяет, что утверждения перенесены без изменений и ссылки живые.

## Тесты

Новых test-ов нет. Проверка путей Ticket-а 02 (`scripts/check-feature-docs.mjs`) читает обе английские страницы.

## Где в коде

- `docs/features/autopilot.md`
- `docs/features/autopilot-faults.md` (новый)
- `docs/features/ru/autopilot.md`
- `docs/features/ru/autopilot-faults.md` (новый)
- `docs/features/README.md`
- `docs/features/ru/README.md`
- Страницы со ссылками на разделы `autopilot.md`, если раздел переехал: `docs/features/flight-recorder.md`,
  `docs/features/harness.md`, `docs/features/run-planning.md`, `docs/features/sessions.md`, `docs/features/vendors.md` и их
  переводы в `docs/features/ru/`.

## Вне скоупа

- Исправление найденных багов продукта: такая находка — в `## Итог`.
- Деление других страниц.

## Итог

**Исходное состояние другое, чем в Ticket-е.** На `origin/main` 43fdc26ff `docs/features/autopilot.md` — 812 строк, а не 518:
после записи Ticket-а страница выросла с Epic-ами worfy-retry, worfy-auto-approve, worfy-multi-vendor и worfy-autopilot-queue.
Перевод `docs/features/ru/autopilot.md` — 685 строк и отстаёт на 26 commit-ов (шапка `19f1660c`).

**Что перенесено** в `docs/features/autopilot-faults.md` (Autopilot faults and recovery), без правки текста, только блоками:

- Behaviour: «Waiting for the Limits», «Retry after an API error», «Stopping», «After any other stop», «Why a run stops».
  Ожидание Limits и повтор после ошибки API ушли вместе с остановками: это восстановление после того же рода сбоев, которые
  проверяют Fault scenario-и, а в «Stopping» и в таблице причин на них есть прямые ссылки.
- How it works: «Two stops», «The wait goes by the wall clock», «What counts as a refusal».
- Implementation: строки модулей `limits-wait.ts`, `turn-retry.ts`, `resume-at.ts`; строки test-ов `autopilot-resume-at`,
  `autopilot-limits`, `autopilot-limits-switch`, `autopilot-retry`, `autopilot-invariants` и пять `autopilot-faults-*`;
  блок **Fault scenarios** с правилами I1–I8, `faultRun()` и `test/e2e/autopilot-world.ts`.

На `autopilot.md` на месте перенесённых частей — по одной строке со ссылкой (раздел «Waits, stops and recovery» в Behaviour, абзац
в How it works, строки после таблиц Modules и Tests). Две ссылки «see below» / «the waits below» ведут теперь на новую страницу.
Разделы о запуске, очереди Epic-ов (Run all accepted, Add to queue, команды `epics …` и `accepted`), строке состояния, Auto-approval,
journal и Data flow остались на основной странице: Ticket worfy-autopilot-queue 19 дописывает их там.

**Размеры.** `autopilot.md` 635 строк, `autopilot-faults.md` 216; перевод 550 и 220. Пункт «каждая не больше примерно 400 строк» для
`autopilot.md` не выполнен: чтобы дойти до 400, нужно вынести ещё около 235 строк, а остального о сбоях и восстановлении на странице
нет. Кандидаты на следующее деление — Auto-approval (Behaviour, строки test-ов `auto-approve-*`) и запуск run-а из чата с
`autopilot_start`; это деление другого содержания, вне этого Ticket-а. Решать владельцу: новый Ticket или принять 635 строк (на `main`
уже есть страницы на 505 и 592 строки).

**Перевод.** `docs/features/ru/autopilot-faults.md` переведён заново с новой английской страницы (шапка `same-pr`): русские разделы
отставали — не было «Повтор после ошибки API», `vendor-quota`, части о Codex и о Ticket-ах после `session-error`. Из
`docs/features/ru/autopilot.md` ушли те же части; его шапка `19f1660c` не менялась, отставание считается как раньше.

**Ссылки.** `sessions.md` (повтор после ошибки API), `run-planning.md` и его перевод (ожидание сброса Limits),
`docs/lessons/testing.md` (правила I1–I8) ведут на новую страницу. В `docs/features/ru/vendors.md` ссылка `#during-a-run` вела
в пустоту и раньше (русский заголовок — «Во время run-а»): исправлена, а шапка `same-pr` заменена на `bf3d30a4`, иначе правка
спрятала бы отставание перевода на 2 commit-а. Ссылки из кода, `CONTEXT.md`, `README.md` и Guide на разделы `autopilot.md` нет;
`src/renderer/guide/topics/autopilot/topic.json` называет источником только `autopilot.md`, `scripts/guide-lag.mjs` покажет Topic
отстающим от страницы (так задумано: не ломает PR).

**Решения без владельца:** имя страницы `autopilot-faults.md` и заголовок «Autopilot faults and recovery»; перенос ожидания Limits и
повтора после ошибки API вместе с остановками; исправление русской ссылки в `vendors.md`.
