# 04 — «Restart now», «Restart when idle» и откат из приложения

Type: task
Status: claimed 2026-10-31T07:23Z
Blocked by: 02, 03
Source: решения владельца 2026-10-31, пункты 4 (нажатие — согласие на Harness), 7 (перезапуск только кнопкой; «Restart when idle», пока Session в ходе или идёт Autopilot), 9 (откат, после него автоматический Update молчит); [spec.md](../spec.md), «Как устроено», «Решено без владельца», Р5, Р6, Р7, Р8; [ADR-0089](../../../docs/adr/0089-update-builds-main-in-own-clone.md), пункты 4, 5

## Что происходит

- После Ticket-а 03 готовая сборка лежит в `appPath` (фаза `ready`). После Ticket-а 02
  `scripts/install-stable.mjs` из clone умеет `--wait-pid`, `--keep-previous`, `--rollback`, `--relaunch`,
  `--result`.
- Session в ходе — `busy` или `needs_permission` (`inTurn`, `src/main/agent/session.ts:111`); список —
  `SessionRegistry.list()` (`src/main/agent/session/registry.ts:104`), события — `observe` (`:50`),
  общий экземпляр — `sharedRegistry()` (`src/main/agent/app-registry.ts:197`); background tasks —
  `Session.backgroundTasks()` (`session.ts:221`).
- Autopilot — `Autopilot.anyRunning()` (`src/main/autopilot/run.ts:809`), экземпляр — `sharedAutopilot()`
  (`src/main/ipc/autopilot.ts:143`). Выход и так ждёт остановки run-а (`before-quit`, `:195-196`).

## Что делаем

1. `src/main/update/idle.ts` (новый): `idle()` по Р6 и подписка: поле `idle` состояния меняется по
   событиям Session-ов и Autopilot-а, без опроса чаще раза в 2 s.
2. `src/main/update/restart.ts` (новый):
   1. `restart('now')` — только при `idle` и `ready`, иначе отказ с причиной. Пишет
      `update/restart.json` `{ action: 'install', version, sha, harness: true }`, запускает detached
      системный `node <repo>/scripts/install-stable.mjs <Stable copy> --wait-pid <pid worfy>
      --keep-previous --relaunch --result <update/result.json>` с `WORFY_STABLE_PREBUILT=<appPath>`, потом
      `app.quit()`.
   2. `restart('idle')` — запоминает намерение; как только `idle` стал `true`, делает `restart('now')`.
      Новое нажатие «Restart now» или отмена (`restart('cancel')`) намерение снимает.
   3. `rollback()` — нативный диалог подтверждения (тексты spec-а), потом то же, что `now`, с
      `--rollback` вместо сборки и `restart.json` `{ action: 'rollback', … }`; при старте откатанной
      копии `rolledBackFrom` = SHA, с которого откатились (Р8). Нет `previous` — отказ.
3. При старте main читает `update/result.json` и `restart.json`: итог в состоянии (`lastRestart { ok,
   action, version, reason? }`, его показывает toast Ticket-а 07), `previous` — по
   `worfy-stable.previous.json`. Файл итога после чтения удаляется; `restart.json` остаётся для Ticket-а 05.
4. Каналы домена `update`: `update.restart { when: 'now' | 'idle' | 'cancel' }`, `update.rollback`. Оба
   `local`.

## Готово, когда

- [x] Unit test `idle`: Session `busy` — `false`; `needs_permission` — `false`; `idle` с background task —
      `false`; `Autopilot.anyRunning()` — `false`; всё стихло — `true`; переход вызывает подписчика один раз.
- [x] Unit test: `restart('idle')` при занятой Session — ничего; Session закончила ход — `restart('now')`
      ровно один раз; `cancel` до этого — ни одного.
- [x] Contract test (подменённые `spawn` и `app.quit`): `restart('now')` запускает `node` с аргументами
      выше, `detached`, после этого — `quit`; без `ready` и не при `idle` — отказ, ничего не запущено.
- [x] Contract test: `rollback()` с ответом диалога «Cancel» — ничего; «Roll back» — `--rollback`.
- [x] Contract test: `result.json` при старте даёт `lastRestart` и удаляется; отказ скрипта — `ok: false`
      с причиной.
- [ ] (вручную) dev-сборка с `WORFY_UPDATE=1`, Stable copy во временной папке: «Restart now» — worfy
      закрылся, копия заменена, `worfy-stable.previous` есть, копия запустилась.
      Не проверено: агент запущен изнутри worfy и не видит экран; ручная проверка требует собрать
      `.app`, запустить его и нажать кнопку, которой в UI до Ticket-ов 06/09 нет (только канал IPC).
      Detached запуск системного `node` с аргументами и папкой проверяет contract test «The helper
      process» (настоящий `spawn`, подменный helper).
- [ ] Платформенный PR (ADR-0056, пункт 2; ADR-0086; процесс detached и запуск копии на Windows): вердикт
      Windows по `scripts/windows-verdict-scope.mjs`.
      `windows-verdict-scope.mjs origin/main worfy-update/04` → `runner` (exit 0): вердикт — job-ы Windows
      в `ci-ok` этого PR.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/update-idle.test.ts` (новый): поддельные реестр Session-ов и Autopilot.
- Contract `test/contract/update-restart.test.ts` (новый): временная папка данных, подменённые `spawn`,
  `app.quit` и диалог.
- Сначала падающий: `restart('idle')` при занятой Session перезапускает сразу.

## Где в коде

- `src/main/update/restart.ts` (новый)
- `src/main/update/idle.ts` (новый)
- `src/shared/ipc/update.ts`, `src/main/ipc/update.ts`
- `test/unit/update-idle.test.ts` (новый)
- `test/contract/update-restart.test.ts` (новый)

Только читать: `src/main/agent/session.ts`, `src/main/agent/session/registry.ts`,
`src/main/agent/app-registry.ts`, `src/main/autopilot/run.ts`, `src/main/ipc/autopilot.ts`,
`scripts/install-stable.mjs`.

## Итог

- `src/main/update/idle.ts` (новый): `idle()` по Р6 — ни одна Session не `busy`/`needs_permission`, ни у
  одной нет background tasks, `Autopilot.anyRunning()` — `false`. `IdleWatch` пересчитывает на событиях
  `state` и `background_tasks` из `SessionRegistry.observe` и раз в 2 s (`IDLE_POLL_MS`) смотрит Autopilot;
  подписчик слышит каждое изменение один раз. Источник, который бросил, считается «работает».
- `src/main/update/restart.ts` (новый): `Restarts.restart('now' | 'idle' | 'cancel')`, `rollback(confirm)`,
  `settle()`; `RestartIntent` — намерение «Restart when idle».
  - `now`: только при `idle` и `build.phase === 'ready'` с существующим `appPath`, и если в clone есть
    `scripts/install-stable.mjs`; иначе `refused` с причиной (`busy: true`, когда что-то работает).
    Пишет `update/restart.json` `{ action, version, sha, from: { sha, version }, harness: true, at }`,
    запускает `node <update>/repo/scripts/install-stable.mjs <Stable copy> --wait-pid <pid>
    --keep-previous --relaunch --result <update>/result.json` с `WORFY_STABLE_PREBUILT=<appPath>`,
    `detached`, `windowsHide`, `cwd` = папка `update`, stdout/stderr — `update/restart.log`, потом
    `app.quit()`. Окружение — login shell (`agentEnv`) без `GH_TOKEN`/`GITHUB_TOKEN`.
  - `idle`: всё тихо — сразу `now`; иначе намерение, `restartWhenIdle: true` в снимке; на первом
    `idle = true` — `now` ровно один раз.
  - `rollback`: нет целой прежней копии (папка `worfy-stable.previous` и `.previous.json` с `commit`) —
    отказ без диалога; нативный диалог «Roll back to worfy <version>?» / «Roll back», «Cancel»; «Cancel» —
    ничего; «Roll back» — тот же helper с `--rollback`, без `WORFY_STABLE_PREBUILT`, `restart.json`
    `{ action: 'rollback', … }`.
  - При старте (`settle`): `result.json` → `lastRestart { ok, action, version, reason? }` и файл
    удаляется; `restart.json` остаётся для Ticket-а 05. `previous` — по `worfy-stable.previous.json`.
    Успешный откат — `rolledBackFrom` = `from.sha` (полный SHA), Available update этого SHA — `quiet`.
- Каналы `update.restart { when }` и `update.rollback`, оба `local`; ответ —
  `{ outcome: 'quitting' | 'waiting' | 'cancelled' } | { outcome: 'refused', reason, busy? }`.
- Гонки, у каждой test, который краснеет на своём mutant-е (14 mutant-ов, все убиты):
  повторное нажатие во время запуска получает тот же ответ, helper один; после `quitting` всё
  отказывается; `idle` и `ready` проверяются ещё раз после ожидания окружения, синхронно перед
  `spawn`; `cancel` во время ожидания окружения побеждает; `before-quit` снимает намерение, и закрытие
  Session-ов при выходе перезапуска не вызывает; отказ «что-то снова работает» оставляет намерение,
  другой отказ его снимает; тишина, вернувшаяся во время отказанной попытки, запускает её снова.
- Test-ы: `test/unit/update-idle.test.ts`, `test/contract/update-restart.test.ts` (временная папка с
  пробелом в пути, `assertTemporaryStableCopy`, подменные `spawn`, `app.quit` и диалог; один test с
  настоящим detached `node` и подменным helper-ом, который только записывает аргументы, `cwd` и
  окружение).

**Решено без владельца**

- Намерение «Restart when idle» живёт только в памяти этого запуска и видно в снимке как
  `restartWhenIdle` (новое поле снимка, не схемы состояния): после перезапуска worfy его нет.
- Выход worfy (`before-quit`) снимает намерение и запрещает новые перезапуски до конца запуска: иначе
  закрытие Session-ов при выходе дало бы «всё стихло» и поставило Update при обычном Quit.
- Отказ из-за занятости (Session начала ход, пока ждали окружение) намерение сохраняет; любой другой
  отказ (сборки нет, нет `node`) снимает его со строкой в log main.
- `rollback` тоже требует `idle`, до диалога и после него; пока открыт диалог, второе нажатие и
  «Restart now» отказываются.
- `node` найден как `.cmd` (Windows) — отказ: detached запуск без cmd.exe и без склейки строки
  команды; нужен `node.exe`.
- `cwd` helper-а — папка `update`: процесс с рабочей папкой внутри Stable copy не дал бы на Windows
  переименовать копию.
- `restart.json` получил `from { sha, version }` и `at`: откату нужен SHA, с которого уходят (Р8), а
  `previous.version` берётся из `from.version` той перезагрузки, что оставила копию (в
  `worfy-stable.previous.json` версии нет — только `commit`; без совпадения — короткий SHA).
- После успешной установки сборка этого SHA становится `idle`, `available` того же SHA — `null`,
  `rolledBackFrom` — `null`; после успешного отката сборка SHA, с которого ушли, — `idle`. Иначе
  «Restart now» предлагал бы поставить уже стоящую копию.
- Пока модули Session-ов и Autopilot не загружены, Autopilot считается работающим: ничего не
  считается тихим раньше времени.
