# 18 — Окно не показывается в e2e при 3 worker-ах: fallback show, диагностика timeout-а и switch-и отрисовки для всех e2e-запусков

Type: bug
Status: done 2026-10-21T06:17Z
PR: #661
Branch: worfy-throughput/18
Blocked by: —
Source: разбор 2026-10-21 после Ticket-а [17](17-e2e-в-несколько-worker-ов.md) (PR #655, e2e в 3 worker-а
Playwright на macOS): 2 из 4 gate full упали на «the window was not shown within 30 s». Временный PR #660
ставит на macOS 2 worker-а, пока причина не устранена.

## Что происходит

- После перехода e2e на 3 worker-а на macOS (#655) 2 из 4 gate full упали с ошибкой
  `the window was not shown within 30 s` (`test/e2e/helpers.ts:179`, предел `FIRST_WINDOW_TIMEOUT_MS` —
  `test/e2e/helpers.ts:21`):
  - `test/e2e/settings-health.spec.ts:126` — тихие окна включены (`WORFY_QUIET_WINDOWS=1`);
  - `test/e2e/linked-notify.spec.ts:90` — тихие окна выключены намеренно (`test/e2e/linked-notify.spec.ts:25`),
    упало приложение A, первый запуск (`test/e2e/linked-notify.spec.ts:94`).
- В обоих случаях `app.firstWindow()` вернулся, а ожидание события `show` закончилось timeout-ом: страница
  существовала, но `ready-to-show` так и не пришёл. Приложение показывает окно только по `ready-to-show`
  (`src/main/window.ts:110`), запасного пути нет.
- Обычный запуск показывает окно примерно за 0,6 s, даже когда стартуют 6 приложений сразу; синхронной работы,
  которая держит старт, нет. В 18 запусках по одному spec-у не воспроизводится; в 102 логах gate встречается
  только в двух gate full с 3 worker-ами.
- Switch-и Chromium, которые не дают считать закрытое окно скрытым (`disable-backgrounding-occluded-windows`,
  `disable-renderer-backgrounding`, `backgroundThrottling: false`), включены только в режиме тихих окон
  (`src/main/quiet-windows.ts`). `linked-notify.spec.ts` их не получает.
- При timeout-е `launchApp` убивает приложение и удаляет его временные папки: в отчёте нет ни состояния окна, ни
  снимка, ни вывода приложения. Причину по логам gate установить нельзя.

## Что делаем

1. **Fallback show** в `src/main/window.ts`: если `ready-to-show` не пришёл через N секунд после
   `did-finish-load`, окно показывается тем же способом (`showInactive()` в тихом режиме, `show()` иначе), ровно
   один раз. В вывод приложения пишется, каким путём окно показано. Решение — в маленькой чистой функции с
   подставляемым timer-ом, unit test в стиле репозитория.
2. **Диагностика timeout-а** в `test/e2e/helpers.ts`: до throw и до удаления временных папок сохранить в
   attachment-ы test-а: `isVisible`, `webContents.isLoading()`, `isCrashed()`, `getURL()`, снимок
   `capturePage()` в PNG, `document.readyState` страницы (если страница отвечает), вывод приложения (stdout,
   stderr) и файлы логов из data dir. Каждый шаг ограничен коротким timeout-ом: диагностика сама не зависает.
   Короткая сводка — в текст ошибки, чтобы она была видна в логе gate без attachment-ов.
3. **Switch-и отрисовки для каждого e2e-запуска**: отдельная переменная окружения, которую ставит
   `playwright.config.ts`; `src/main/quiet-windows.ts` по ней включает `disable-backgrounding-occluded-windows`,
   `disable-renderer-backgrounding` и `backgroundThrottling: false` и без тихих окон. Фокус и системные
   уведомления `linked-notify.spec.ts` не меняются. Unit test-ы на переменную.
4. `workers` в `playwright.config.ts` не трогаем: значение — как на `main` (2, если влит #660).

## Готово, когда

- [x] `src/main/window.ts` показывает окно ровно один раз: по `ready-to-show` или по fallback через N s после
      `did-finish-load`; путь записан в вывод приложения; выбор N обоснован в коде и в «Итог».
- [x] Unit test на решение fallback show: показ по `ready-to-show`, показ по timer-у, не больше одного показа,
      timer снят после `ready-to-show` и при закрытии окна, закрытое окно не показывается.
- [x] При timeout-е первого окна `launchApp` сохраняет диагностику (состояние окна и webContents, PNG,
      `document.readyState`, вывод приложения, логи data dir) до удаления временных папок; каждый шаг ограничен.
- [x] Switch-и отрисовки включены для каждого e2e-запуска, в том числе с `WORFY_QUIET_WINDOWS=0`; unit test-ы на
      переменную и на то, что `playwright.config.ts` её ставит.
- [x] Под замком e2e по одному green: `launch.spec.ts`, `settings-health.spec.ts`, `linked-notify.spec.ts`,
      `quiet-windows.spec.ts`; lint, typecheck и задетые unit test-ы — exit code 0.
- [ ] Вердикт Windows (ADR-0056): `src/main/window.ts` работает и на Windows — PR платформенный.

## Где в коде

- `src/main/window.ts` — показ окна по `ready-to-show`.
- `src/main/window-show.ts` — новый: решение fallback show.
- `src/main/quiet-windows.ts` — switch-и отрисовки, новая переменная.
- `src/main/index.ts` — комментарий у `appendSwitch`.
- `playwright.config.ts` — ставит новую переменную.
- `test/e2e/helpers.ts` — `launchApp`, диагностика timeout-а.
- `test/e2e/start-diagnosis.ts` — новый: чистые части диагностики (предел шага, бюджет, хвост вывода, сводка).
- `test/e2e/linked-notify.spec.ts` — проверка, что switch-и отрисовки дошли до запуска без тихих окон.
- `test/unit/start-diagnosis.test.ts` — новый.
- `test/unit/window-show.test.ts` — новый.
- `test/unit/quiet-windows.test.ts`, `test/unit/e2e-notifications.test.ts`, `test/unit/playwright-json-report.test.ts`
  — новая переменная и восстановление окружения.

## Вне скоупа

- Число worker-ов e2e (временный PR #660, затем решение по замеру после этого Ticket-а).
- Поиск корневой причины, почему `ready-to-show` не приходит: этот Ticket даёт данные для него.

## Итог

Ветка `worfy-throughput/18`. Корневая причина, почему `ready-to-show` не приходит, не найдена: Ticket даёт
запасной путь показа окна и данные для следующего разбора.

**Fallback show.** `src/main/window-show.ts` (новый) — чистая функция `windowShow` с подставляемым timer-ом:
окно показывается по `ready-to-show` или, если его нет, через `READY_TO_SHOW_FALLBACK_MS` = 3 s после
`did-finish-load`; ровно один раз; закрытое окно не показывается; timer снимается после `ready-to-show` и на
`closed`. В stdout приложения пишется строка `[worfy] the window was shown on ready-to-show` или
`[worfy] the window was shown by the fallback: no ready-to-show within 3000 ms of did-finish-load`.
`src/main/window.ts` подключает её к `ready-to-show`, `did-finish-load` и `closed`; способ показа прежний
(`showInactive()` в тихом режиме, `show()` иначе). Почему 3 s: весь старт показывает окно примерно за 0,6 s,
и при 6 стартах сразу тоже; первая отрисовка идёт через кадр-два после загрузки. 3 s — в пять раз больше
всего старта, поэтому медленная, но живая отрисовка не опережается (а опережение стоит только пустого
кадра), и у e2e-старта остаётся 27 s из 30 s на первое окно.

**Диагностика timeout-а.** `launchApp` (`test/e2e/helpers.ts`) при любой ошибке ожидания первого окна —
timeout `firstWindow` или timeout события `show` — до kill и удаления временных папок собирает: состояние
окна (`isVisible`, `isMinimized`, opacity, bounds) и webContents (`isLoading`, `isLoadingMainFrame`,
`isWaitingForResponse`, `isCrashed`, `getURL`), `document.readyState`, снимок `capturePage()` в PNG, последние
256 KB stdout и stderr приложения и файлы `logs/` из data dir. Каждый шаг ограничен (3 s, сохранение файлов —
10 s). Файлы — в `<output теста>/start-diagnostics-…/` и attachment-ами test-а; сводка одной строкой
дописывается в текст ошибки, поэтому видна в логе gate. Проверено вручную: с временно сломанным ожиданием
`show` и пределом 6 s `launch.spec.ts` упал с
`window: visible true, loading false, crashed false, url file:///…/out/renderer/index.html, document.readyState complete; [worfy] the window was shown on ready-to-show; diagnostics in …`,
PNG 2560 × 1600 сохранён; правка откатана из копии.

**Switch-и отрисовки.** Новая переменная `WORFY_KEEP_PAINTING=1`; `playwright.config.ts` ставит её для
каждого e2e run (`??=`, как `WORFY_QUIET_WINDOWS`). `quietWindows()` (`src/main/quiet-windows.ts`) по ней и без
тихих окон отдаёт `disable-backgrounding-occluded-windows`, `disable-renderer-backgrounding` и
`backgroundThrottling: false`; показ, фокус и системные уведомления остаются как у обычного старта, поэтому
`linked-notify.spec.ts` (`WORFY_QUIET_WINDOWS=0`) ведёт себя как раньше. Обычный старт приложения переменную
не ставит.

**`workers`** не менялся: на `main` — 3 на macOS; временный PR #660 (2) не влит на момент этой ветки.

**Проверки (2026-10-21, Mac).** `pnpm lint` — exit 0; `pnpm typecheck` — exit 0; задетые unit test-ы
(`window-show`, `window-options`, `quiet-windows`, `e2e-notifications`, `playwright-json-report`, `notify`,
`renderer-entry`, `process-gone`, `link-notify`, `launch`) — 199 passed, exit 0. Mutation testing: 7 мутантов
(убрать «один показ», «один timer», подключение `did-finish-load`, снятие timer-а на `closed`, чтение
переменной, строку в `playwright.config.ts`, `showInactive` в тихом режиме) — каждый красный. Под замком e2e,
`nice -n 10`: `launch.spec.ts`, `settings-health.spec.ts`, `linked-notify.spec.ts`, `quiet-windows.spec.ts` —
12 passed, exit 0. Весь `pnpm test`, весь e2e и gate не запускались: тяжёлые run-ы на этом Mac ведёт Session
очереди gate.

**Круг ревью 1 (PR #661).** Бюджет диагностики ограничен временем, которое осталось у test-а до его timeout-а,
минус 10 s на kill и удаление временных папок (`diagnosisBudget`, `deadline` в `test/e2e/start-diagnosis.ts`);
без времени шаги не запускаются, а cleanup идёт всё равно. Часы test-а стартуют на его первом `launchApp`
(у Playwright нет времени начала test-а) — помечено `shortcut:`. Замена в `error.stack` — функцией. Чистые части
диагностики вынесены в `test/e2e/start-diagnosis.ts` и покрыты `test/unit/start-diagnosis.test.ts`. В
`window-show.ts` строка `timerSet = false` в callback-е timer-а убрана: `showBy` сам снимает сработавший timer,
снятие сработавшего timer-а ничего не делает. Проверка `isDestroyed` в `window.ts` покрыта test-ом (окно
уничтожено без события `closed`). `linked-notify.spec.ts` проверяет `disable-renderer-backgrounding` у обоих
приложений; эту правку проверит только следующий gate full. 5 новых мутантов — каждый красный.

**Windows (ADR-0056).** `src/main/window.ts` и `src/main/quiet-windows.ts` работают и на Windows — PR
платформенный, нужен вердикт Session на Windows-ПК.

**Влит (#661); 3 worker-а снова.** После merge — три run-а `pnpm test:e2e --workers=3` на `c75aaf8c`: 226,8 s,
203,7 s и 204,0 s, в каждом 289 passed, 0 failed, 0 flaky. По этому замеру follow-up PR возвращает на macOS вне CI
3 worker-а (`playwright.config.ts`, `E2E_WORKERS`); если «the window was not shown» вернётся, причину покажет папка
`start-diagnostics-…` в `test-results`. В том же PR — чистая функция часов test-а `timeLeftOnClock` с unit test-ом
и запас на kill и cleanup 15 s вместо 10 s (`CLEANUP_MARGIN_MS`: на Windows `endApp` ждёт выхода приложения до
10 s, затем три папки удаляются по очереди, до 5 повторов на каждую — около 1,5 s на папку, 4,5 s всего).

**Сбой в gate full PR #664 на `9ae4bca7` (3 worker-а): ожидание `show` пропустило показанное окно (PR #669).**
`session-view.spec.ts:98` упал с «the window was not shown within 30 s». `firstWindow` вернулся через 0,44 s, а
ожидание события `show` в `launchApp` так и не завершилось. Диагностика через 30 s: окно загружено, `isVisible`
true, в выводе приложения — «the window was shown on ready-to-show». Причина — в Electron 44.5.1 на macOS: событие
`show` приходит только из уведомления о смене occlusion state окна (`windowDidChangeOcclusionState`), а не из
`show()`/`showInactive()`, и `isVisible()` тоже читает occlusion state. Нет уведомления — нет `show`, а
`isVisible()` становится true позже. Исправление только в test-ах. `launchApp` ждёт первое из трёх событий:
`isVisible()` true (main опрашивает каждые 100 ms, функция `waitForFirstWindowShown` в
`test/e2e/first-window-shown.ts`), событие `show` или строку приложения в stdout о том, что оно вызвало `show()`.
Hook в `src/` не понадобился. Диагностика теперь пишет, вызвало ли приложение show, каким путём и через сколько
секунд после запуска. К состоянию окна добавлены `isFocused`, `app.isHidden()` и `powerMonitor.getSystemIdleState()`.
Unit test-ы: `test/unit/first-window-shown.test.ts` (в том числе случай этого сбоя) и новые случаи в
`test/unit/start-diagnosis.test.ts`. Мутант «только событие» красный: 5 из 7 test-ов.
