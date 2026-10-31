# 13 — Успех Update не показывается, когда запущена не та копия

Type: bug
Status: done 2026-10-31T12:45Z
PR: #1134
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

- [x] Unit test: `restart.json` install на `B`, `result.json` ok, запущен `A` — `lastRestart.ok === false`
      с причиной, `rolledBackFrom === B`, Available update `B` — `quiet: true`; toast — текст ошибки, не успеха.
- [x] Unit test: тот же случай, запущен `B` — прежнее поведение (успех, `rolledBackFrom: null`).
- [x] Unit test: с «Update automatically» после такого старта `auto` не собирает `B` снова.
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

- `settleLastRestart` (`src/main/update/restart.ts`) получает `running` (запущенная копия); `Restarts.settle` берёт его
  из `running()` опций. `restart.json` — install на `B`, `result.json` — `ok: true`, а запущенный commit не равен `B`
  (`sameCommit`, короткий SHA тоже считается): `lastRestart` = `{ ok: false, action: 'install', version: <B>,
  reason: '<запущенная версия> runs instead: the new copy did not start, or was rolled back by hand', at }`,
  `rolledBackFrom = B`, Available update `B` — `quiet: true`, сборка `B` — `idle`. Ветка общая с откатом из
  приложения: commit, с которого откатились или который не вступил в силу, — `done`.
- Запущен `B` или commit неизвестен (`''`) — прежнее поведение (успех, `rolledBackFrom: null`).
- Toast — прежний текст ошибки (`toasts.ts` не менялся): «worfy was not updated to <B>: <A> runs instead: the new copy
  did not start, or was rolled back by hand». Settings с `rolledBackFrom` пишет «worfy is back to <A>…».
- Test-ы: `test/unit/update-restart-not-taken.test.ts` (7: запущен A полным и коротким SHA, запущен B полным и коротким,
  commit неизвестен, «Update automatically» не собирает B — ни по состоянию, ни после следующей проверки с
  `rolledBackFrom`, при запущенном B следующий commit собирается); toast — в `test/unit/update-toasts.test.tsx`.
  Сначала падал: запущен A, `lastRestart.ok === true` (toast успеха). 7 мутантов `restart.ts` — все красные.
- Отклонение от тикета: test-ы `settleLastRestart` Ticket-а 04 лежат в `test/contract/update-restart.test.ts`, а не в
  `test/unit/update-restart*.test.ts`; новый файл — в `test/unit/` по следу брифа. Проверка toast-а — отдельно в
  `.tsx`: test-проект renderer-а (`tsconfig.test.web.json`) не видит `src/main`.
- Ревью: VERIFIED (Orchestrator, high), круг полировки — перевод в `ru/updates.md`. Low (не Ticket): test toast-а
  держит текст причины литералом, смена причины в `restart.ts` его не покрасит. Вне Ticket-а: новая копия, упавшая
  уже после чтения `result.json`, по-прежнему не «тихая» — страница говорит это прямо.
