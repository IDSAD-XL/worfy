# 66 — Flaky test-ы CI Linux и macOS за неделю

Type: bug
Status: claimed 2026-11-07T22:28Z
Blocked by: —
Source: история CI 2026-11-01…11-07 (`ci.yml`): все 414 завершённых run-ов `main` с 2026-11-01 и 305 из 617 run-ов PR
(с 2026-11-04 22:37). Остальные run-ы PR и job-ы 42 run-ов из этих 305 не прочитаны: GitHub ответил «API rate limit
exceeded» на чтение логов job-ов.

## Что происходит

Строки FLAKY (test упал, retry прошёл; `test/flaky.ts`) из логов job-ов `linux-tests`, `macos-tests`, `macos-e2e`,
`windows*`. Счёт — job-ы, в которых test был flaky; строка файла — по последнему появлению. Ниже — test-ы, flaky хотя бы
дважды, кроме тех, что принадлежат открытым Ticket-ам (в конце).

| Test | Платформа: job-ов | Всего (main, PR) | Первый … последний |
|---|---|---|---|
| `test/e2e/autopilot-faults.spec.ts:36` «the app killed with SIGKILL in the middle of a Wave…» | Windows 17, macOS 5 | 22 (10, 12) | 11-05 … 11-07 |
| `test/contract/codex-app-server.test.ts:304` «close() kills a fake that outlives its stdin…» | Windows 21 (+3 красных) | 21 (20, 1) | 11-03 … 11-07 |
| `test/e2e/trash-undo.spec.ts:116` «a deleted Card comes back from the Trash…» | Windows 12 | 12 (8, 4) | 11-01 … 11-06 |
| `test/contract/autopilot-faults-github.test.ts:156` «gh hangs the whole Run…» | Windows 10 | 10 (1, 9) | 11-05 … 11-07 |
| `test/contract/e3-sandbox.test.ts:1114` «two runs that find the same abandoned lock…» | Linux 8 | 8 (7, 1) | 11-02 … 11-06 |
| `test/e2e/autopilot-faults.spec.ts:115` «GitHub out of reach for the whole Run…» | macOS 8 | 8 (4, 4) | 11-05 … 11-06 |
| `test/e2e/session-history-tail.spec.ts:53` «a 40 MB transcript opens on its newest turns…» | macOS 5, Windows 2 | 7 (6, 1) | 11-01 … 11-06 |
| `test/e2e/packaged.spec.ts:998` «a second dev run over the same data folder…» | macOS 7 | 7 (4, 3) | 11-01 … 11-06 |
| `harness/bin/tests/wave-gate-heartbeat.test.sh` (через `harness-scripts-1.test.ts`) | macOS 4, Windows 3 | 7 (6, 1) | 11-03 … 11-06 |
| `harness/bin/tests/wave-gate-lock.test.sh` (через `harness-scripts-1.test.ts`) | Windows 6 | 6 (3, 3) | 11-04 … 11-06 |
| `test/contract/flight-recorder-gate-logs.test.ts:460` «writes nothing to the Harness home or the repository…» | macOS 5 | 5 (5, 0) | 11-01 … 11-07 |
| `test/contract/autopilot-limits.test.ts:1422` «a Limits wait begun while the Wave settles…» | macOS 5 (+ gate fast на Mac) | 5 (5, 0) | 11-02 … 11-06 |
| `test/e2e/autopilot-queue.spec.ts:128` «a run over two Epics…» | macOS 4, Windows 1 | 5 (2, 3) | 11-07 … 11-07 |
| `test/e2e/linked-machines.spec.ts:791` «A opens a Project of B…» | Windows 5 | 5 (4, 1) | 11-01 … 11-06 |
| `test/e2e/browser-mcp.spec.ts:406` «a service worker of another site…» | macOS 5 | 5 (4, 1) | 11-01 … 11-05 |
| `test/e2e/toast-placement.spec.ts:135` «an error toast that stays covers no control…» | macOS 4 | 4 (3, 1) | 11-01 … 11-06 |
| `test/e2e/card-api.spec.ts:89` «a Card keeps its own data…» | Windows 4 | 4 (4, 0) | 11-01 … 11-01 |
| `test/contract/cards-watch-links.test.ts:64` «reports a change of a file of a Card…» | Windows 3 | 3 (3, 0) | 11-01 … 11-01 |
| `test/e2e/palette-find.spec.ts:107` «⌘K goes to a Ticket…» | macOS 2, Windows 1 | 3 (1, 2) | 11-02 … 11-06 |
| `test/contract/cards-watch-edits.test.ts:91` «reaches the listeners of the store of Cards» | macOS 2 | 2 (2, 0) | 11-03 … 11-06 |
| `test/contract/autopilot-limits.test.ts:1236` «five_hour (stub Limits): Start window, budget on…» | macOS 2 | 2 (2, 0) | 11-03 … 11-06 |
| `test/e2e/browser-family.spec.ts:155`, `browser-focus.spec.ts:459`, `external-session.spec.ts:134` | macOS 2 каждый | по 2 | 11-03 … 11-07 |

Чужие, в этот Ticket не входят:

- `test/contract/autopilot-wait.test.ts` (строки 331, 477–515; Linux 13, macOS 4) — `worfy-polish` 65.
- `test/e2e/update-settings.spec.ts:98` (macOS 11, Windows 9) — `worfy-polish` 47, исправлен #1538
  (2026-11-06 23:11Z); после него в 66 run-ах `main` ни одного FLAKY.
- `test/e2e/browser-sleep.spec.ts:215`, `test/e2e/epic-frame.spec.ts:406`, `:1107`, `test/e2e/browser-profile.spec.ts:127`
  (macOS 6, Windows 1) — названы в `worfy-polish` 47.
- `test/e2e/evidence-capture.spec.ts:649`, `:755` (recordClip) — тема `worfy-polish` 60.
- Записи карантина (`test/quarantine/`) — `audit-code-2026-11-07` 03.

## Что делаем

1. Для каждого исправляемого test-а — сначала воспроизвести (цикл, задержка, параллельные копии), потом лечить причину:
   ожидание настоящего условия вместо отсчёта, без порядка между test-ами, свои временные папки и порты. Timeout-ы не
   подстраивать, новых записей карантина не заводить.
2. Исправить столько из таблицы, сколько воспроизводится; остальные — в «Итог» с тем, что известно.

Глубина review — `medium`. Не платформенный: правка только в test-ах, без путей и процессов ОС в коде приложения.

## Готово, когда

- [ ] Таблица flaky test-ов за 2026-11-01…11-07 в «Что происходит».
- [ ] Каждый исправленный test воспроизведён до правки и проходит после неё: счёт до и после в «Итог».
- [ ] Исправленные test-ы — 20 прогонов подряд зелёные; все unit и contract test-ы затронутых модулей, `pnpm lint`,
      `pnpm typecheck`, gate fast — exit 0.
- [ ] Не исправленные test-ы таблицы — в «Итог», с причиной или с тем, почему её не нашли.
- [ ] `ci-ok` зелёный на head PR.

## Где в коде

- `test/contract/codex-app-server.test.ts` — проверки выхода процесса после `close()`.
- `test/contract/autopilot-limits.test.ts:1447` — ожидание Start window.
- `src/main/agent/session/process.ts:96-110` (`waitForExit`), `src/main/vendors/codex/app-server.ts:154-173` (`close`),
  `src/main/autopilot/run.ts:2402-2404` — только чтение.

## Итог
