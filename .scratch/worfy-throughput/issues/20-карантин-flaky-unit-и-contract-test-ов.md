# 20 — Карантин flaky unit- и contract-test-ов: запись с владельцем и датой выхода, блокирующие run-ы их пропускают

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», решения 2 и 3; открытые вопросы
Ticket-ов [11](11-pr-вливается-по-задетым-test-ам-полный-набор-на-main.md)
и [12](12-ci-на-linux-на-каждый-pr-shard-ами.md) «flaky test: чинить или карантин»; flaky test-ы gate full на
Mac 2026-10-27 и разбор run-ов «Windows tests» с 2026-10-18.

## Что происходит

- Механизма карантина нет: ни в `harness/hooks/gate.mjs`, ни в конфигурации test-ов. Playwright без повторов
  нарочно (`playwright.config.ts:17`).
- Под нагрузкой (load average 30–60 от параллельных агентов) краснеют test-ы, не связанные с PR: на Mac 2026-10-27
  — `test/unit/canvas.test.tsx` (`collectNodeTypes`, `:48`, jsdom 5 s), `test/unit/session-node-drop.test.tsx`,
  `test/contract/login-shell-capture.test.ts`; на Windows-runner-е — `test/contract/claude-home-registry.test.ts`
  (watcher, 3 run-а), `test/contract/link-access.test.ts` (порядок вывода ConPTY, 3 run-а),
  `test/contract/workflow-reader.test.ts` (предел времени), `test/contract/workflow-branches-handles.test.ts`
  (`rmdir` EBUSY). Каждый такой красный — повтор gate full (около 12 min) или ручной разбор.
- `vitest.config.ts`, `package.json`, setup-файлы test-ов и `test/**/terminal*` — в `PC_ONLY`
  (`scripts/windows-verdict-scope.mjs:41,86,97`): их правка сделала бы PR `pc`, а ПК на паузе.

Правка 2026-10-28 (решение 0 spec-а, «Переходим на CI раннеры»): карантин нужен ещё больше: блокирующие run-ы теперь — job-ы `ci-ok` на трёх ОС
(Ticket 35), и flaky test без записи краснит merge каждого PR. Платформа записи `platforms` относится и к
runner-у этой ОС; helper работает без правки workflow-ов (без `WORFY_QUARANTINE` test пропускается).

## Что делаем

1. `test/quarantine/<id>.json` — одна запись на test (отдельные файлы, чтобы Ticket-ы, которые чинят разные
   test-ы, не правили один файл): `file`, `test` (полное имя, как печатает vitest), `platforms`
   (`darwin` / `win32` / `linux`), `reason`, `owner` (Ticket, который чинит: `worfy-throughput 22`,
   `worfy-throughput 23`, `worfy-polish 41`), `since`, `until` (не позже `since` + 14 дней).
2. `test/quarantine.ts` — helper, который test-файл вызывает вместо `it`/`test` для записи в карантине
   (`quarantined(it)('имя', …)` или похожий вызов — форма на выбор исполнителя). Без `WORFY_QUARANTINE`
   test пропускается с пометкой `skip (quarantine: <owner>, until <дата>)`; `WORFY_QUARANTINE=only` — идут
   только test-ы карантина; `WORFY_QUARANTINE=run` — идут все.
   Просроченная запись (сегодня позже `until`) снова краснит: helper больше не пропускает этот test, он идёт в
   каждом блокирующем run-е, а `quarantine.test.ts` красный с именем записи — починить или продлить словом
   владельца. Автоматического повтора упавшего test-а нет ни в одном run-е (решение владельца 2026-10-28).
3. Пометить test-ы из «Что происходит» (Mac — `darwin`, Windows — `win32`). `vitest.config.ts`,
   `package.json` и setup-файлы не трогать; e2e — Ticket 34.
4. `test/unit/quarantine.test.ts`: запись без `owner` или `until`, `until` дальше 14 дней от `since`,
   просроченная запись, запись на test, которого нет в файле, больше 15 записей — красный test с причиной.

Нужен ПК: нет. Трогает Harness: нет (одна строка в `rules.md` Profile-а — шаг Orchestrator-а после merge; слово
владельца дано 2026-10-28, решение 1). Вердикт Windows: runner `full`.

## Готово, когда

- [ ] `pnpm test` на Mac пропускает test-ы карантина `darwin` и печатает их как skip с владельцем; без
      записи тот же test идёт.
- [ ] `WORFY_QUARANTINE=only pnpm test` гоняет только их; код выхода — в «Итог».
- [ ] `test/unit/quarantine.test.ts` краснеет на каждой ошибке записи из пункта 4 (фикстуры) и на
      просроченной дате (время — через подставные часы, не системные); test с просроченной записью helper
      не пропускает (фикстура).
- [ ] `node scripts/windows-verdict-scope.mjs origin/main HEAD` на ветке — `runner` (код 0): PR не ждёт ПК.
- [ ] Записи в карантине — список в «Итог» с владельцем и датой выхода каждой.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; вердикт Windows — runner `full` на head; условие merge —
      `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).

## Где в коде

- `test/quarantine.ts`, `test/quarantine/*.json`, `test/unit/quarantine.test.ts` — новые
- Пометки: `test/unit/canvas.test.tsx`, `test/unit/session-node-drop.test.tsx`,
  `test/contract/login-shell-capture.test.ts`, `test/contract/claude-home-registry.test.ts`,
  `test/contract/link-access.test.ts`, `test/contract/workflow-reader.test.ts`,
  `test/contract/workflow-branches-handles.test.ts`
- Только читать: `scripts/windows-verdict-scope.mjs`, `vitest.config.ts`

Вне репозитория (Orchestrator после merge; слово владельца дано 2026-10-28): строка в `rules.md` Profile-а worfy — «test в
карантине не краснит gate; новый flaky — запись с владельцем и датой, а не повтор gate full».

## Вне скоупа

- Починка самих test-ов — 22, 23, `worfy-polish` 41.
- `test/contract/terminal.test.ts` — файл `PC_ONLY`; остаётся в `worfy-polish` 41.
- Карантин e2e и shell test-ов Harness — 34 и `worfy-polish` 41.

## Итог
