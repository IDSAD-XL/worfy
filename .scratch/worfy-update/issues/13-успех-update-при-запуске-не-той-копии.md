# 13 — Успех Update не показывается, когда запущена не та копия

Type: bug
Status: claimed 2026-10-31T12:07Z
Branch: worfy-update/13
Blocked by: 04, 07
Source: находка implementer-а Ticket-а 11 (out of scope), подтверждена чтением кода 2026-10-31; [spec.md](../spec.md), R8 (commit, с которого откатились, «тихий» до следующего)

## Что происходит

- Перед restart-ом в Update worfy пишет `restart.json` `{action: 'install', sha: <новый>, from: <старый>}` и
  удаляет старый `result.json` (`src/main/update/restart.ts`, около `:311`). Helper `scripts/install-stable.mjs`
  последним шагом, уже после замены копии и запуска новой, пишет `result.json` `{ok: true, action: 'install'}`.
- `settleLastRestart` (`src/main/update/restart.ts:104`) при старте читает оба файла. `ours` сравнивает только
  `action` (`:119`). Какой commit запущен на самом деле, функция не знает: `running()` есть в `RestartsOptions`
  (`:184`), но в `settleLastRestart` не передаётся (`:225`).
- Сценарий: новая копия падает при запуске, до `settle()`. `result.json` с `ok: true` остаётся. Владелец
  откатывается руками (`node scripts/install-stable.mjs --rollback` без `--result`); этот путь `restart.json`
  и `result.json` не трогает. Старая копия стартует и:
  - показывает toast «worfy updated to <новая версия>…» (`src/renderer/update/toasts.ts:69-73`), хотя работает
    старая версия;
  - ставит `rolledBackFrom: null` (`restart.ts:136`), так что Settings не пишет «worfy is back to …»
    (`src/renderer/settings/UpdatesBlock.tsx:64`);
  - не делает упавший commit «тихим»: с «Update automatically» (`src/main/update/auto.ts:15`,
    `src/main/update/check.ts:71`) worfy снова собирает и ставит тот же commit, который падает. Это петля.
- Откат из приложения («Roll back», `restart.ts:242-279`) этим не страдает: у него `action: 'rollback'`.

## Что делаем

1. `settleLastRestart` получает запущенный commit (из `running()` опций `Restarts`).
2. `record.action === 'install'`, `result.json` говорит `ok: true`, но запущенный commit не равен `record.sha`
   (`sameCommit`): Update не вступил в силу. Тогда:
   - `lastRestart` = `{ ok: false, action: 'install', version: <новая>, reason: <причина> }`; причина говорит,
     что запущена прежняя копия (`<запущенная версия>`), а не `<новая>`;
   - `rolledBackFrom = record.sha`, и Available update с этим SHA становится `quiet: true` — как после отката
     из приложения (R8);
   - `build` с этим SHA — в `idle`, как сейчас.
3. Запущенный commit равен `record.sha` — поведение прежнее. Запущенный commit неизвестен (dev-сборка без
   commit-а) — поведение прежнее.

## Готово, когда

- [ ] Unit test: `restart.json` install на `B`, `result.json` ok, запущен `A` — `lastRestart.ok === false`
      с причиной, `rolledBackFrom === B`, Available update `B` — `quiet: true`; toast — текст ошибки, не успеха.
- [ ] Unit test: тот же случай, запущен `B` — прежнее поведение (успех, `rolledBackFrom: null`).
- [ ] Unit test: с «Update automatically» после такого старта `auto` не собирает `B` снова.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit — рядом с test-ами `settleLastRestart` Ticket-а 04 (`test/unit/update-restart*.test.ts`) и `auto`.
- Сначала падающий: запущен `A`, а toast говорит «worfy updated to B».

## Где в коде

- `src/main/update/restart.ts` (`settleLastRestart`, `Restarts.settle`)
- `src/main/update/auto.ts`, `src/main/update/check.ts` — только читать
- `src/renderer/update/toasts.ts` — только если текст причины требует правки
- `test/unit/` — test-ы `restart` и `auto`

## Итог
