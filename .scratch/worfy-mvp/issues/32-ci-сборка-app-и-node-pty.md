# 32 — CI на macos-latest, сборка `.app` с ad-hoc подписью и node-pty под ABI Electron

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Соглашения для тикетов этого эпика», риски 7 и 9; [ADR-0004](../../../docs/adr/0004-stack-electron-ts-react-flow-agent-sdk.md)

## Что делаем

Вторая половина каркаса из тикета 01: проверка на GitHub, собранное приложение и нативный модуль
Терминала. Отдельно от 01, чтобы падение сборки `.app` или `node-pty` не держало остальной каркас.

- CI: `.github/workflows/ci.yml` на `macos-latest` — `pnpm install --frozen-lockfile`, `lint`,
  `typecheck`, `test`, `test:e2e` (сам собирает, тикет 01), `test:package`. Кэш pnpm store; новый
  push в ту же ветку отменяет прошлый прогон (`concurrency`).
- `node-pty` пересобирается под ABI Electron в `postinstall` (`@electron/rebuild`, только этот
  модуль). `pnpm test` уже идёт под Node из Electron (тикет 01), поэтому contract test грузит
  тот же бинарник, что и main.
- `electron-builder.yml`: `productName` `worfy`, `appId` `dev.worfy.app` (bundle id нужен
  уведомлениям, риск 9), только `--mac dir`, ad-hoc подпись, без нотаризации, `asarUnpack` для
  `node_modules/node-pty/**`. Тикет 07 добавит сюда Agent SDK.
- Скрипты: `package` (`electron-vite build && electron-builder --mac dir`), `test:package`
  (`package`, потом Playwright против собранного `.app`).

## Готово, когда

- [ ] CI на PR зелёный; намеренно сломанный unit test делает его красным.
- [ ] На чистом клоне `pnpm install` пересобирает `node-pty` под Electron; `pnpm test` с contract test-ом `node-pty` → код 0.
- [ ] `pnpm package` даёт `worfy.app`: `codesign -dv` показывает `Signature=adhoc`, `pty.node` лежит в `app.asar.unpacked`.
- [ ] `worfy.app` открывается двойным щелчком из Finder; снимок в «Итог».
- [ ] `pnpm test:package` → код 0: собранный `.app` запускается и показывает окно «worfy».

## Тесты

- `test/contract/node-pty.test.ts` — `node-pty` грузится, запускает `/bin/echo ok`, вывод получен, процесс завершился (новый).
- `test/e2e/packaged.spec.ts` — Playwright `_electron.launch({executablePath})` против `worfy.app` (новый).
- Сначала падающий test: `node-pty.test.ts` до `postinstall` падает на несовпадении `NODE_MODULE_VERSION`.

## Где в коде

- `.github/workflows/ci.yml`
- `electron-builder.yml`
- `package.json` — скрипты postinstall, package, test:package
- `test/contract/node-pty.test.ts`, `test/e2e/packaged.spec.ts`
