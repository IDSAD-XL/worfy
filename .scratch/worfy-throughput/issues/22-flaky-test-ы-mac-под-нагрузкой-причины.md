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

### `login-shell-capture` — «keeps nothing of what that process writes after the answer» (2026-10-28)

- **Как падал.** В логах gate full 2026-10-25 и 2026-10-27 (`~/.claude/worfy-harness/gate/state/logs/…/03-worfy_._test.log`)
  test красный одним и тем же: `expected null to be +0` на `expect(run.status, run.stderr).toBe(0)`, длительность
  20 013–20 035 ms. `status` равен `null`, когда `spawnSync` убил процесс по своему timeout-у 20 s: процесс test-а
  не успевал закончить.
- **Причина — в test-е, не в `src/`.** Фоновый процесс из `.profile` писал 100 MB через `head -c … /dev/zero | tr '\0' a`.
  `tr` на macOS пропускает около 40 MB/s: 100 MB шли 2,4–2,5 s из 2,8 s всего процесса (замер скриптом-копией
  test-а: `floodMs` 2286–2510). Это работа одного ядра. На Mac с load average 30–60 от параллельных run-ов она растягивалась
  за предел 20 s. Сам `captureLoginShellEnv` (`src/main/agent/env.ts:174-175`, после ответа данные отбрасываются)
  читает те же 100 MB без `tr` за 20–30 ms: в нём узкого места нет.
- **Правка.** Писатель — `head -c 100000000 /dev/zero` без `tr`: те же 100 MB, но NUL-байтами; capture отбрасывает
  их так же. Процесс test-а — 0,4 s вместо 2,8 s (`floodMs` 85–86), весь файл — 3,3 s вместо 6,7 s. Timeout-ы не
  менялись, sleep не добавлен. Запись `test/quarantine/login-shell-capture-late-writes.json` удалена, test снова
  объявлен через `it`.
- **Красных из 10.** Нагрузка — `yes > /dev/null` на половине ядер (9 из 18), каждая серия не дольше 110 s, а не
  параллельный полный `pnpm test`. До правки: в тишине 0 из 10, под нагрузкой 0 из 10. После: в тишине 0 из 10,
  под нагрузкой 0 из 10. Такая нагрузка (load average около 10) красного не воспроизвела; причина найдена по
  логам gate и по замеру времени `tr`. Команда каждого run-а:
  `WORFY_QUARANTINE=run node scripts/vitest-electron.mjs test/contract/login-shell-capture.test.ts`, коды выхода во
  всех 40 run-ах — 0.
- **Mutant.** В `src/main/agent/env.ts:175` `if (settled) return` заменён на `if (settled) { output += chunk; return }`
  (capture держит всё, что пришло после ответа). Test красный: `AssertionError: expected 185.401344 to be less than 50`,
  файл — exit 1 (1 failed, 15 passed). Файл восстановлен из копии, `cmp` — 0.
