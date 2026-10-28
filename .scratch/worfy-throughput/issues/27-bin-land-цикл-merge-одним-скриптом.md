# 27 — `bin/land`: цикл merge одним скриптом в фоне — rebase, gate full, метки, merge, `ticket done`, batch CI

Type: task
Status: open
Blocked by: 35
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», предложения 3 и 4, решения 12 и 13;
скрипт Orchestrator-а `merge-once.sh`
(2026-10-26/27, вне репозитория), которым влиты #833–#860.

## Что происходит

- Profile worfy задаёт `workflow.merge_gate: "wave"` (`profile.json:67`), и `harness/bin/wave-gate` умеет
  `check` (набор под один gate full), `merge` (зелёный набор или его префикс) и `ci` (batch CI на `main`). Но
  Orchestrator вливал по одному своим `merge-once.sh`: wave-gate краснел typecheck-ом в дереве под `.git/`
  (Ticket 07), а меток и `ticket done` wave-gate не делает.
- После каждого merge Orchestrator сам, в своём контексте (около 295k token-ов на вызов): переносит метки
  `review` и `check/windows` на новый head (`bin/ticket mark`), ждёт `mergeable` (`UNKNOWN` → повтор),
  пишет комментарий «Pre-merge basis», `ticket done` и отдельный docs PR со статусом, запускает batch CI.
  Каждый шаг — вызов модели с полным контекстом.

Правка 2026-10-28 (решение 0 spec-а, «Переходим на CI раннеры»): основа `land` — check `ci-ok` на head каждого PR (Ticket 35), а не
локальный gate full. Шаг 1.1 ниже — ждать `ci-ok` на head после rebase; `wave-gate check` и `wave-gate merge`
— только если оценка Ticket-а 07 оставит `wave-gate` путём по умолчанию, иначе merge по одному PR. Цель —
скорость и стабильность пути до merge, а не экономия Mac.

## Что делаем

1. `harness/bin/land <state.json>` (Node, как остальные скрипты Harness, ADR-0055). Вход — тот же state file,
   что у `wave-gate`, плюс на каждый PR `epic`, `ticket`, `windows_verdict` (для scope `runner` — вывод
   `scripts/windows-run-verdict.mjs` Ticket-а 24 по автоматическому run-у на head; пока 24 не влит, поле пишет
   Orchestrator). Шаги, каждый пишется в state file сразу:
   1. `wave-gate check` (набор; набор из одного PR — путь `each`);
   2. метки `review` и `check/<name>` на новый head каждого PR, если rebase его сдвинул;
   3. `wave-gate merge`;
   4. на каждый влитый PR — `ticket done <epic> <NN> --pr <N>` в отдельном worktree docs-ветки, один docs PR
      на набор, его merge после `check-handoff` (команда `docs.handoff.check` Profile-а);
   5. `wave-gate ci` и, если в наборе был платформенный PR, dispatch `windows-full` на `main`
      (правило Profile-а).
2. Идёт в фоне; повторный запуск на том же файле продолжает с последнего записанного шага.
3. Вывод для Orchestrator-а — одна строка на PR (`#N merged <sha>` / `#N waits: <причина>`) и итоговая строка
   `LAND=<green|red|unverified>`; полный лог — в файл рядом со state file.
4. Раздел 4 skill-а `epic-wave`: «Gate before merge» с `merge_gate: "wave"` — одна команда `land` в фоне
   вместо ручных шагов. Решение владельца 2026-10-28 (решение 13): Orchestrator вливает PR **только** через
   `land` в фоне — ни своего `merge-once.sh`, ни ручного `gh pr merge`; ручной путь в skill-е остаётся
   описанием того, что делает скрипт, а не вторым путём.

Нужен ПК: нет. **Трогает Harness: да** — новый скрипт `harness/bin/land` и раздел 4 skill-а `epic-wave`; слово
владельца дано 2026-10-28 (решение 1). Вердикт Windows: runner `full` (скрипт Harness, ADR-0056, пункт 2).

## Готово, когда

- [ ] `harness/bin/tests/land.test.sh` на временном репозитории со stub-ами gate, `gh` и `ticket`: зелёный
      набор из двух PR — оба влиты, метки на новых head, `ticket done` для обоих в одном docs PR, batch CI
      запущен один раз; красный набор — влит только зелёный префикс, остальные `waits`; обрыв после merge
      первого PR и повторный запуск — второй влит, первый не повторён.
- [ ] Shell test: `mergeable` `UNKNOWN` — повтор до 6 раз через 10 s (подставной `sleep`), потом `waits`.
- [ ] Ни один шаг не вливает PR, если `wave-gate check` не `green` или gate вернул 3, 127 или код сигнала.
- [ ] Shell test-ы Harness — exit 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; вердикт Windows —
      runner `full`; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).
- [ ] (вручную, после обновления Stable copy) Одна настоящая Wave влита через `land`; число вызовов модели
      Orchestrator-а на merge до и после — по Ticket-у 19, в «Итог».
- [ ] `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md` (`:50`, `:678`, `:743`) и
      `harness/agents/implementer.md` (`:202`) называют условием merge `ci-ok`, а не gate full (расхождение из
      «Итог» Ticket-а 35).

## Где в коде

- `harness/bin/land`, `harness/bin/tests/land.test.sh` — новые
- `harness/skills/epic-wave/SKILL.md` — раздел 4 «Merge by policy», «Gate before merge» (около `:936-950`)
- `harness/README.md` — список скриптов
- Только читать: `harness/bin/wave-gate` (997 строк — не расширять), `harness/bin/ticket`,
  `harness/bin/tests/wave-gate-world.sh` (готовый stub-мир для test-ов)

## Вне скоупа

- Платформенный PR в наборе — Ticket 29.
- e2e по путям внутри gate full — Ticket 13.
- Свежий контекст Orchestrator-а — Ticket 28.

## Итог
