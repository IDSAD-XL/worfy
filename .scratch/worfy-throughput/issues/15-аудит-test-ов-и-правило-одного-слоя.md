# 15 — Аудит test-ов: дублирующие test-ы убираются только с доказательством покрытия; правило «test — в одном слое»

Type: task
Status: claimed 2026-10-28T22:24Z
Blocked by: 11, 12, 13
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-20: скорость test-ов», решение Q6.

## Что происходит

- 435 test-файлов: 224 в `test/unit`, 123 в `test/contract`, 88 в `test/e2e`; около 3260 unit, 2190
  contract и 290 e2e test case-ов. Рост — около 20 файлов в день.
- Одно поведение часто проверяется в двух или трёх слоях: unit test модуля, contract test скрипта, e2e
  окна. Правила, когда нужен второй слой, нет.
- Q6: удалять или сливать — только после Ticket-ов 11–13 и только с доказательством, что код остаётся
  покрыт.

## Что делаем

1. По отчёту Ticket-а 10 — самые дорогие файлы каждого слоя. Для каждого кандидата — пара «дорогой test /
   test, который проверяет то же поведение в другом слое».
2. Доказательство на каждую пару до удаления: coverage строк и ветвей модуля без удаляемого test-а не
   падает, или mutant, которого ловил удаляемый test, ловит оставшийся. Пары без доказательства не
   трогаются.
3. Правило для новых Ticket-ов в `harness/agents/implementer.md` и в `docs/lessons/testing.md`: test — в
   одном слое; второй слой — только с причиной в описании PR.
4. В «Итог» — сколько файлов и времени ушло, по слоям, по отчёту Ticket-а 10 до и после.

## Готово, когда

- [ ] Для каждого убранного или слитого test-а в «Итог» — пара, доказательство (coverage до и после или
      имя mutant-а) и команда с кодом выхода.
- [ ] Ни один модуль не теряет покрытие строк или ветвей: отчёт coverage до и после — в «Итог».
- [ ] Правило одного слоя — в `harness/agents/implementer.md`; `harness/bin/tests/agents-text.test.sh`
      проверяет фразу.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — шаг Orchestrator-а перед merge.

## Открытые вопросы

Решает владелец; исполнитель не выбирает сам.

- **Чем мерить покрытие.** `vitest --coverage` (провайдер v8) на unit и contract; e2e покрытия не даёт —
  для пары с e2e остаётся только mutant.
- **Порог.** Удалять, если время файла выше какого порога или в какой доле самых медленных.

## Где в коде

- `test/unit/`, `test/contract/`, `test/e2e/` — по списку пар в «Итог»
- `harness/agents/implementer.md`, `harness/bin/tests/agents-text.test.sh`
- `docs/lessons/testing.md`

## Вне скоупа

- Ускорение отдельных test-ов (замена `sleep` на ожидание состояния) — отдельные Ticket-ы по отчёту
  Ticket-а 10.
- Flaky test-ы — `worfy-polish` 30, 32, 34.

## Итог

PR #935, ветка `worfy-throughput/15`. Замер «до» — CI run 40770425114 на `main` (fc1aa483, 2026-10-28), «после» — CI run 40781823317 (head 030ec215, `ci-ok` pass) этого PR. Время по файлам — из логов job-ов (`gh run view --job <id> --log`), разбор скриптами в scratchpad.

### Что убрано или слито, с доказательством

| Что | Слой | Пара (что проверяет то же) | Доказательство | Команда, код выхода |
| --- | --- | --- | --- | --- |
| `no-overlap.spec.ts` «a Note dropped onto a Card goes next to it…» (10,5 s) | e2e | `test/contract/layout-store.test.ts:729` (место Note, Card стоит), `:655` (перезапуск main читает Layout), `test/e2e/snapping.spec.ts:197` (drop на Card в окне) | mutant `drop-not-corrected`: `src/main/layout/store.ts` `settle` возвращает `node` без `freePlace` — 7 test-ов layout-store красные | `mutant.sh … test/contract/layout-store.test.ts` → тесты exit 1, mutant убит |
| `no-overlap.spec.ts` «two neighbouring Notes dragged together…» (6,2 s) | e2e | `test/contract/layout-store.test.ts:799` (moveMany +100 px без поправки), `test/unit/history.test.ts:521` (⌘Z, ⇧⌘Z группы), `test/unit/canvas.test.tsx:285` (drag нескольких Node шлёт один moveMany) | mutant `group-corrected-off-itself`: `obstaclesFor(moved, new Set())` в `moveMany` — красные `layout-store.test.ts:799`, `history.test.ts:521`, `:934` | exit 1, убит |
| `no-overlap.spec.ts` «a saved Layout with two overlapping Nodes…» (5,8 s) | e2e | `test/contract/layout-store.test.ts:848` (B уходит с A, строка в log, второе чтение ничего не пишет) | mutant `saved-overlap-kept`: `src/main/layout/upgrade.ts` без `removeOverlaps` — красные `:848`, `:885` | exit 1, убит |
| `linked-reconnect.spec.ts` «Reconnect dials at once…» (39,6 s) | e2e | `test/contract/link-reconnect.test.ts:261`, `:314` (обе стороны, два настоящих Machine), `test/contract/link-dialing.test.ts:108` (IPC handler `link.reconnect`), `test/unit/machines-section.test.tsx:617` (кнопка) | mutant `reconnect-no-dial`: `src/main/link/connections.ts` `else this.dial(each)` → `else void 0` — 8 test-ов красные | exit 1, убит |
| `harness-evals.test.ts`: три test-а одного scaffold без `EVAL_*` на каждый из 10 кейсов → один test на кейс | contract | те же assert-ы, перенесены дословно в «builds its fixture…» | mutant `fixture-state-elsewhere`: `harness/evals/lib/demo-project.sh` пишет состояние в `worfy-harness-x` — 8 из 10 кейсов красные | `mutant.sh … -t 'builds its fixture'` → exit 1, убит |
| `free-place.test.ts` «compares at least 10 times fewer rectangle pairs…»: эталонный поиск не гоняется по всем 120 местам; число пар эталона — измеренная константа `PREVIOUS_PAIR_CHECKS`; сдвиг сверяется с эталоном на каждом 12-м месте | unit | test «gives the same shift on 1000 random layouts» того же файла сверяет оба поиска | coverage `src/shared/layout/free-place.ts` до и после одинаковый: Statements 279/304, Branches 117/137, Functions 42/45, Lines 224/240; mutant `up-side-drops-zero` (`dy >= 0` → `dy > 0`) ловит и укороченный test | `pnpm test test/unit/free-place.test.ts --coverage.enabled …` exit 0 до и после; mutant exit 1 |

Локально (Mac, `nice -n 10`): `free-place.test.ts` 28,6 s → 24,4 s под coverage (без coverage test эталона 18,2 s → 4,0 s под coverage).
Четыре e2e test-а — 62 s из 1685 s e2e на macOS в CI (оба shard-а).

### Удаление по правилу «упорный test»

Нет. Карантин (`test/quarantine/`) — две записи `demo-template` Ticket-а 23, не этого Ticket-а.

### Время по слоям в CI, до и после

| Слой, job | До (run 40770425114) | После (run 40781823317) |
| --- | --- | --- |
| macOS `macos-tests`: сумма времени файлов / Duration vitest | 1495 s / 864,7 s | 1459 s / 857,4 s |
| — `harness-evals.test.ts` | 91,5 s, 217 test-ов | 75,0 s, 193 test-а |
| — `free-place.test.ts` | 56,5 s | 24,2 s |
| Windows `full-suite` (3 shard-а): `harness-evals.test.ts` | 360,8 s | 293,7 s |
| — `free-place.test.ts` | 73,6 s | 49,9 s |
| Linux `linux-tests` (4 shard-а): сумма файлов | 1069 s | 1066 s |
| — `free-place.test.ts` | 68,9 s | 30,0 s |
| macOS e2e, оба shard-а: сумма test-ов | 1685 s, 337 test-ов | 1779 s, 333 test-а |
| — `linked-reconnect.spec.ts` | 51,7 s | 12,0 s |
| — `no-overlap.spec.ts` | 29,5 s | 4,5 s |
| macOS e2e, время shard-ов | 14,3 + 14,2 min | 16,0 + 14,1 min |

Выигрыш по тронутым файлам: unit и contract на macOS −49 s, на Windows −91 s, на Linux −40 s; e2e на macOS −65 s.
Суммы слоёв между двумя одиночными run-ами шумят сильнее выигрыша: e2e после стал на 94 s дольше при
четырёх test-ах меньше, Windows — на 367 s дольше за счёт других файлов. Сравнение по слою надёжно только
по медиане нескольких run-ов `main` после merge.

### Что ещё дорого и не тронуто (кандидаты дальше)

- Shell test-ы Harness через `harness-scripts.test.ts` — 1271 s суммарно по case-ам на macOS (до 5 одновременно): `gate-verdict` 106 s, `guard-silent` 104 s, `wave-gate-heartbeat` 78 s. Дублей с доказательством нет: строки атрибуции в `silent-mode.test.sh` и `guard-silent.test.sh` проверяют разные тексты вывода. Выигрыш — в fixed sleep-ах `guard-silent` (около 42 s) и в параллельном запуске bash/zsh в `wave-gate-heartbeat`, это ускорение test-ов, вне скоупа Ticket-а.
- `harness-migrate.test.ts` (53 s mac, 247 s Windows): sandbox с 12 вызовами git на каждый из 48 test-ов; общий sandbox мешают test-ы, которые пишут в него.
- `install-stable.test.ts` (76 s Windows): отказы можно проверять in-process через экспорт `installStable`.
- `autopilot.spec.ts:486` Force stop (18,8 s) повторяет contract `autopilot-background.test.ts:434`, но сторожит остановку процесса — не удалён.

### Правило одного слоя

`docs/lessons/testing.md` — урок «Поведение проверяется в одном слое». Правило в `harness/agents/implementer.md` и проверка фразы в `harness/bin/tests/agents-text.test.sh` (пункт 3 Ticket-а) не сделаны: PR #934 Ticket-а 27 правит те же два файла и ещё открыт. Это follow-up после его merge; пункт «Готово, когда» о них открыт.
