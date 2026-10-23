# 42 — Flaky e2e на Mac: `session-archive-toast.spec.ts:95` — Sessions в архиве, а toast нет

Type: task
Status: open
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
- Toast архива и таймер — найти при claim и дописать сюда.

## Итог
