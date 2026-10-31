# 15 — Сборка Update докачивает Electron, если его download в clone не закончился

Type: task
Status: claimed 2026-10-31T22:22Z
Branch: worfy-update/15
Blocked by: —
Source: отчёт Session на ПК 2026-11-01: Update из приложения упал на `pnpm package` с «The specified electronDist does not
exist» (`%APPDATA%\worfy\update\repo\node_modules\electron\dist`).

## Что происходит

- В clone Update (`<dataRoot>/update/repo`) в `node_modules/electron` лежали файлы недельной давности, без `dist` и без
  `path.txt`: download Electron в postinstall пакета `electron` не закончился.
- `pnpm install --frozen-lockfile` отвечает «Already up to date» и postinstall не повторяет; `git clean -fdx -e
  node_modules` папку не трогает. Каждая следующая сборка падает так же, на `pnpm package`, через минуты.
- `scripts/install-stable.mjs` эту поломку видит заранее (`electronMissing`, `ELECTRON_INSTALL`): до сборки он
  отказывает с текстом «Run `node node_modules/electron/install.js` …». `src/main/update/build.ts` идёт clean → install
  → package без этой проверки, хотя его заголовок обещает ту же сборку, что `pnpm install:stable`.
- Ручной `node node_modules/electron/install.js` в clone починил ПК.

## Что делаем

- После `pnpm install` сборка Update проверяет Electron в `node_modules/electron` так же, как `electronMissing` в
  `scripts/install-stable.mjs`: `path.txt` есть и называет программу, которая лежит в `dist` (macOS —
  `Electron.app/Contents/MacOS/Electron`, Windows — `electron.exe`).
- Программы нет — отдельный шаг сборки `node node_modules/electron/install.js` (его строка и вывод — в `build.log`),
  потом проверка ещё раз. Не помогло, или нет самой папки `node_modules/electron` — сборка `failed` до `pnpm package`,
  причина — в `build.log`.
- Здоровое дерево — шага нет, сборка как раньше.
- `scripts/install-stable.mjs` — один файл без своих import-ов (его test копирует его одного в другой репозиторий),
  поэтому проверка в `build.ts` — копия `electronMissing`; unit test гоняет обе по одним и тем же деревьям.

## Готово, когда

- [ ] Contract test: clone с `node_modules/electron` без `dist` и `path.txt`, `install.js` — stub; сборка запускает
      шаг install до `pnpm package` и доходит до `ready`.
- [ ] Contract test: здоровое дерево — шага install нет.
- [ ] Contract test: install не вернул программу — `failed` до `pnpm package`, причина в `build.log`.
- [ ] Test красный на mutant-е, который убирает проверку.
- [ ] Unit test: копия в `build.ts` и `electronMissing` из `scripts/install-stable.mjs` отвечают одинаково на macOS и
      Windows.
- [ ] `docs/features/updates.md` называет шаг.

## Тесты

- contract: `test/contract/update-build.test.ts` — сломанное, здоровое и неисправимое дерево; stub `install.js` в clone,
  без сети и без настоящего Electron.
- unit: копия проверки против `electronMissing` скрипта.
- Все unit и contract test-ы `src/main/update` и `scripts/install-stable.mjs`.

## Где в коде

- `src/main/update/build.ts` — шаги сборки, копия проверки.
- `scripts/install-stable.mjs` — `electronMissing`, `ELECTRON_INSTALL` (только комментарий о копии).
- `test/contract/update-build.test.ts`, `test/fixtures/update/` (stand-in `pnpm.mjs`, README), stand-in pnpm в
  `test/e2e/update-toolbar.spec.ts`, unit test копии.
- `docs/features/updates.md` — раздел «The build».

## Итог
