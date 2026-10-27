# 22 — Flaky test-ы Mac под нагрузкой: `collectNodeTypes`, `session-node-drop`, `login-shell-capture` — причина и правка

Type: task
Status: open
Blocked by: 20
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», предложение 3; gate full на Mac
2026-10-27 — красные под load average 30–60
от параллельных агентов; запись карантина Ticket-а 20 называет этот Ticket владельцем.

## Что происходит

- `test/unit/canvas.test.tsx:48` (`collectNodeTypes`): динамический import модуля узлов в jsdom дольше 5 s под
  нагрузкой.
- `test/unit/session-node-drop.test.tsx` и `test/contract/login-shell-capture.test.ts` — красные в gate full
  2026-10-27, зелёные в повторе.
- Правило Profile-а: timeout одного test-а не поднимать; лечить причиной (stub вместо настоящего процесса,
  ожидание условия вместо отсчёта по часам, окружение).

Правка 2026-10-28 (решение 0 spec-а, «Переходим на CI раннеры»): кроме Mac под нагрузкой, повторы — и на macOS-runner-е `ci-ok`
(Ticket 35): test, красный там, мешает merge каждого PR.

## Что делаем

1. Для каждого — повтор под нагрузкой, как в gate full (полный `pnpm test` рядом с другим gate), и в тишине;
   сколько раз красный из скольких.
2. Причина и правка причины. Для `collectNodeTypes` — проверить, что дорогой import не повторяется в каждом
   test-е и не тянет весь renderer.
3. Снять запись карантина (`test/quarantine/<id>.json`) каждого починенного test-а.

Нужен ПК: нет. Трогает Harness: нет. Вердикт Windows: runner `full`, если правка трогает `src/`.

## Готово, когда

- [ ] «Итог»: на каждый test — красных до правки (из N повторов под нагрузкой), причина, правка.
- [ ] Каждый test зелёный в 10 повторах под нагрузкой (`pnpm test <файл>` параллельно с полным `pnpm test`);
      команда и коды выхода — в «Итог».
- [ ] Записей карантина этого Ticket-а не осталось; timeout-ы test-ов не изменены (diff это показывает).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).

## Где в коде

- `test/unit/canvas.test.tsx`, `test/unit/session-node-drop.test.tsx`, `test/contract/login-shell-capture.test.ts`
- `test/quarantine/` — записи этих трёх test-ов
- `src/` — по найденной причине (дописать при claim)

## Вне скоупа

- `test/e2e/quiet-windows.spec.ts` (проверка Dock) — файл `PC_ONLY`, Ticket 34.
- `harness/bin/tests/wave-gate-lock.test.sh`, DST case — PR #867.

## Итог
