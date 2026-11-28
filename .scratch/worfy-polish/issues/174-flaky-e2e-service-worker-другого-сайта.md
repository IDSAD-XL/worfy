# 174 — e2e «a service worker of another site…»: клик пользователя по странице не забирает Browser на macOS runner-е

Type: bug
Status: open
Blocked by: None — can start immediately
Source: красный `ci-ok` PR #2341 2026-11-28 (job `macos-e2e (3/3)`, PR не трогает Browser) + worfy-polish 66 (список
flaky test-ов CI: этот test — macOS FLAKY 5 раз 2026-11-01…11-05, не разбирался).

Кто: агент. Глубина review — `medium`.

## Что происходит

- `test/e2e/browser-mcp.spec.ts:406` «a service worker of another site does not let the Session's navigation past the
  origins» падает на строке 414: `expect(frame.getByTestId('browser-taken-over')).toBeVisible()` — `element(s) not
  found` за 15 s. До неё test открывает Browser вызовом `browser_open`, ждёт `pagePainted()` (два кадра страницы) и
  кликает мышью в тело Browser-а (`window.mouse.click(body.x + body.width / 2, body.y + 60)`). Клик должен перевести
  Browser в режим «пользователь взял управление» (бейдж «Return control to Claude»), но этого не происходит.
- PR #2341, run 46105332190, job 140856752338 (`macos-e2e (3/3)`, head f15220b99): красный на первой попытке и на
  CI retry (обе 17.3 s). Снимок на момент падения: страница «Home» нарисована, бейдж «Claude is driving» на месте —
  Browser так и остался у Session. PR #2341 меняет только модуль путей проверки Harness, поля Profile-а и форму Edit
  profile (`harness/`, `src/main/workflow/profile.ts`, `src/renderer/projects/*`), ничего из Browser-а.
- `main`, push run 46029852347, job 140610887080 (4987d504d, worfy-layout 06): та же строка 414, первая попытка
  красная, retry зелёный (FLAKY). Из 40 последних push run-ов `main` (2026-11-27T03:53Z…2026-11-28T04:22Z) этот test
  гоняли 15 (остальные — только документы), FLAKY — 1. Из 45 последних завершённых PR run-ов `ci.yml` красная попытка
  этого test-а — только в run-е PR #2341. Редко, но не ноль, и в одном job-е упали обе попытки подряд.
- Соседний test `browser-mcp.spec.ts:430` («Claude is driving» goes at a click…) кликает тем же способом и в том же
  job-е прошёл. Отличие: перед кликом он ждёт бейдж `browser-claude-drives` (через `snapshotThemes`), а test :406 — нет.
- Как клик забирает Browser: страница-гость `<webview>` сообщает о вводе в main через `input-event`
  (`src/main/browser/cdp.ts:328-332`); событие пропускается, пока идёт синтетический ввод Session-а
  (`this.synthetic !== 0`); `takeOver` в `src/main/browser/live.ts:557-564` срабатывает, только если в этот момент
  Browser в режиме `claude`. Рамка в renderer-е (`onPointerDownCapture` в `src/renderer/canvas/nodes/BrowserNode.tsx:518-541`)
  ловит клик по заголовку и панелям, не по странице.
- Гипотезы, не проверены: (а) клик Playwright-а по окну доходит до страницы, но `input-event` гостя не приходит
  (гость ещё не принимает ввод от окна — тот же эффект, ради которого есть `pagePainted`, на Windows); (б) клик
  приходит раньше, чем main перевёл Browser в режим `claude`, и `takeOver` молча возвращает `false`, а повторного
  клика нет. Обе дают ровно наблюдаемое: страница нарисована, бейдж «Claude is driving», «taken over» нет.
- С 2026-11-28 test в карантине: `test/quarantine/browser-mcp-service-worker-origins.json`, владелец — этот Ticket,
  срок — 2026-12-12. Пока он в карантине, сам запрет (service worker не проводит Session за origins) проверяет только
  contract test `test/contract/browser-tools.test.ts:624` (команда `Network.setBypassServiceWorker` до `Fetch.enable`),
  без настоящей страницы.

## Что строить

1. Найти причину: воспроизвести под нагрузкой (например, `--repeat-each` только этого test-а в CI-подобных условиях
   или trace из артефакта `e2e-results-*` run-а 46105332190) и установить, какая из гипотез верна или какая другая.
2. Чинить причину, не время: ждать условия (Browser в режиме `claude`; гость принял ввод — например, его
   `input-event` дошёл), а не отсчёт по часам. Предел ожидания test-а не поднимать (правило владельца о timeout-ах).
   Если причина — в коде приложения (клик пользователя теряется), чинить приложение и добавить test, красный до правки.
3. Если тот же приём клика есть в других test-ах файла (`:430`, `:452` и др.) — привести их к тому же ожиданию.
4. Убрать карантин: запись `test/quarantine/browser-mcp-service-worker-origins.json` и `quarantined(...)` в spec-е.

## Где в коде

- `test/e2e/browser-mcp.spec.ts:185-198` (`inPage`, `pagePainted`), `:406-430` (test), `:430-470` (соседние клики).
- `test/quarantine/browser-mcp-service-worker-origins.json`.
- `src/main/browser/cdp.ts:162`, `:328-332` (`input-event`, `TAKEOVER_INPUT`, `synthetic`).
- `src/main/browser/live.ts:540-566` (`drive`, `takeOver`).
- `src/renderer/canvas/nodes/BrowserNode.tsx:518-541` — для сверки.

## Готово, когда

- [ ] Причина установлена и записана в «Итог» (какая гипотеза или какая другая), с доказательством (trace, лог,
      повтор под нагрузкой).
- [ ] Исправлена причина, предел ожидания test-а не поднят; если правка в приложении — test, красный до правки.
- [ ] Запись карантина `browser-mcp-service-worker-origins` и пометка `quarantined(...)` убраны не позже 2026-12-12;
      test проходит в `macos-e2e` без FLAKY на head PR.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
