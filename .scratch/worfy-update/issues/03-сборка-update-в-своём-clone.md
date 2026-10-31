# 03 — Сборка Update в своём clone в папке данных worfy и «Update automatically»

Type: task
Status: open
Blocked by: 01
Source: решения владельца 2026-10-31, пункты 3 (постоянный clone в папке данных, та же сборка, что `pnpm install:stable`, нужны `node` и `pnpm`), 7 (с «Update automatically», по умолчанию включено, — сборка в фоне), 8 (сбой — текущая копия остаётся, недостающие инструменты, повтор); [spec.md](../spec.md), «Как устроено», «Решено без владельца», Р5, Р11; [ADR-0089](../../../docs/adr/0089-update-builds-main-in-own-clone.md), пункты 3, 5, 6; [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md)

## Что происходит

- После Ticket-а 01 main знает Available update (`available` в `update/state.json`) и держит поле
  `build` схемы, но ничего не собирает.
- Сборка Stable copy — `pnpm package` (`buildCommand`, `scripts/install-stable.mjs:201`); готовое
  приложение — `dist/mac*/worfy.app` или `dist\win-unpacked` (`builtApp`, `:245`); без Electron в
  `node_modules` сборка не идёт (`electronMissing`, `:218`).
- `node` и `git` ищет First run (`toolStart`, `src/main/first-run/checks.ts:196`; `runTool`, `:232`; на
  Windows `.cmd` — `windowsProgram`, `:176`). `pnpm` не ищет никто.
- Настройки этой Machine — `app-settings.json` (`src/main/settings/store.ts`; схема —
  `src/shared/settings/app-settings.ts:183`). Поля «Update automatically» нет.

## Что делаем

1. `src/main/update/build.ts` (новый): сборка SHA в `<dataRoot>/update/repo`.
   1. Инструменты: `git`, `node`, `pnpm` через `toolStart`; нет — фаза `failed` с `missing`, ничего не
      запущено.
   2. Нет `repo/.git` — `git clone <repo> repo` (`<repo>` — `https://github.com/IDSAD-XL/worfy.git`,
      подменяется `WORFY_UPDATE_REPO`); есть — `git fetch origin main`. Потом `git checkout --force <sha>`
      и `git clean -fdx -e node_modules`.
   3. `pnpm install --frozen-lockfile`, потом команда `buildCommand` (подменяется `WORFY_UPDATE_BUILD` —
      test-ы кладут папку-«приложение» без сборки).
   4. Готово — фаза `ready` с `appPath` (по правилу `builtApp`) и `version`.
   Весь вывод — в `update/build.log` (новый на каждую сборку). Любой шаг с кодом ≠ 0 — `failed` с `log`;
   Stable copy не тронута. Одна сборка за раз; новая Available update во время сборки ждёт её конца.
   Пути — только через `node:path`; переменные `GH_TOKEN` и `GITHUB_TOKEN` в окружение шагов не попадают.
2. Каналы домена `update`: `update.install` (собрать Available update; уже `ready` — ничего, ответ —
   снимок), `update.showLog` (открыть `build.log` программой системы, `shell.openPath`). Оба `local`.
3. `autoUpdate: boolean` в схеме настроек, по умолчанию `true`; файл без поля — `true`.
4. `src/main/update/auto.ts` (новый): с `autoUpdate` новая Available update без `quiet` запускает сборку
   сама. После `failed` тот же SHA сам не повторяется — только следующий SHA или `update.check` с
   последующим `update.install` (пункт 8).

## Готово, когда

- [ ] Contract test: bare-репозиторий во временной папке как `WORFY_UPDATE_REPO`, подменная сборка — первая
      сборка клонирует, вторая (новый commit) делает `fetch`, а не `clone`; `ready` с `appPath`.
- [ ] Contract test: подменная сборка с кодом 1 — `failed`, `build.log` содержит её вывод, папка
      Stable copy теста не изменилась.
- [ ] Contract test: нет `pnpm` в `PATH` — `failed`, `missing: ['pnpm']`, ни одного процесса не запущено.
- [ ] Contract test: `autoUpdate: true` — Available update запускает сборку; `false` — нет;
      `quiet` — нет; `failed` на SHA A — сборка A сама не повторяется, SHA B — собирается.
- [ ] Contract test настроек: файл без `autoUpdate` — `true`; запись `false` сохраняется.
- [ ] В окружении шагов нет `GH_TOKEN` и `GITHUB_TOKEN`, даже если они есть у процесса worfy.
- [ ] Платформенный PR (ADR-0056, пункт 2; ADR-0086; `.cmd` и пути Windows): вердикт Windows по
      `scripts/windows-verdict-scope.mjs`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Contract `test/contract/update-build.test.ts` (новый): временная папка данных, bare-репозиторий,
  `test/fixtures/update/` — подменные команды сборки (успех, сбой).
- Contract `test/contract/app-settings.test.ts`: поле `autoUpdate`.
- Сначала падающий: вторая сборка не клонирует заново.

## Где в коде

- `src/main/update/build.ts` (новый)
- `src/main/update/auto.ts` (новый)
- `src/shared/ipc/update.ts`, `src/main/ipc/update.ts`
- `src/shared/settings/app-settings.ts` (`:183`), `src/main/settings/store.ts`
- `test/fixtures/update/` (новая)
- `test/contract/update-build.test.ts` (новый)
- `test/contract/app-settings.test.ts`

Только читать: `scripts/install-stable.mjs`, `src/main/first-run/checks.ts`, `src/main/update/state.ts`,
`src/main/update/check.ts`.

## Итог

Заполняется при закрытии.
