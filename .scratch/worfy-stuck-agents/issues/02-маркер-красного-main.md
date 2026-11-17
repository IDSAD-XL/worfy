# 02 — Маркер красного main: `land` пишет `main-red-<key>.json`, worfy его читает

Type: task
Status: claimed 2026-11-17T03:56Z
Blocked by: none
Source: [spec.md](../spec.md), «Ticket-ы», 2; «Решения по реализации» → «Цикл и Run: продолжение, отложить, `main-red`»,
пункт «Красный main — маркер `land`»; «Риски» → «Маркер снят раньше времени» и «Устаревший маркер `main-red`»;
[critic 2026-11-17](../../../docs/product/critic/worfy-stuck-agents-2026-11-17.md), возражение 2

Кто: агент.

Платформенный PR (ADR-0056, пункт 2): меняется скрипт Harness `harness/bin/land` — до merge нужен вердикт Windows
(ADR-0071), job-ы `windows (harness-scripts …) / full-suite` в составе `ci-ok` на head PR. Глубина ревью — `medium`.

## Что происходит

- `land` уже читает push run-ы CI на main (`mainGreen`, `harness/bin/land:475–520`, worfy-throughput 64) и держит
  строку красного main в памяти (`mainRed`, `land:450–451`, печать — `:1226`). Файла, который мог бы прочитать worfy,
  нет.
- Пока повторяется красный push run (`attempt > 1`, run не завершён), `land` обнуляет `mainRed` и ждёт вердикта
  (`harness/bin/land:485–487`). main в это время всё ещё красный: повтор упавших job-ов — первый шаг при каждом красном
  main (`harness/skills/epic-wave/SKILL.md:1554`).
- worfy читает маркеры gate-а `red-<key>-<tag>` и `unverified-<key>-<tag>` в папке состояния gate-а
  (`src/main/gate/state.ts:1–25`, `markerOutcome` — `:135`). `key` — запись `<gate>/config.json`, чей `match` —
  самый длинный префикс корня репозитория (`harness/hooks/gate-resolve.mjs --which`).
- Свой `gh run list` Run-у нельзя: инвариант И2 разрешает только `pr list`, `auth status`, `auth token` и
  `api repos/<owner>/<repo>` (`test/autopilot-invariants.ts:122–132`).

## Что делаем

1. `land` после каждого чтения push run-ов main:
   - main красный → пишет `<gate>/state/main-red-<key>.json`: `sha`, `pr` (виновник или `null`), `since`, `url` run-а,
     `line` (строка `mainRed`), `at` (время записи);
   - повтор красного push run-а идёт (`attempt > 1`, не завершён) → файл не трогает: main всё ещё красный;
   - main не красный → удаляет файл, если он есть;
   - чтение не удалось (gh недоступен) → файл не трогает.
   Запись атомарная (временный файл и rename), как у других файлов состояния gate-а.
2. `src/main/gate/state.ts` — функция чтения маркера по корню репозитория Project-а: `null` без файла или при
   нечитаемом JSON, иначе поля файла. Ничего не пишет.
3. Английская страница `docs/features/gate-and-github.md`, абзац «Two kinds of record» о маркерах папки состояния
   (строки 123–124), называет новый маркер: кто пишет, кто читает, когда снимается.

## Готово, когда

- [ ] Shell test `harness/bin/tests/land.test.sh`: последний завершённый push-run main красный — `land` пишет
      `main-red-<key>.json` с sha, PR-виновником и URL run-а.
  - evidence: test-run pass · `pnpm test` exit 0 (harness/bin/tests/land.test.sh in harness-scripts-4) · mac - · ddea8f7d51c3ac32a71929ac864d13a7cc45151f
- [ ] Shell test: следующий запуск `land` видит зелёный main — файл удалён.
  - evidence: test-run pass · `pnpm test` exit 0 (harness/bin/tests/land.test.sh in harness-scripts-4) · mac - · ddea8f7d51c3ac32a71929ac864d13a7cc45151f
- [ ] Shell test: gh не ответил — файл, который был, остался.
  - evidence: test-run pass · `pnpm test` exit 0 (harness/bin/tests/land.test.sh in harness-scripts-4) · mac - · ddea8f7d51c3ac32a71929ac864d13a7cc45151f
- [ ] Shell test: маркер есть, новейший push run main не завершён и идёт с `attempt: 2` — файл остался; после зелёного
      вердикта этого run-а — удалён.
  - evidence: test-run pass · `pnpm test` exit 0 (harness/bin/tests/land.test.sh in harness-scripts-4) · mac - · ddea8f7d51c3ac32a71929ac864d13a7cc45151f
- [ ] Unit test `test/unit/gate-state.test.ts`: маркер есть — поля прочитаны; нет файла или битый JSON — `null`; чтение
      ничего не пишет в папку состояния.
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/gate-state.test.ts) · mac - · ddea8f7d51c3ac32a71929ac864d13a7cc45151f
- [ ] `docs/features/gate-and-github.md` называет маркер `main-red-<key>.json`, его писателя и читателя и когда он
      снимается.
  - evidence: commit pass · land writes the main-red marker main-red-<key>.json; worfy reads it (worfy-stuck-agents 02) · - - · ddea8f7d51c3ac32a71929ac864d13a7cc45151f
- [ ] Платформенный PR (ADR-0056, пункт 2; ADR-0071): вердикт Windows до merge.
- [ ] Все `harness/bin/tests/*.test.sh` зелёные; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на
      head PR.

## Тесты

- `harness/bin/tests/land.test.sh`, `test/unit/gate-state.test.ts` — пункты выше, каждый test сначала красный.

## Где в коде

- `harness/bin/land`
- `harness/bin/tests/land.test.sh`
- `src/main/gate/state.ts`
- `test/unit/gate-state.test.ts`
- `docs/features/gate-and-github.md`

Только читать: `harness/hooks/gate-resolve.mjs`, `harness/hooks/gate-paths.mjs`, `harness/skills/epic-wave/SKILL.md`
(раздел «A red push run on the main branch»).

## Вне скоупа

- Чтение маркера Run-ом и остановка `main-red` — Ticket 05.
- Красный main на ПК (issue `pc-main-red`, ADR-0086) — своё правило, не меняется.
