# 26 — Wait `background-tasks` считается только там, где не идёт работа Run

Type: task
Status: open
Blocked by: 13
Source: [spec.md](../spec.md), «Модель» («Wait, блокировка, повтор»; «Собственное время и итог»), «Ticket-ы» (26); решение 03, Q5 ([03-модель-spans.md](03-модель-spans.md)): Wait — время, когда работа стоит по внешней причине; «Итог» Ticket-а 13 ([13-факты-из-journal.md](13-факты-из-journal.md)), ограничение Wait-ов `background-tasks`. Правило принял Orchestrator без владельца (ночь 2026-11-01), владелец подтверждает утром: изменение маленькое и обратимое.

## Что происходит

- Reader Journal (Ticket 13, `src/shared/flight-recorder/from-journal.ts`) отдаёт Wait `background-tasks` на каждый
  отрезок, когда у Session Orchestrator-а живы background tasks (строки `background-tasks` в Journal).
- Эти background tasks — сами implementer-ы, verifier-ы и scripts gate Orchestrator-а: Wait покрывает их собственную
  работу. На fixture ночного Run — 13 Wait-ов, 15 808 с, 0,915 Run.
- Итог (`summarize`, `src/shared/flight-recorder/summary.ts`) суммирует Wait-ы по причинам целиком: блок «Waits by
  cause» скажет «ждали background tasks» почти о каждом настоящем Run, хотя работа шла.
- Решение 03, Q5: Wait — время, когда работа стоит по внешней причине. Пока идёт агент, gate run, CI run или script
  Run-а, работа не стоит.

## Что делаем

1. Wait `background-tasks` в итоге считается только за время, когда не идёт ни один span работы Run (виды `agent`,
   `ci`, `gate`, `script`; где бы он ни висел — в Stage или на Run). Пересечения работ — объединением, не суммой.
   Работа с потерянным источником реальных времён не имеет и не вычитается.
2. Решить, где правило: span Wait режется на части без работы (на шкале видны разрывы) или остаётся целым, а
   вычитает только итог. Выбор и довод — в «Итог».
3. Остальные причины (`limits`, `limits-budget`, `gate-queue`, `other-machine`) не меняются: считаются целиком.
4. Экспортируемое API `spans.ts` и `summary.ts` не меняется (его читает Ticket 17); readers (`from-*.ts`) и контракт
   `facts.ts` не трогаются.

Не входит: Wait-ы других причин, ходы Orchestrator-а как работа, новые поля фактов.

## Готово, когда

- [ ] Unit test на fixture ночного Run: Journal, транскрипты, логи gate и ответы `gh` → `buildTimeline` →
      `summarize`; доля `background-tasks` падает с 0,915 до времени без работы (число в test-е и в «Итог»).
- [ ] Unit test-ы-литералы: работа покрывает Wait целиком (0), работы нет (Wait целиком), частичное пересечение, две
      пересекающиеся работы (объединение, не сумма).
- [ ] Unit test: Wait-ы `limits`, `limits-budget`, `gate-queue`, `other-machine` под работой считаются целиком.
- [ ] Test baseline Ticket-а 13 («pins the raw background-tasks Waits of the night Run») не меняется и зелёный.
- [ ] Каждое новое поведение красное на своём мутанте.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/flight-recorder-summary-waits.test.ts` (новый): литералы и fixture ночного Run.
- Сначала падающий: Wait 10:30–11:30, агент 11:00–12:00 — итог 30 мин, а не 60.
- Прогнать `test/unit/flight-recorder-*.test.ts`, `test/contract/flight-recorder*.test.ts`,
  `test/unit/critical-path.test.ts`.

## Где в коде

- `src/shared/flight-recorder/summary.ts`
- `src/shared/flight-recorder/spans.ts` — если правило окажется там
- `test/unit/flight-recorder-summary-waits.test.ts` (новый)
- `.scratch/worfy-flight-recorder/spec.md` — строка Ticket-а 26 в списке «Ticket-ы»
- `.scratch/worfy-flight-recorder/issues/25-приёмка-с-владельцем.md` — `Blocked by`

Только читать: `src/shared/flight-recorder/from-journal.ts`, `facts.ts`, `src/main/flight-recorder/` (Ticket 17
строится параллельно), `test/fixtures/flight-recorder/night-run/`.
