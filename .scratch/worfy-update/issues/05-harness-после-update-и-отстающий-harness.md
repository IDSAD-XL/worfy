# 05 — Harness новой копии после Update и отстающий Harness того же semver

Type: task
Status: done 2026-10-31T10:32Z
PR: #1123
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

- [x] Contract test (песочница `WORFY_CLAUDE_HOME`, подменный `claude` установщика, как в
      `test/contract/harness-install.test.ts`): `restart.json` с версией копии и Harness `outdated` —
      install без вызова диалога; `restart.json` удалён.
- [x] Contract test: `restart.json` с другой версией — install не зовётся.
- [x] Contract test: install падает — `harnessAfterUpdate: 'failed'`, второй попытки нет после перезапуска.
- [x] Contract test: `action: 'rollback'` — ставится Harness откатанной копии.
- [x] Unit test `harness-lag`: `sameVersion` и `ahead` из заглушки — `harnessBehind`; `behind` —
      `null`; заглушка не отвечает — `null`; `newer` — без запроса к заглушке.
- [x] Без `restart.json` поведение установщика прежнее: существующие test-ы `harness-install` зелёные.
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

- `src/main/update/harness-after-update.ts`: при старте копии `restart.json` читается и помечается `harnessTaken: true` **до** install — один раз; вторая попытка без нажатия невозможна, даже если worfy упал во время install. Файл не удаляется (ревью #1123, раунд 1): по нему `previousCopy` называет прошлую копию `<semver>+<short SHA>` в диалоге отката и в Settings; следующий restart перезаписывает запись без пометки. Поле `harnessTaken` добавлено в `restartRecordSchema` (`src/main/update/restart.ts`). Install без диалога (`confirm` → `true`) идёт через `appInstaller()` — тот же единственный установщик, что у toolbar и first-run screen, поэтому два install не идут одновременно. Ошибка install (состояние `error` или отказ `install()`) → `harnessAfterUpdate: 'failed'`; успешный install сбрасывает это поле в `null`. Install из toolbar, начатый в это же время, общий: Cancel в его диалоге → `declined`, Harness не трогается и `harnessAfterUpdate` не ставится (решено без владельца: ответ пользователя важнее согласия нажатия restart); `nothing-to-do` → `current`.
- Копия из `restart.json` узнаётся по `version` **или по commit** из build version (`<semver>+<SHA>`). Решено без владельца: только по `version` откат почти всегда промахивается — после первого Update `restart.json` удалён, и `previousCopy` называет прошлую копию коротким SHA (`aaaaaaa`), а не `0.3.0+aaaaaaa`.
- `src/main/update/harness-lag.ts`: `harnessBehind` — для `outdated` с `sameVersion` через `compare/<SHA установленного>...<SHA копии>` (`ahead` → сигнал), для `newer` без запроса; ошибка GitHub → `null`. Один commit с `.dirty` с одной стороны — без запроса, `null`.
- Решено без владельца: проверка отставания идёт на своём таймере с периодом проверки Update (`CHECK_EVERY_MS`, раз в час), первый раз — когда закончился install этого старта, и ещё раз после каждого install с ответом `done` (`onHarnessInstalled` в `src/main/ipc/harness.ts`), так что `harnessBehind` гаснет сразу после «Update Harness». Запрос во время идущей проверки — ещё одна проверка после неё (та могла прочитать Harness до install). `src/main/ipc/update.ts` не менялся; «Check now» проверку не запускает.
- `src/main/index.ts`: оба шага — сразу после `startUpdateChecks()` (тот уже прочитал результат прошлого restart через `settleLastRestart`), не ждут первого окна и не ломают старт; только при включённом Update.
- `docs/features/harness.md`: два абзаца — install после Update без диалога и проверка «Harness out of date».
- Test-ы: contract `test/contract/update-harness.test.ts` (18, песочница `WORFY_CLAUDE_HOME`, подменный `claude`; в том числе settle → install → settle сохраняет имя прошлой копии), unit `test/unit/update-harness-lag.test.ts` (12, ответы `test/update-stub.ts`, fake timers), wiring `test/contract/update-harness-wiring.test.ts` (4, порядок в `src/main/index.ts`). Mutant-ы: 16 первого раунда и 14 раунда ревью — все красные.

- Low из review (debt, Ticket-ами не становятся): ветка «пометку `harnessTaken` не удалось записать» (`harness-after-update.ts:79-82`) без test-а. Решено без владельца: установка, присоединившаяся к установке из toolbar, при Cancel — `declined`, без установки и без признака сбоя; проверка отставания Harness — по своему часовому таймеру и после каждой установки с `done`, «Check now» её не запускает.
