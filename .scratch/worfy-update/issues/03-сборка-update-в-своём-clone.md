# 03 — Сборка Update в своём clone в папке данных worfy и «Update automatically»

Type: task
Status: done 2026-10-31T07:47Z
PR: #1116
Branch: worfy-update/03
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

- [x] Contract test: bare-репозиторий во временной папке как `WORFY_UPDATE_REPO`, подменная сборка — первая
      сборка клонирует, вторая (новый commit) делает `fetch`, а не `clone`; `ready` с `appPath`.
- [x] Contract test: подменная сборка с кодом 1 — `failed`, `build.log` содержит её вывод, папка
      Stable copy теста не изменилась.
- [x] Contract test: нет `pnpm` в `PATH` — `failed`, `missing: ['pnpm']`, ни одного процесса не запущено.
- [x] Contract test: `autoUpdate: true` — Available update запускает сборку; `false` — нет;
      `quiet` — нет; `failed` на SHA A — сборка A сама не повторяется, SHA B — собирается.
- [x] Contract test настроек: файл без `autoUpdate` — `true`; запись `false` сохраняется.
- [x] В окружении шагов нет `GH_TOKEN` и `GITHUB_TOKEN`, даже если они есть у процесса worfy.
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
- После ревью (раунд 1): шаг запускается в своей группе процессов (`detached` вне Windows), `stop()` и
  предел git-шага убивают всю группу (`SIGKILL` по `-pid`; на Windows `taskkill /T`) — electron-builder
  под `pnpm package` не переживает worfy. Git-шаг дольше `GIT_STEP_TIMEOUT_MS` (30 min) — `failed` с
  причиной в журнале. Окружение login shell снимается заново перед каждой сборкой (`recaptureAgentEnv`),
  причина запасного окружения пишется в `build.log`; после `stop()` ни один шаг не начинается.
- `src/main/update/auto.ts` (новый)
- `src/shared/ipc/update.ts`, `src/main/ipc/update.ts`
- `src/shared/settings/app-settings.ts` (`:183`), `src/main/settings/store.ts`
- `test/fixtures/update/` (новая)
- `test/contract/update-build.test.ts` (новый)
- `test/contract/app-settings.test.ts`

Только читать: `scripts/install-stable.mjs`, `src/main/first-run/checks.ts`, `src/main/update/state.ts`,
`src/main/update/check.ts`.

## Итог

- `src/main/update/build.ts` (новый): `UpdateBuilder` собирает SHA в `<dataRoot>/update/repo`. Нет
  `repo/.git` — `git clone -- <repo> repo`; есть — `git remote set-url origin <repo>` и
  `git fetch origin +refs/heads/main:refs/remotes/origin/main`. Потом проверка
  `git merge-base --is-ancestor <sha> refs/remotes/origin/main`: SHA не из `main` своего origin — `failed`,
  строка «Refused: … is not a commit of main of …» в `build.log`, ничего не ставится и не собирается
  (требование ревью #1112: подменённый `WORFY_UPDATE_API` может назвать только commit настоящего `main`).
  Дальше `git checkout --force --detach <sha>`, `git clean -fdx -e node_modules`,
  `pnpm install --frozen-lockfile`, `pnpm package`. Готовое приложение ищется по правилу `builtApp`
  скрипта: `dist/mac*/worfy.app` или `dist\win-unpacked`.
- Remote — только из конфигурации: `UPDATE_REPO` или `WORFY_UPDATE_REPO` (`process.env`), никогда из
  ответа API. `WORFY_UPDATE_BUILD` — путь к `.mjs`, который `node` запускает в clone вместо
  `pnpm package` (так test-ы кладут папку-«приложение» без сборки).
- Инструменты `git`, `node`, `pnpm` ищутся до первого шага: на Windows через `toolStart` First run
  (`.cmd` через cmd.exe), на macOS и Linux — исполняемый файл в PATH. Нет — `failed` с `missing`, ни одного
  процесса. Окружение шагов — окружение login shell (`agentEnv`) без `GH_TOKEN` и `GITHUB_TOKEN` в любом
  регистре имени.
- Одна сборка за раз; новая Available update во время сборки ждёт её конца, из ждущих собирается
  последняя. `stop()` на `will-quit` завершает шаг, который идёт, и оставляет фазу `building`; при
  следующем старте `recover()` делает её `idle`, так что этот SHA соберётся снова сам. Шаг, который
  бросил (не пришло окружение), — тоже `failed`, фаза `building` не зависает.
- `src/main/update/auto.ts` (новый): `autoBuildFor` — с «Update automatically» после каждой проверки
  собирается Available update без `quiet`, если по этому SHA ещё не было `ready`, `building` или
  `failed`; `installTarget` — что собирает `update.install` (и после `failed`, и `quiet`, но не уже
  собранное или собираемое).
- Каналы `update.install` (ответ — снимок с начатой сборкой, конец приходит `update.changed`) и
  `update.showLog` (`shell.openPath` для `build.log`; нет журнала — ошибка), оба `local`.
- `autoUpdate` в настройках: в схеме состояния поле необязательное (`autoUpdateOf` — нет поля, значит
  включено), store пишет его всегда, файл без поля — `true`. Необязательное — чтобы не править 14 unit
  test-ов renderer-а с готовыми объектами настроек вне «Где в коде».
- Test-ы: `test/contract/update-build.test.ts` (24), `test/contract/app-settings.test.ts` (поле
  `autoUpdate`); подменные команды — `test/fixtures/update/` (Node-скрипты, одинаковые на всех ОС).

- Low из review (debt, Ticket-ами не становятся): нет pid-lock на clone после падения worfy посреди сборки; test зависшего шага проверяет pid нестрого.
