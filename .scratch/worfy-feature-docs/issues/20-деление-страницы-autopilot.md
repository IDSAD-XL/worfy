# 20 — Деление страницы Autopilot: Fault scenarios и восстановление на своей странице

Type: task
Status: blocked
Blocked reason: делается после приёмки Epic-а worfy-faults (Ticket worfy-faults 08) — до неё страницу правят Ticket-ы того Epic-а (worfy-faults 09)
Waits: owner
Blocked by: —
Source: «Как устроено» [spec.md](../spec.md) (страница больше примерно 400 строк делится на две), решение владельца 2026-10-30, Q9; решение владельца 2026-11-05 (деление после приёмки worfy-faults); Epic [worfy-faults](../../worfy-faults/spec.md), Q6; [ADR-0088](../../../docs/adr/0088-feature-pages-in-english.md) (английский как основной язык Feature page)

## Что происходит

- `docs/features/autopilot.md` — 518 строк на `main` 16a0932d, перевод `docs/features/ru/autopilot.md` — 479. Правило
  Epic-а — больше примерно 400 строк делится на две.
- Страница выросла с Epic-ом worfy-faults: Ticket worfy-faults 07 дописал в `#### Tests` шесть строк test-ов сбоев и
  блок **Fault scenarios** (что такое Fault scenario, `checkRecovery`, правила I1–I8, `faultRun()` и
  `test/e2e/autopilot-world.ts`). Ticket worfy-faults 09 правит ту же страницу ещё раз.
- На разделы страницы ссылаются другие страницы: `#during-a-run` (4 ссылки), `#the-journal-file`,
  `#the-run-mode-the-start-window-and-the-budget`.

## Что делаем

1. Ждёт приёмки worfy-faults (Ticket 08): до неё страницу правят Ticket-ы того Epic-а. После приёмки Orchestrator
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
- [ ] Перевод обеих страниц в `docs/features/ru/` с шапкой.
- [ ] Индекс на обоих языках называет новую страницу; ни одна ссылка `docs/` на перенесённый раздел не ведёт в пустоту.
- [ ] `node scripts/check-feature-docs.mjs` и `pnpm lint` — exit 0; `ci-ok` зелёный. Gate full не нужен: код не меняется.
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
