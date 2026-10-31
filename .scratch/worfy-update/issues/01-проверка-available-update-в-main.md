# 01 — Проверка Available update в main: GitHub API, зелёный `ci-ok`, пути, состояние

Type: task
Status: done 2026-10-31T06:06Z
PR: #1112
Blocked by:
Source: решения владельца 2026-10-31, пункты 1 (GitHub API без входа, при старте и раз в час, без сети — молча), 2 (Available update), 11 (dev-сборка не проверяет); [spec.md](../spec.md), «Как устроено», «Решено без владельца», Р1–Р4, Р15; [ADR-0089](../../../docs/adr/0089-update-builds-main-in-own-clone.md), пункты 1, 2, 7

## Что происходит

- worfy знает свою build version `<semver>+<short SHA>[.dirty]` (`scripts/build-version.ts:11-19`) и
  отдаёт её каналом `app.version` (`src/main/ipc/app.ts:7`, `src/shared/ipc/app.ts:10`). С `main` её никто
  не сравнивает.
- Stable copy лежит в `defaultTarget` (`scripts/install-stable.mjs:74-77`); рядом — `<target>.json` с полным
  `commit` (`metadataPath`, `:114-116`; запись — `:827`). В main этих путей нет.
- Похожая проверка уже есть для Autopilot: `src/main/autopilot/harness-drift.ts` (Harness в `main` ушёл
  вперёд) — она читает git Project-а, а не GitHub, и только в своём репозитории.
- Запросов к GitHub API без входа в main нет; `src/main/github/` ходит через `gh`.
- Своё состояние worfy лежит в `dataRoot()` (`src/main/storage/paths.ts:35`), файлы JSON читаются и пишутся
  через `src/main/storage/json-file.ts`.

## Что делаем

1. `src/main/update/stable-copy.ts` (новый): путь Stable copy по платформе — как `defaultTarget`
   скрипта; `WORFY_UPDATE_STABLE` его подменяет. `updateEnabled({ packaged, execPath, env })` — Р1:
   `packaged` и `execPath` внутри копии, или `WORFY_UPDATE=1` (e2e). Запущенный commit — `commit` из
   `<target>.json`, без файла — SHA из build version.
2. `src/main/update/github.ts` (новый): клиент GitHub API без входа, адрес — `WORFY_UPDATE_API` (по
   умолчанию `https://api.github.com`), репозиторий `IDSAD-XL/worfy`. Четыре чтения: голова `main`; check
   `ci-ok` на SHA; сравнение `compare/<a>...<b>` (`status`, `commits`, `files`); `package.json` на SHA.
   Заголовка `Authorization` нет никогда; переменные `GH_TOKEN` и `GITHUB_TOKEN` не читаются. Таймаут
   запроса 15 s. Сеть, 403, 429, 5xx — результат `skipped` с причиной (Р15).
3. `src/main/update/check.ts` (новый): решение по Р2–Р4. Голова = запущенный commit — Update нет.
   `ci-ok` не `success` — нет. Сравнение не `ahead` — нет. В `files` нет пути вне `docs/**`, `.scratch/**`,
   `test/**`, `.github/**` и `*.md` в корне — нет; 300 файлов — считается, что меняет. Иначе Available
   update `{ sha, version, checkedAt }`. После отката (поле `rolledBackFrom`) голова = этот SHA — Available
   update есть, но с пометкой `quiet` (пункт 9; её читают 03, 06, 07); `update.check` пометку не ставит.
4. `src/main/update/state.ts` (новый): `<dataRoot>/update/state.json`. Схема целиком для Epic-а (следующие
   Ticket-ы её только заполняют): `lastCheck { at, result: 'ok' | 'skipped', reason? }`,
   `available { sha, version, quiet } | null`, `build { phase: 'idle' | 'building' | 'ready' | 'failed',
   sha?, version?, appPath?, log?, missing?: string[] }`, `idle: boolean`, `previous { version } | null`,
   `rolledBackFrom: string | null`, `harnessBehind { from, to } | null`, `running { commit, version }`,
   `lastRestart { ok, action, version, reason? } | null`, `harnessAfterUpdate: 'failed' | null`.
   Битый файл — в сторону и пустое состояние (как `readJsonFile`).
5. Расписание: проверка через 10 s после старта и раз в час, только при `updateEnabled`. Одна проверка за
   раз; `update.check` во время проверки получает её результат.
6. Домен IPC `update` (новый): `src/shared/ipc/update.ts`, `src/main/ipc/update.ts` — `update.state`
   (снимок), событие `update.changed`, `update.check` (сразу, ответ — снимок). Все `local`. В dev-сборке
   без `WORFY_UPDATE=1` — `enabled: false`, проверок нет.
7. `src/renderer/update/store.ts` (новый): store снимка (`update.state`, потом `update.changed`).
8. `src/main/index.ts`: старт расписания, остановка на `will-quit`.
9. `test/update-stub.ts` (новый): локальный HTTP-сервер с ответами-fixture четырёх чтений и счётчиком
   запросов; отказ, если путь Stable copy теста вне временной папки (соглашения spec-а).

## Готово, когда

- [x] Unit test `check`: голова = запущенный — нет Update; `ci-ok` `pending` и `failure` — нет; `diverged`
      и 404 — нет; только `docs/a.md`, `.scratch/x/spec.md`, `HANDOFF.md` — нет; плюс `src/main/x.ts` или
      `harness/skills/x/SKILL.md` — есть; 300 файлов — есть.
- [x] Unit test `updateEnabled`: dev — нет; packaged в Stable copy — да; packaged в `/tmp/x.app` — нет;
      `WORFY_UPDATE=1` — да. Пути Windows — через `node:path` `win32`.
- [x] Contract test клиента против `test/update-stub.ts`: нет `Authorization` ни в одном запросе при
      заданных `GH_TOKEN` и `GITHUB_TOKEN`; сервер не отвечает (порт закрыт) и 403 — `skipped`, без
      исключения; запрос к адресу не из `WORFY_UPDATE_API` невозможен (счётчик заглушки = все запросы).
- [x] Contract test состояния: файл во временной папке данных пишется и читается; битый — в стороне.
- [x] Версия Available update — `<version из package.json заглушки>+<7 символов SHA>`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/update-check.test.ts` (новый): решение по ответам без сети.
- Contract `test/contract/update-github.test.ts` (новый): клиент против `test/update-stub.ts`.
- Contract `test/contract/update-state.test.ts` (новый): файл во временной папке данных.
- Сначала падающий: сравнение только с `docs/a.md` даёт Available update.

## Где в коде

- `src/main/update/github.ts` (новый)
- `src/main/update/check.ts` (новый)
- `src/main/update/state.ts` (новый)
- `src/main/update/stable-copy.ts` (новый)
- `src/shared/ipc/update.ts` (новый), `src/main/ipc/update.ts` (новый)
- `src/renderer/update/store.ts` (новый)
- `src/main/index.ts` — старт и остановка расписания
- `test/update-stub.ts` (новый)
- `test/unit/update-check.test.ts` (новый)
- `test/contract/update-github.test.ts` (новый)
- `test/contract/update-state.test.ts` (новый)

Только читать: `scripts/install-stable.mjs`, `scripts/build-version.ts`, `src/main/harness/bundled.ts`,
`src/main/autopilot/harness-drift.ts`, `src/main/storage/paths.ts`, `src/main/storage/json-file.ts`.

## Итог

- Новый модуль `src/main/update/`: `stable-copy.ts` (путь Stable copy как `defaultTarget` скрипта,
  `WORFY_UPDATE_STABLE`, `updateEnabled`, запущенный commit из `<target>.json` или из build version),
  `github.ts` (четыре чтения GitHub API без входа через `WORFY_UPDATE_API`, без `Authorization`, таймаут
  15 s, сбой — `skipped` с причиной), `check.ts` (решение Р2–Р4, пометка `quiet` после отката,
  расписание `UpdateChecks`: через 10 s и раз в час, одна проверка за раз), `state.ts`
  (`<dataRoot>/update/state.json`, схема всего Epic-а, у каждого поля пустое значение по умолчанию).
- Домен IPC `update` (`update.state`, `update.check`, событие `update.changed`, все `local`), store
  `src/renderer/update/store.ts`; `src/main/index.ts` запускает проверки и останавливает их на `will-quit`.
  Вне Stable copy без `WORFY_UPDATE=1` — `enabled: false`, файл состояния не читается и не пишется.
- Чтения идут по порядку, который тратит меньше запросов: голова `main` = запущенный commit — одна
  проверка стоит один запрос.
- `test/update-stub.ts` — локальный HTTP-сервер с ответами четырёх чтений и списком запросов;
  `assertTemporaryStableCopy` отказывает пути Stable copy вне временной папки. Чтобы test-ы проверялись
  `tsc`, файл добавлен в `tsconfig.test.node.json` (вне «Где в коде»).
- Test-ы: `test/unit/update-check.test.ts`, `test/contract/update-github.test.ts`,
  `test/contract/update-state.test.ts`.
