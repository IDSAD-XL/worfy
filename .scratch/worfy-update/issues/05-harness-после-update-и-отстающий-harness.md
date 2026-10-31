# 05 — Harness новой копии после Update и отстающий Harness того же semver

Type: task
Status: open
Blocked by: 04
Source: решения владельца 2026-10-31, пункты 4 (Harness новой копии без второго диалога; «Update Harness» остаётся; действует со следующей Session), 5 (сигнал «Harness out of date»); [spec.md](../spec.md), «Как устроено», «Решено без владельца», Р8, Р10; [ADR-0089](../../../docs/adr/0089-update-builds-main-in-own-clone.md), пункт 5

## Что происходит

- Harness копии — `bundledHarnessVersion` (`src/main/harness/bundled.ts:25`). Установщик —
  `HarnessInstaller` (`src/main/harness/install.ts:396`): `status()` (`:407`) и `install(confirm)` (`:422`);
  `confirm` получает план и спрашивает пользователя диалогом (`src/main/ipc/harness.ts`).
- После Ticket-а 04 новая копия стартует с `update/restart.json` `{ action, version, sha, harness: true }`.
- Версии одного semver из разных commit-ов worfy не упорядочивает: `compareHarnessVersions` →
  `unordered` (`install.ts:233-243`), toolbar показывает «Replace Harness»
  (`src/renderer/shell/toolbar/HarnessStatus.tsx:147-151`). У Stable copy обычно так и есть: semver в
  `package.json` меняется редко.
- Поле `harnessBehind` состояния Update (Ticket 01) никто не заполняет.

## Что делаем

1. `src/main/update/harness-after-update.ts` (новый): при старте, если `restart.json` есть, его `version`
   равна `bundledHarnessVersion()`, а `status()` — `outdated` или `not-installed`, — `install(() =>
   Promise.resolve(true))` без диалога. Итог: `done` — `restart.json` удаляется; ошибка — состояние
   Harness `error` (строка Health и кнопка Retry — как сейчас), в состоянии Update `harnessAfterUpdate:
   'failed'` для toast-а Ticket-а 07, `restart.json` удаляется (второй попытки без нажатия нет). `version`
   не равна Harness копии (копия другая, откат не удался) — `restart.json` удаляется, ничего не ставится.
2. То же для `action: 'rollback'` (Р8): ставится Harness откатанной копии.
3. `src/main/update/harness-lag.ts` (новый, Р10): при `updateEnabled` и `outdated` с `sameVersion`
   сравнение GitHub `compare/<SHA установленного>...<SHA копии>` (клиент Ticket-а 01); `status: ahead` —
   `harnessBehind { from, to }`. Semver Harness ниже, чем у копии (`newer`), — `harnessBehind` без запроса.
   Не ответил GitHub — `null`. Повтор — с проверкой Update, не чаще раза в час.
4. `src/main/index.ts`: оба шага после старта установщика Harness.

## Готово, когда

- [ ] Contract test (песочница `WORFY_CLAUDE_HOME`, подменный `claude` установщика, как в
      `test/contract/harness-install.test.ts`): `restart.json` с версией копии и Harness `outdated` —
      install без вызова диалога; `restart.json` удалён.
- [ ] Contract test: `restart.json` с другой версией — install не зовётся.
- [ ] Contract test: install падает — `harnessAfterUpdate: 'failed'`, второй попытки нет после перезапуска.
- [ ] Contract test: `action: 'rollback'` — ставится Harness откатанной копии.
- [ ] Unit test `harness-lag`: `sameVersion` и `ahead` из заглушки — `harnessBehind`; `behind` —
      `null`; заглушка не отвечает — `null`; `newer` — без запроса к заглушке.
- [ ] Без `restart.json` поведение установщика прежнее: существующие test-ы `harness-install` зелёные.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Contract `test/contract/update-harness.test.ts` (новый).
- Unit `test/unit/update-harness-lag.test.ts` (новый): ответы `test/update-stub.ts`.
- Сначала падающий: `restart.json` с версией копии — install не зовётся.

## Где в коде

- `src/main/update/harness-after-update.ts` (новый)
- `src/main/update/harness-lag.ts` (новый)
- `src/main/index.ts` — порядок запуска после установщика Harness
- `test/contract/update-harness.test.ts` (новый)
- `test/unit/update-harness-lag.test.ts` (новый)

Только читать: `src/main/harness/install.ts`, `src/main/harness/bundled.ts`, `src/main/ipc/harness.ts`,
`src/main/update/github.ts`, `src/main/update/state.ts`, `test/contract/harness-install.test.ts`.

## Итог

Заполняется при закрытии.
