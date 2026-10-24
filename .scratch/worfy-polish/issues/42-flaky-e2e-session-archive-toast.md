# 42 — Flaky e2e на Mac: `session-archive-toast.spec.ts:95` — Sessions в архиве, а toast нет

Type: task
Status: claimed 2026-10-24T01:35Z
Branch: worfy-polish/42
Blocked by: —
Source: gate full PR #816 на Mac 2026-10-23 (main `a371f5fe` + #816) и повторы того же вечера.

## Что происходит

- Test «with the default threshold the timer archives the finished Sessions as one batch; the toast tells
  how many, Undo brings them back…» (`test/e2e/session-archive-toast.spec.ts:95`) падает на
  `await expect(toast).toHaveCount(1)` (`:113`): `Expected: 1, Received: 0`. Перед этим проходят проверки,
  что OLD_A и OLD_B в архиве одной пачкой и их Node-ов на Canvas нет (`:104-109`). Значит, таймер архива
  сработал, а toast `archive-toast` не появился (или уже исчез).
- Замеры 2026-10-23 на Mac (load average 5–25, параллельно шли другие gate и тесты):
  - gate full дерева main + #816 — красный; тот же spec ×3 в этом дереве — 3 из 3 красные;
  - дерево main + #810 (без #816) — красный 1 из 1;
  - дерево main + #816 + #815 — зелёный 1 из 1; дерево main + #816 после `pnpm build` — зелёный, весь шаг
    e2e — 320 passed.
  - PR этих деревьев код archive и toast не трогают. Причина не установлена: зависит от времени, нагрузки
    или состояния сборки — не проверено.

## Что делаем

1. Причина: под той же нагрузкой записать, когда показан и когда снят toast (время относительно
   archive-пачки), и откуда пришла пачка — первый проход таймера после открытия окна или повтор.
2. Лечить причину. `timeout`-ы и `WAIT` не поднимать (правило владельца).

## Готово, когда

- [ ] Причина записана в «Итог» с замером.
- [ ] Spec `session-archive-toast.spec.ts` ×10 подряд под нагрузкой (`/tmp/worfy-e2e.lock`) — код 0.
- [ ] gate full на Mac — код 0.

## Где в коде

- `test/e2e/session-archive-toast.spec.ts:95-115`.
- Toast архива: `src/renderer/canvas/archive-toast.ts` (подписка и запрос пропущенной пачки).
- Таймер и объявление пачки: `src/main/layout/archive.ts` (`announceBatch`, `recentBatches`), канал —
  `src/shared/ipc/layout.ts` (`layout.recentBatches`), обработчик — `src/main/ipc/layout.ts`.
- Test-ы: `test/unit/archive-toast.test.tsx`, `test/contract/layout-archive.test.ts`,
  `test/unit/link-access.test.ts` (канал `read`).

## Итог

**Причина.** Пачку архива делает не окно, а сам main: при создании первого окна `Orchestrators.begin`
читает Layout активного Project-а (`LayoutStore.get`), это первое чтение запускает прогон архива
(`onFirstRead`), и его `layout.archived` уходит в окно, страница которого ещё не подписалась.
Electron отбрасывает IPC-сообщение, у которого в странице нет слушателя, — toast не появляется.
Чтение по `timeout`, стабильность сборки и время жизни toast-а ни при чём: toast `action` живёт до
закрытия, и в упавших прогонах `showBatch` в renderer-е не вызывался вовсе.

**Замер 2026-10-24** (временный журнал времени в main и renderer, в коммит не вошёл; 40 процессов
`yes` на 18 ядрах, load average 32–48, `--workers=8`, spec ×24): 3 из 24 красные; во всех трёх
пачка ушла раньше подписки страницы (на 49–86 мс раньше `did-navigate` в двух, на 53 мс раньше
подписки в третьем), и `showBatch` не было. В зелёных прогонах пачка шла на 41–516 мс позже
навигации и доходила. При 3 workers и той же нагрузке — 25 из 25 зелёные: запас 30–200 мс,
поэтому падение редкое и зависит от того, насколько медленно стартует renderer.

**Исправление.** main помнит последнюю пачку каждого Project-а 30 с (`RECENT_BATCH_MS`, как
`PENDING_OPEN_MS` у уведомлений); новый канал `layout.recentBatches` (`project`, `read`) отдаёт те,
что ещё в архиве. Окно спрашивает один раз сразу после подписки; пачка, пришедшая и событием, и
ответом, показывается один раз, а более старая из ответа не заменяет новую. Timeout-ы не менялись.

**Проверка.** С исправлением и журналом: ×24 при `--workers=8` под той же нагрузкой — 24 из 24
зелёные, в 4 прогонах пачка ушла раньше подписки и toast пришёл из ответа (3) или событием (1).
Без журнала: `pnpm test:e2e` spec ×10 под нагрузкой (load average 20–63) — код 0, 10 passed; ×24 при
`--workers=8` — 24 passed. gate full — за Orchestrator-ом.

