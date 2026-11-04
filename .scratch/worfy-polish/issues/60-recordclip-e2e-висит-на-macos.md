# 60 — E2e test `recordClip` висит на macOS, и job `macos-e2e` падает на teardown worker-а

Type: bug
Status: claimed 2026-11-04T23:03Z
Blocked by:
Source: CI PR-ов 2026-11-04, run-ы 41910321425 и 41925102507, job `macos-e2e (1/2)`; бриф Orchestrator-а
2026-11-05 (номер 60 выдан Orchestrator-ом, 59 занят остановленной WIP-веткой)

## Что происходит

`test/e2e/evidence-capture.spec.ts:503` — «recordClip: a frame of the sheet that cannot be taken is an error, and no
clip is kept». Его сценарий уничтожает единственный `BrowserWindow` приложения и ждёт 2 s. На runner-е macOS test
висит до своего timeout (3 min), на повторе проходит, а потом job падает с «Worker teardown timeout of 180000ms
exceeded» — ошибкой вне test-ов. На `main` этого не видно: там `macos-e2e` пропускается.

Trace упавшего run-а (artifact `e2e-results-0-1` run-а 41925102507): снимок кадра секунды 0
(`window.screenshot` в `underLimit`, `test/e2e/evidence-capture.ts`) начался одновременно с уничтожением окна и не
закончился никогда — ни результатом, ни ошибкой, хотя у него свой timeout 5 s. Helper ждёт цикл кадров (`await
framing`) без предела, до закрытия приложения (`launched.close()`) дело не доходит, Electron остаётся жить, и worker
Playwright не может завершиться.

## Что делаем

1. У каждого ожидания в `recordClip` — предел: кадр листа (свой timer поверх timeout-а Playwright), лист в скрытом
   окне (`contactSheet`), путь клипа (`video.path()`).
2. Ушедшее окно замечается сразу: событие `close` страницы и опрос main-процесса, жив ли `BrowserWindow` этого окна.
   Кадр, который не пришёл, — та же ошибка «a frame of the contact sheet failed», и helper не ждёт конца сценария.
3. Когда окна нет, helper всё равно закрывает приложение: `launched.close({ windowGone: true })` — без снимка окна,
   выход с коротким пределом, потом kill процесса, и kill здесь ожидаем, не провал test-а.
4. Смысл test-а 503 не меняется; timeout-ы не поднимаются, test не пропускается.

Глубина review — `medium`. Не платформенный: правка только в e2e helper-ах.

## Где в коде

- `test/e2e/evidence-capture.ts` — `recordClip`, `underLimit`, `contactSheet`.
- `test/e2e/helpers.ts` — `LaunchedApp.close` (параметр `windowGone`), `saveArtifacts`.
- `test/e2e/evidence-capture.spec.ts` — новый test: кадр, который не возвращается, и выход, который не кончается.

## Готово, когда

- [ ] Новый e2e test: снимок кадра, который никогда не завершается, после уничтожения окна, и `app.close()`, который
      не завершается, — ошибка «a frame of the contact sheet failed» за секунды, процесс приложения завершён, файлов
      нет. До правки — красный (висит до timeout-а).
  - evidence: test-run pass · `pnpm test:e2e test/e2e/evidence-capture.spec.ts -g "never comes back"` exit 0 · mac dev · 06267f07e35f27bf5462915dee11e528344c87bb
- [ ] Test 503 проходит за секунды; весь `test/e2e/evidence-capture.spec.ts` проходит 3 раза подряд без ошибки
      teardown-а; время до и после — в «Итог».
  - evidence: test-run pass · `pnpm test:e2e test/e2e/evidence-capture.spec.ts --retries=0` exit 0, three runs in a row · mac dev · 06267f07e35f27bf5462915dee11e528344c87bb
- [ ] `pnpm lint`, `pnpm typecheck`, unit и contract test-ы затронутых модулей, gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 06267f07e35f27bf5462915dee11e528344c87bb
- [ ] `ci-ok` PR-а зелёный, `macos-e2e (1/2)` — зелёный.
  - evidence: ci-check pass · PR 1395 run 41932530798: ci-ok pass, macos-e2e (1/2) pass, test 503 in 1.2 s · mac - · 06267f07e35f27bf5462915dee11e528344c87bb

## Итог

- **Где висло.** Trace упавшего test-а (artifact `e2e-results-0-1` run-а 41925102507): шаг «Screenshot» кадра
  секунды 0 начался вместе с уничтожением окна и не закончился — ни кадром, ни ошибкой, timeout 5 s Playwright не
  сработал. `underLimit` ждал цикл кадров без предела, `launched.close()` не вызывался, Electron жил дальше, и
  teardown worker-а ждал его ещё 180 s. Локально на Mac это не повторилось: 20 прогонов подряд, снимок на уничтоженном
  окне всегда падал за ~50 ms с «Target page, context or browser has been closed», а `app.close()` шёл ~30 ms.
- **Что сделано.** `test/e2e/evidence-capture.ts`: у каждого ожидания `recordClip` — предел. Кадр (`takeFrame`) —
  timeout Playwright и свой timer поверх (`FRAME_BOUND_MS`); пока кадр снимается, main раз в 250 ms спрашивают, жив
  ли `BrowserWindow` этого окна (id по URL страницы), и событие `close` страницы тоже обрывает ожидание. Лист в скрытом
  окне (`contactSheet`) и `video.path()` — тоже с пределом. Кадр, который не пришёл, обрывает ожидание сценария сразу
  и даёт ту же ошибку «recordClip: a frame of the contact sheet failed: …». Если кадр не пришёл потому, что окно
  закрыто или уничтожено, helper закрывает приложение через `launched.close({ windowGone: true })`; окно живое, но
  кадр упёрся в предел, — обычный `launched.close()` с диагностикой и ошибкой зависшего выхода.
- **Сценарий после отказа.** Когда helper бросил сценарий (кадр не пришёл или вышел лимит), сценарий идёт дальше: его
  вызовы к закрытому приложению сразу падают, а свои ожидания — нет. После закрытия приложения helper ждёт его ещё
  `SCENARIO_SETTLE_MS` (`ms(2_000)`). Сценарий, который ждёт дольше, продолжает идти в то, что worker делает дальше.
- **`test/e2e/helpers.ts`.** У `LaunchedApp.close` — параметр `windowGone`: снимка окна нет, выход ждут
  `GONE_QUIT_TIMEOUT_MS` (`ms(2_000)`), потом kill процесса, как и раньше через `endApp`; диагностики выхода и
  `expect.soft` о kill нет — kill здесь ожидаем. Без параметра всё как было.
- **Test-ы.** Test 503 не менялся. Первый новый test «a frame that never comes back once the window is gone…» подменяет
  `window.screenshot` на никогда не завершающийся, глушит событие `close` страницы (Playwright на CI его тоже не
  увидел) и подменяет `app.close` на никогда не завершающийся. Ждёт ошибку «…failed: Error: the window was destroyed»
  меньше чем за `ms(20_000)`, завершённый процесс приложения и ни одного файла. До правки — красный: «Test timeout of
  40000ms exceeded» (прогон с `--timeout=40000`). Второй новый test «a frame that never comes back from a window that
  is still there…» окно не уничтожает: main отвечает, что окно живо, а кадры (`scale: 'css'`) не возвращаются. Ждёт
  «…failed: Error: the screenshot did not finish within» меньше чем за `ms(15_000)` и завершённый процесс. Без
  `bounded` в `takeFrame` он красный: «Test timeout of 60000ms exceeded» (прогон с `--timeout=60000`).
- **Время, до и после.** До: на CI test 503 — 3.0 min до timeout-а, потом «Worker teardown timeout of 180000ms
  exceeded»; локально 2.7–5.7 s. После, на этом Mac (второй раунд): test 503 — 2.8–2.9 s (из них ~2 s — конец
  2-секундного ожидания его сценария), первый новый test — 7.1–7.2 s (6 s — предел выхода `ms(2_000)` при множителе 3),
  второй — 19.3–19.5 s (18 s — предел кадра `ms(6_000)`); весь `test/e2e/evidence-capture.spec.ts` три раза подряд —
  24 passed за 50.7 s, 50.0 s, 50.0 s, ни одной ошибки вне test-ов. На CI PR #1395 первого раунда (run 41932530798,
  `macos-e2e (1/2)`): test 503 — 1.2 s, первый новый test — 7.2 s, 226 passed, ни одной ошибки вне test-ов.

Решено без владельца:
- **Кадр, который не пришёл, обрывает сценарий.** Раньше helper ждал конца сценария и после ошибки кадра. Клипа всё
  равно не будет, а сценарий без окна только тянет время.
- **Короткий выход с kill — только когда окна нет.** Кадр, который упёрся в предел, а окно живо (медленный снимок на
  загруженном runner-е), ведёт к обычному закрытию: зависший выход тогда диагностируется и остаётся провалом test-а, а
  не тихим kill (поправка review второго раунда).
