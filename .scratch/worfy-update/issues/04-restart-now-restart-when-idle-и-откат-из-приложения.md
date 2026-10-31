# 04 — «Restart now», «Restart when idle» и откат из приложения

Type: task
Status: open
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

- [ ] Unit test `idle`: Session `busy` — `false`; `needs_permission` — `false`; `idle` с background task —
      `false`; `Autopilot.anyRunning()` — `false`; всё стихло — `true`; переход вызывает подписчика один раз.
- [ ] Unit test: `restart('idle')` при занятой Session — ничего; Session закончила ход — `restart('now')`
      ровно один раз; `cancel` до этого — ни одного.
- [ ] Contract test (подменённые `spawn` и `app.quit`): `restart('now')` запускает `node` с аргументами
      выше, `detached`, после этого — `quit`; без `ready` и не при `idle` — отказ, ничего не запущено.
- [ ] Contract test: `rollback()` с ответом диалога «Cancel» — ничего; «Roll back» — `--rollback`.
- [ ] Contract test: `result.json` при старте даёт `lastRestart` и удаляется; отказ скрипта — `ok: false`
      с причиной.
- [ ] (вручную) dev-сборка с `WORFY_UPDATE=1`, Stable copy во временной папке: «Restart now» — worfy
      закрылся, копия заменена, `worfy-stable.previous` есть, копия запустилась.
- [ ] Платформенный PR (ADR-0056, пункт 2; ADR-0086; процесс detached и запуск копии на Windows): вердикт
      Windows по `scripts/windows-verdict-scope.mjs`.
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

Заполняется при закрытии.
