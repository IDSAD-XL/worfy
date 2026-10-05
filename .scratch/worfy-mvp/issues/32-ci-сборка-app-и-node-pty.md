# 32 — e2e и сборка `.app` в CI, `.app` с ad-hoc подписью и node-pty под ABI Electron

Type: task
Status: blocked — ревью дважды не чистое: не выполнен пункт «worfy.app открывается двойным щелчком из Finder; снимок в Итог» — у агента нет права Screen Recording, нужен владелец; PR #2
Blocked by: 01
Source: [spec.md](../spec.md), «Соглашения для тикетов этого эпика», риски 7 и 9; [ADR-0004](../../../docs/adr/0004-stack-electron-ts-react-flow-agent-sdk.md)

## Что делаем

Вторая половина каркаса из тикета 01: собранное приложение, нативный модуль Терминала и полный
прогон в CI. Минимальный CI (`install`, `lint`, `typecheck`, `test` на `macos-latest`) уже завёл
тикет 01. Отдельно от 01, чтобы падение сборки `.app` или `node-pty` не держало остальной каркас.

- CI: расширить `.github/workflows/ci.yml` из тикета 01 — после `test` шаги `test:e2e` (сам
  собирает, тикет 01) и `test:package`. Кэш pnpm store (`actions/setup-node` с `cache: pnpm`);
  новый push в ту же ветку отменяет прошлый прогон (`concurrency`).
- `node-pty` пересобирается под ABI Electron в `postinstall` (`@electron/rebuild`, только этот
  модуль). `pnpm test` уже идёт под Node из Electron (тикет 01), поэтому contract test грузит
  тот же бинарник, что и main.
- `electron-builder.yml`: `productName` `worfy`, `appId` `dev.worfy.app` (bundle id нужен
  уведомлениям, риск 9), только `--mac dir`, ad-hoc подпись, без нотаризации, `asarUnpack` для
  `node_modules/node-pty/**`. Тикет 07 добавит сюда Agent SDK.
- Скрипты: `package` (`electron-vite build && electron-builder --mac dir`), `test:package`
  (`package`, потом Playwright против собранного `.app`).

## Готово, когда

- [x] В CI на PR тикета 32 (ветка `worfy-mvp/32`) есть шаги `test:e2e` и `test:package`, check зелёный: `gh pr checks <N>; echo $?` → код 0.
- [x] Намеренно сломанный e2e test делает check CI красным; после отката снова зелёный.
- [x] Второй push в ту же ветку отменяет прошлый прогон (в Actions он `cancelled`).
- [x] На чистом клоне `pnpm install` пересобирает `node-pty` под Electron; `pnpm test` с contract test-ом `node-pty` → код 0.
- [x] `pnpm package` даёт `worfy.app`: `codesign -dv` показывает `Signature=adhoc`, `pty.node` лежит в `app.asar.unpacked`.
- [ ] `worfy.app` открывается двойным щелчком из Finder; снимок в «Итог».
- [x] `pnpm test:package` → код 0: собранный `.app` запускается и показывает окно «worfy».

## Тесты

- `test/contract/node-pty.test.ts` — `node-pty` грузится, запускает `/bin/echo ok`, вывод получен, процесс завершился (новый).
- `test/e2e/packaged.spec.ts` — Playwright `_electron.launch({executablePath})` против `worfy.app` (новый).
- CI проверяется прогоном workflow на PR тикета 32: зелёный, красный на сломанном e2e test, снова зелёный.
- Сначала падающий test: `node-pty.test.ts` до `postinstall` падает на несовпадении `NODE_MODULE_VERSION`.

## Где в коде

- `.github/workflows/ci.yml` — шаги `test:e2e`, `test:package`, кэш, `concurrency` (файл создан в тикете 01)
- `electron-builder.yml`
- `package.json` — скрипты postinstall, package, test:package
- `test/contract/node-pty.test.ts`, `test/e2e/packaged.spec.ts`

## Итог

PR: https://github.com/IDSAD-XL/worfy/pull/2 (ветка `worfy-mvp/32`).

**Сначала падающий test — и посылка тикета, которая не подтвердилась.** Тикет ждал, что
`test/contract/node-pty.test.ts` до `postinstall` упадёт на несовпадении `NODE_MODULE_VERSION`.
Так не бывает: `node-pty` 1.1.0 собран на N-API (`node-addon-api` в `binding.gyp`) и везёт
готовые `prebuilds/darwin-arm64/pty.node` и `darwin-x64`, а N-API-модуль грузится в любом ABI,
и в Node, и в Electron. Test всё равно падал до правки, но по другой причине:
`Error: posix_spawnp failed.` — у `prebuilds/darwin-*/spawn-helper` после `pnpm install` нет бита
исполнения (`-rw-r--r--`), и `node-pty` не может запустить через него процесс. Механизм тикета
(`@electron/rebuild` только для `node-pty` в `postinstall`) чинит и это: он собирает
`node_modules/node-pty/build/Release/{pty.node,spawn-helper}` с битом исполнения, а
`node-pty` (`lib/utils.js`) ищет `build/Release` раньше `prebuilds`. После `pnpm exec
electron-rebuild --only node-pty` тот же test зелёный. Цена: `postinstall` компилирует C++
(нужны Xcode Command Line Tools и Python; на `macos-latest` они есть), около 3–10 секунд.

**Решения, которых нет в тикете.**
- `test:e2e` теперь `playwright test --grep-invert @packaged`, `test:package` —
  `pnpm package && playwright test --grep @packaged`. Test-ы против собранного `.app` помечены
  тегом `@packaged`: без этого `pnpm test:e2e` (и gate `full`) запускал бы их против `dist/`,
  которого нет или который устарел. `playwright.config.ts` не тронут.
- `electron-builder.yml`: `npmRebuild: false` — `node-pty` уже пересобран в `postinstall`, вторая
  пересборка при упаковке лишняя; `electronDist: node_modules/electron/dist` — упаковывается уже
  установленный Electron, без второй загрузки; `publish: null`.
- `concurrency`: отменяются только прогоны PR (`cancel-in-progress` при `pull_request`); прогоны
  на `main` не отменяют друг друга, у каждого мержа свой результат.
- `asarUnpack` для `node_modules/node-pty/**` оставлен, как велит тикет, но electron-builder и без
  него распаковывает модули с `.node` (проверено: без строки `asarUnpack` `pnpm test:package` тоже
  код 0). Поэтому `packaged.spec.ts` проверяет не строку конфига, а итог: `pty.node` из
  `build/Release` лежит в `app.asar.unpacked`, а `node-pty`, найденный из `app.asar`, запускает
  `/bin/echo ok`.
- `test/e2e/packaged.spec.ts` запускает `.app` своей функцией, а не `launchApp` из
  `test/e2e/helpers.ts`: helper тикета 01 жёстко передаёт `out/main/index.js`, а файл вне следа
  этого тикета.

**Проверки локально (код возврата).**
- `pnpm lint && pnpm typecheck && pnpm test` → 0 (5 файлов, 30 test-ов).
- `bash ~/.claude/hooks/gate.sh fast </dev/null` → `[gate] зелено (fast): worfy/.:lint
  worfy/.:typecheck worfy/.:test`, код 0.
- `pnpm test:e2e` → 0 (2 test-а `launch.spec.ts`, `@packaged` не запускались).
- `pnpm test:package` → 0 (2 test-а `packaged.spec.ts`).
- `codesign -dv dist/mac-arm64/worfy.app` → `Identifier=dev.worfy.app`, `Signature=adhoc`.
  `app.asar.unpacked/node_modules/node-pty/build/Release/pty.node` и `spawn-helper` на месте,
  оба `-rwxr-xr-x`.
- Чистый клон ветки (`git clone`, без `node_modules`): `pnpm install --frozen-lockfile` → 0, в
  выводе `postinstall$ electron-rebuild --only node-pty` … `✔ Rebuild Complete`, появился
  `build/Release`; `pnpm test` → 0 (30 test-ов, с `node-pty.test.ts`).

**CI** (`.github/workflows/ci.yml`, job `check` на `macos-latest`):
- второй push отменил прошлый прогон: https://github.com/IDSAD-XL/worfy/actions/runs/37255382968
  (коммит cece202) — `completed cancelled`;
- красный на намеренно сломанном e2e test (коммит 0f1432f, временный
  `test/e2e/deliberately-broken.spec.ts`): https://github.com/IDSAD-XL/worfy/actions/runs/37255391480 —
  шаг `pnpm test:e2e` `failure` (`Expected: "not worfy"`, `Received: "worfy"`), `test:package`
  пропущен, `gh pr checks 2` → код 1;
- после отката (коммит 7d8156e) зелёный: https://github.com/IDSAD-XL/worfy/actions/runs/37255575679 —
  все шаги, включая `test:e2e` (2 passed) и `test:package` (2 passed), `success`; в логе install
  `electron-rebuild --only node-pty` … `✔ Rebuild Complete`. Кэш pnpm store в этом прогоне ещё
  не найден («pnpm cache is not found») и сохранён в конце job; следующие прогоны его читают.

**Запуск из Finder.** `open dist/mac-arm64/worfy.app` (тот же путь через LaunchServices, что
двойной щелчок) → код 0; процесс `worfy.app/Contents/MacOS/worfy` запущен; `CGWindowListCopyWindowInfo`
показывает окно на экране, владелец `worfy`, слой 0, 1280×800 — размер окна из
`src/main/window.ts`. Приложение закрыто через `osascript … to quit`.
- не проверено: снимок экрана — `screencapture -x` отвечает «could not create image from
  display», у процесса нет разрешения Screen Recording; заголовок окна по той же причине не
  читается, а `osascript` через System Events отказывает («not allowed assistive access»).
  Заголовок «worfy» на собранном `.app` проверяет `pnpm test:package`, но запуском через
  Playwright, а не из Finder.
