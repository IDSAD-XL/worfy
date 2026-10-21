# 34 — Flaky test-ы gate full 2026-10-18/19: harness-evals PATH, install-stable, family.spec, terminal, first-run-windows

Type: task
Status: open
Blocked by: —
Source: заметки оркестратора на Mac 2026-10-18/19 — gate full PR #496, #501, #522, #530, #533, #539 и
gate fast Implementer-а worfy-canvas 07. Каждый test ниже упал под нагрузкой и был зелёным отдельно.
Строки перечитаны по main `2af91b51`. Дополнено 2026-10-20: gate full PR #550 (прогоны 1 и 2) и gate fast
Implementer-а worfy-canvas 02; строки новых случаев — по main `a035a9aa`.

## Что происходит

[30](30-contract-test-ы-краснят-gate-full-чужих-pr-под-нагрузкой.md) лечит одну причину timeout-ов под
нагрузкой — новые исполняемые файлы, которые macOS проверяет по одному (XprotectService);
[32](32-wave-gate-test-sh-дольше-предела-harness-scripts-под-нагрузкой.md) — `wave-gate.test.sh`
(его падение `Killed` 2026-10-19 записано там). Test-ов ниже нет ни в одном Ticket-е:

- **`harness-evals.test.ts` «keeps other Harness copies off the PATH of the run» — 3 раза.**
  `test/contract/harness-evals.test.ts:810`. Timeout 15 s проекта contract (45 s на Windows,
  `vitest.config.ts:58`), своего предела нет. Test делает один `spawnSync` `node scripts/eval-harness.mjs`
  (`evalHarness`, `:617-619`, свой предел 60 s — `SCAFFOLD_TIMEOUT_MS`, `:32`). Падения:
  gate full PR #522 (2026-10-19 ~15:50, перегруженный fseventsd), gate full PR #533 (~19:00, load
  3,4–4, fseventsd в норме), gate fast Implementer-а worfy-canvas 07 (вечер, timeout на 24,9 s). Отдельно
  — 2 из 2 зелёные. Какие шаги `eval-harness.mjs` идут в этом случае и сколько они длятся — не замерено.
- **`install-stable.test.ts` «off Windows > refuses while a program of the copy is running — before it
  looks at the build» — 2 раза.** `test/unit/install-stable.test.ts:539` (twin Windows — `:782`). Gate full
  PR #530, 2026-10-19 ~18:10: шла настоящая Stable copy и assist-процесс, параллельно работали агенты.
  Скрипт не увидел stand-in и пошёл к `WORFY_STABLE_PREBUILT`. Отдельно — 3 из 3 зелёные. Второй раз — gate
  full PR #550, прогон 1, 2026-10-20 ~02:10, load 11–13 (четыре Implementer-а и ревьюеры); отдельно — 5 из 5
  зелёные. Причина по
  чтению кода: stand-in (`/bin/sleep`, скопированный в `Contents/MacOS/worfy`, `:542-545`) запускается
  `spawn`, test ждёт только событие `spawn` (`:548-551`), а скрипт ищет программу через
  `ps -axo pid=,command=` (`scripts/install-stable.mjs:327`). Событие `spawn` не значит, что `ps` уже видит
  процесс с новым `command`; ожидания этого нет.
  **Поправка 2026-10-21 (ревью PR #646, подтвердил оркестратор):** причина не гонка с `ps`. macOS убивает
  простую копию `/bin/sleep` сигналом SIGKILL (exit 137): копия не проходит проверку подписи. Правка PR #646 —
  подписать копию ad hoc, только на darwin; п. 2 «Что делаем» (ожидание `ps`) этой причины не лечит.
- **e2e `family.spec.ts` — 1 раз; причина найдена и исправлена в PR #539.** `test/e2e/family.spec.ts:101`.
  Gate full PR #539 на Mac, 2026-10-19; отдельно — зелёный. Причина — системный курсор: если он
  стоит над окном test-а, macOS шлёт окну hover, и подсветка family меняется без участия test-а.
  В #539 test сначала ставит указатель Playwright в известную точку; после этого 20 из 20 зелёные
  под нагрузкой. Осталось: каждый e2e test с проверкой hover (особенно spec-и с двумя окнами,
  например `epic-columns.spec.ts`) должен так же ставить указатель перед проверкой — общий helper
  в `test/e2e/` и правило в README test-ов.
- **contract `terminal.test.ts` «open starts $SHELL -l … output comes back» — 2 раза на Mac.**
  `test/contract/terminal.test.ts:63` (только darwin), предел 15 s проекта. Gate full PR #501 на
  `0d1a6c1b` (main с node-pty beta.15, PR #498) и gate full PR #496 2026-10-19, прогон 1; отдельно — 6 из 6
  и 2 из 2 зелёные. Вопрос из заметки: не стал ли shell на macOS открываться медленнее с beta.15. На
  Windows этот test разбирает [worfy-windows 14](../../worfy-windows/issues/14-gate-full-на-windows.md).
- **e2e `harness-install.spec.ts:262` `toHaveText('Harness error: dependency install')` — 1 раз.** Gate
  full PR #496 прогон 2, пока параллельно собирался `pnpm install:stable`; отдельно 2 из 2 зелёные.
  Предел — 5 s по умолчанию (тот же вид на `:297`). Уже упомянут в 30 (`:96`) как кандидат; здесь —
  новый случай.
- **unit `first-run-windows.test.ts:285` — 1 раз.** Ревью PR #530 (тесты): 5 s timeout проекта node
  (×3 на Windows, `vitest.config.ts:38`) под нагрузкой; внутри test даёт зависшему инструменту 1500 ms и
  ждёт ответа меньше 5000 ms (`:301`, `:308`) — запас до предела test-а почти нулевой.
- **e2e `session-back.spec.ts:116` и `snapping.spec.ts:396` — по 1 разу, в одном прогоне.** Gate full PR #550,
  прогон 2, 2026-10-20 ~02:40, load 6–10. `snapping.spec.ts:396` («a group of 10 Notes and a Card dragged over
  250 Layout Nodes…»): рамка выделения взяла 6 Node из 11. Отдельно оба — 9 из 9 зелёные.
- **contract `node-pty.test.ts` «spawns echo in a pseudo-terminal…» — 1 раз.** `test/contract/node-pty.test.ts:14`,
  проверка `:24`: ожидали `'ok'`, получили `''`. Gate fast Implementer-а worfy-canvas 02, 2026-10-20, load около 7.

## Что делаем

Для каждого test-а — сначала причина, потом правка. Поднять предел — только если замер показал, что
работа честно столько длится, и с комментарием, откуда число.

1. **harness-evals PATH.** Замер шагов `eval-harness.mjs` в этом test-е (время каждого `spawnSync`) без
   нагрузки и под нагрузкой способа Ticket-а 30. Убрать медленный шаг из этого test-а (например, общий
   scaffold на `describe`) или дать test-у свой предел по замеру.
2. **install-stable.** Перед `run()` ждать, пока `ps -axo pid=,command=` покажет pid stand-in-а с новым
   путём (опрос с пределом), — тогда test проверяет скрипт, а не гонку с `ps`. То же — у Windows twin-а,
   если там тот же способ.
3. **hover в e2e.** Вынести постановку указателя из `family.spec.ts` в общий helper; пройти все spec-и
   с hover и вызвать его перед проверкой; записать правило в README test-ов.
4. **terminal `open starts $SHELL -l`.** Замер времени до первого вывода на beta.15 и на main до PR #498
   (N ≥ 10 под нагрузкой); если стало медленнее — комментарий в Ticket-е worfy-windows 60 (возврат на
   стабильный node-pty) и предел по замеру.
5. **harness-install.spec.ts:262.** Явный предел у `toHaveText` по замеру или ожидание состояния, от
   которого текст зависит.
6. **first-run-windows:285.** Предел test-а с запасом над внутренними 5000 ms.
7. **session-back.spec.ts:116 и snapping.spec.ts:396.** Причина по логу gate full #550 (прогон 2); для
   рамки выделения — проверить, не начинается ли drag до того, как все 11 Node нарисованы.
8. **node-pty.test.ts:14.** Пустой вывод при exit: проверить, не приходит ли `onExit` раньше последнего
   `onData` под нагрузкой; ждать вывод, а не только exit.

## Готово, когда

- [ ] У каждого из девяти test-ов в «Итог»: причина (по замеру или логу), правка, замер после.
- [ ] Замер способом Ticket-а 30 (два прогона `--project contract` разом под `yes > /dev/null` на половине
      ядер, N ≥ 6): `harness-evals.test.ts` и `install-stable.test.ts` — 0 красных.
- [ ] e2e `family.spec.ts` и `harness-install.spec.ts` — N ≥ 5 прогонов под той же нагрузкой, 0 красных.
- [ ] Постановка указателя Playwright — общий helper в `test/e2e/`; его вызывают все spec-и с проверкой
      hover; правило записано в README test-ов.
- [ ] Мутант install-stable: без ожидания `ps` test под нагрузкой снова краснеет хотя бы раз из N (или
      «Итог» объясняет, почему гонку не воспроизвести).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка `[gate] зелено (full)`.

## Тесты

- Правятся сами test-ы; новых файлов не нужно.

## Где в коде

- `test/contract/harness-evals.test.ts` (`:32`, `:617-619`, `:810`), `scripts/eval-harness.mjs` — только читать
- `test/unit/install-stable.test.ts` (`:539-551`, `:782`), `scripts/install-stable.mjs` (`:327`) — только читать
- `test/e2e/family.spec.ts` (`:80-82`, `:101`, `:177`)
- `test/contract/terminal.test.ts` (`:63`)
- `test/e2e/harness-install.spec.ts` (`:262`, `:297`)
- `test/unit/first-run-windows.test.ts` (`:285-308`)
- `test/e2e/session-back.spec.ts` (`:116`), `test/e2e/snapping.spec.ts` (`:396`)
- `test/contract/node-pty.test.ts` (`:14-24`)

## Вне скоупа

- `wave-gate.test.sh` — Ticket 32. Stub-файлы под XprotectService — Ticket 30.
- Сохранение полного вывода gate full — worfy-harness 53.

## Итог

Заполняется при закрытии.

- **`session-back.spec.ts:116` (2026-10-20, ветка `fix/session-back-flake`).** Причина — в продукте:
  `src/renderer/claude-home/subagents.ts`, `schedule()` спрашивал файлы Subagent-ов заново только по
  `claudeHome.changed` или пока сами файлы показывали работающего Subagent-а. У Session worfy, где
  Subagent виден только по live-событиям, файлы читались один раз до их появления; событие FSEvents о
  новом transcript-е под нагрузкой опоздало дольше 10 s (на снимке падения и sidebar «0 live» — не
  дошло и событие о `sessions/<pid>.json`), и строка rail оставалась disabled. Пользователь попадает
  в то же, когда Orchestrator idle, а Subagent работает в фоне: transcript родителя не меняется.
  Воспроизведение: мутант, который отбрасывает события transcript-ов в `registry.watch`, даёт ровно ту же
  ошибку на `:138`; с правкой тот же мутант — 2 из 2 зелёные. Правка: опрос (POLL_MS) идёт и пока
  дерево с live-событиями показывает работающего Subagent-а; останавливается, когда никто не работает.
  Unit test — `test/unit/subagent-trees.test.tsx`. После: e2e 5 из 5 и 5 из 5 под четырьмя `yes`.

