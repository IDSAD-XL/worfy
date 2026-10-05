# 32 — e2e и сборка `.app` в CI, `.app` с ad-hoc подписью и node-pty под ABI Electron

Type: task
Status: open
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

- [ ] В CI на PR тикета 32 (ветка `worfy-mvp/32`) есть шаги `test:e2e` и `test:package`, check зелёный: `gh pr checks <N>; echo $?` → код 0.
- [ ] Намеренно сломанный e2e test делает check CI красным; после отката снова зелёный.
- [ ] Второй push в ту же ветку отменяет прошлый прогон (в Actions он `cancelled`).
- [ ] На чистом клоне `pnpm install` пересобирает `node-pty` под Electron; `pnpm test` с contract test-ом `node-pty` → код 0.
- [ ] `pnpm package` даёт `worfy.app`: `codesign -dv` показывает `Signature=adhoc`, `pty.node` лежит в `app.asar.unpacked`.
- [ ] `worfy.app` открывается двойным щелчком из Finder; снимок в «Итог».
- [ ] `pnpm test:package` → код 0: собранный `.app` запускается и показывает окно «worfy».

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
