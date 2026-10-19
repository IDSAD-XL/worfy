# 34 — Flaky test-ы gate full 2026-10-18/19: harness-evals PATH, install-stable, family.spec, terminal, first-run-windows

Type: task
Status: open
Blocked by: —
Source: заметки оркестратора на Mac 2026-10-18/19 — gate full PR #496, #501, #522, #530, #533, #539 и
gate fast Implementer-а worfy-canvas 07. Каждый test ниже упал под нагрузкой и был зелёным отдельно.
Строки перечитаны по main `2af91b51`.

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
  looks at the build» — 1 раз.** `test/unit/install-stable.test.ts:539` (twin Windows — `:782`). Gate full
  PR #530, 2026-10-19 ~18:10: шла настоящая Stable copy и assist-процесс, параллельно работали агенты.
  Скрипт не увидел stand-in и пошёл к `WORFY_STABLE_PREBUILT`. Отдельно — 3 из 3 зелёные. Причина по
  чтению кода: stand-in (`/bin/sleep`, скопированный в `Contents/MacOS/worfy`, `:542-545`) запускается
  `spawn`, test ждёт только событие `spawn` (`:548-551`), а скрипт ищет программу через
  `ps -axo pid=,command=` (`scripts/install-stable.mjs:327`). Событие `spawn` не значит, что `ps` уже видит
  процесс с новым `command`; ожидания этого нет.
- **e2e `family.spec.ts` — 1 раз.** `test/e2e/family.spec.ts:98` (test начинается здесь; `:101` —
  подготовка fixture). Gate full PR #539 на Mac, 2026-10-19; отдельно — зелёный. Test ждёт
  `canvasReady` обоих окон (`:132`, `:135`), `expectOpacities` с опросом 20 s (`:80-82`) и
  `expect.poll(allOnCanvas)` (`:177`) с пределом по умолчанию 5 s (`playwright.config.ts` не задаёт
  `expect.timeout`). Какая проверка упала — не известно: текст ошибки потерян (gate хранит хвост вывода,
  [worfy-harness 53](../../worfy-harness/issues/53-gate-full-теряет-текст-ошибки-e2e.md)).
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

## Что делаем

Для каждого test-а — сначала причина, потом правка. Поднять предел — только если замер показал, что
работа честно столько длится, и с комментарием, откуда число.

1. **harness-evals PATH.** Замер шагов `eval-harness.mjs` в этом test-е (время каждого `spawnSync`) без
   нагрузки и под нагрузкой способа Ticket-а 30. Убрать медленный шаг из этого test-а (например, общий
   scaffold на `describe`) или дать test-у свой предел по замеру.
2. **install-stable.** Перед `run()` ждать, пока `ps -axo pid=,command=` покажет pid stand-in-а с новым
   путём (опрос с пределом), — тогда test проверяет скрипт, а не гонку с `ps`. То же — у Windows twin-а,
   если там тот же способ.
3. **family.spec.** Сначала получить текст ошибки (после worfy-harness 53 или прогоном под нагрузкой с
   сохранением `test-results`), потом правка ожидания.
4. **terminal `open starts $SHELL -l`.** Замер времени до первого вывода на beta.15 и на main до PR #498
   (N ≥ 10 под нагрузкой); если стало медленнее — комментарий в Ticket-е worfy-windows 60 (возврат на
   стабильный node-pty) и предел по замеру.
5. **harness-install.spec.ts:262.** Явный предел у `toHaveText` по замеру или ожидание состояния, от
   которого текст зависит.
6. **first-run-windows:285.** Предел test-а с запасом над внутренними 5000 ms.

## Готово, когда

- [ ] У каждого из шести test-ов в «Итог»: причина (по замеру или логу), правка, замер после.
- [ ] Замер способом Ticket-а 30 (два прогона `--project contract` разом под `yes > /dev/null` на половине
      ядер, N ≥ 6): `harness-evals.test.ts` и `install-stable.test.ts` — 0 красных.
- [ ] e2e `family.spec.ts` и `harness-install.spec.ts` — N ≥ 5 прогонов под той же нагрузкой, 0 красных.
- [ ] Мутант install-stable: без ожидания `ps` test под нагрузкой снова краснеет хотя бы раз из N (или
      «Итог» объясняет, почему гонку не воспроизвести).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка `[gate] зелено (full)`.

## Тесты

- Правятся сами test-ы; новых файлов не нужно.

## Где в коде

- `test/contract/harness-evals.test.ts` (`:32`, `:617-619`, `:810`), `scripts/eval-harness.mjs` — только читать
- `test/unit/install-stable.test.ts` (`:539-551`, `:782`), `scripts/install-stable.mjs` (`:327`) — только читать
- `test/e2e/family.spec.ts` (`:80-82`, `:98`, `:177`)
- `test/contract/terminal.test.ts` (`:63`)
- `test/e2e/harness-install.spec.ts` (`:262`, `:297`)
- `test/unit/first-run-windows.test.ts` (`:285-308`)

## Вне скоупа

- `wave-gate.test.sh` — Ticket 32. Stub-файлы под XprotectService — Ticket 30.
- Сохранение полного вывода gate full — worfy-harness 53.

## Итог

Заполняется при закрытии.
