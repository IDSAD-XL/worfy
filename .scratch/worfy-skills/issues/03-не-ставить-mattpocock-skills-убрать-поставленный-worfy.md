# 03 — Не ставить `mattpocock-skills`; при обновлении убрать plugin, поставленный worfy

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 4; «Как работает» → «Зависимость больше не ставится», «Удаление plugin-а, поставленного worfy»; «Решено без владельца», п. 4, 5; «Риски», п. 1, 2; «Вопросы владельцу», Q5; [ADR-0059](../../../docs/adr/0059-installer-installs-plugin-dependencies.md), п. 4, 5, 7, 8

Платформенный Ticket: установщик Harness зовёт `claude` и `codex` на Mac и Windows — Windows verdict до merge
(ADR-0056). Глубина ревью — `high`: Ticket удаляет чужой plugin из настроек пользователя; пробел в test-ах удаления
держит merge.

Ждёт 01: skills должны быть внутри plugin-а `worfy` раньше, чем уйдёт зависимость.

## Что происходит

- `harness/.claude-plugin/plugin.json:7` — `"dependencies": ["mattpocock-skills@claude-plugins-official"]`.
- Claude Code: установщик строит команды зависимости (`src/main/harness/install.ts:812-826`) и зовёт
  `claude plugin install <id> --scope user` до копии Harness (ADR-0059, п. 4). О том, что зависимость поставил worfy,
  он ничего не записывает: сам он пишет только копию Harness (`install.ts:23`).
- Codex: зависимость ставится отдельным plugin-ом (`src/main/harness/codex-install.ts:329-339`, `:372-374`); запись
  `harness-codex.json` в папке данных worfy (`src/main/ipc/harness.ts:109`) хранит только `{ version }`
  (`codex-install.ts:415-418`).
- Claude Code сам хранит у каждого plugin-а `installedAt` и `lastUpdated` (`plugins/installed_plugins.json`). Отдаёт ли
  их `claude plugin list --json` — не проверено; stub test-ов отдаёт `id`, `version`, `scope`, `enabled`, `errors`
  (`test/e2e/claude-plugin-stub.ts:15`).
- Установка после Update идёт без второго окна (`src/main/update/harness-after-update.ts`, ADR-0089); Update Harness из
  toolbar — с окном согласия.
- Строка первого запуска «Plugin dependencies» при пустом списке — `none` (`src/main/first-run/checks.ts:602-604`).
- Test-ы, которые берут настоящий `harness/` с зависимостью: `test/contract/harness-plugin.test.ts:43-48`,
  `test/e2e/harness-install.spec.ts:165-171`, `:277-302`, `test/e2e/first-run.spec.ts:31`, `test/acceptance/e3.spec.ts:514`.
  Contract-test-ы установщика строят свою копию (`makeBundle`, `test/contract/harness-install.test.ts:85-97`).

## Что делаем

1. **Первый шаг — проверка, итог в «Итог» до кода:** где worfy прочтёт `installedAt` обоих plugin-ов — в
   `claude plugin list --json` встроенного Claude Code (по типам и документации SDK, без настоящего вызова на машине
   владельца) или в `plugins/installed_plugins.json` (только чтение); есть ли время установки у Codex (по протоколу в
   `src/main/vendors/codex/protocol/` и документации). Настоящий Codex не запускать.
2. `plugin.json` — без `dependencies`. Механизм ADR-0059 в коде остаётся; test-ы, которым нужна зависимость, берут
   fixture-копию Harness с одной зависимостью нейтрального имени.
3. **`src/main/harness/dependency-cleanup.ts`** (новый): после того как Harness этой версии встал (установка после
   Update и Update Harness из toolbar), по правилу Q5 (подтверждено владельцем 2026-11-07) решает, удалять ли `mattpocock-skills@claude-plugins-official`, и
   зовёт `claude plugin uninstall … --scope user`. Сначала — запись worfy о своей установке (шаг 4),
   без неё — окно 10 минут по `installedAt` (spec). Нет даты, дата не читается, plugin не в списке — ничего не делать. Ошибка удаления — строка в
   итоге, Harness остаётся установленным. Marketplace не трогать. Канал — `local` (ADR-0052, п. 6).
4. **Запись своих установок** (Q5, добавлено владельцем 2026-11-07): с этой версии каждая установка plugin-а
   зависимости, которую сделал worfy (Claude Code и Codex), записывается в папку данных worfy — id, Vendor, время —
   рядом с `harness-codex.json`. Механизм ADR-0059 остаётся, так что запись нужна для будущих зависимостей.
5. Итог Update Harness называет удалённый plugin и команду, чтобы вернуть его.
6. Codex — по Q5 (подтверждено владельцем 2026-11-07) и итогу шага 1: то же правило, если есть время установки или
   запись worfy; иначе plugin остаётся.
7. `scripts/eval-harness.mjs` — комментарий и строка вывода про копию «без dependencies»; `src/shared/agent/subagent-type.ts:21`
   — пример чужого plugin-а нейтральным именем.

## Готово, когда

- [ ] В «Итог» — откуда worfy читает `installedAt` (Claude Code) и есть ли время установки у Codex, с версией и
      местом, где искал.
- [ ] Test: установка на пустом stub-е не зовёт ни одной команды `mattpocock-skills` и marketplace
      `claude-plugins-official`; строка «Plugin dependencies» — `none`.
- [ ] Test: `installedAt` зависимости за 2 минуты до `worfy@worfy-harness` — после Update ровно одна команда
      `plugin uninstall mattpocock-skills@claude-plugins-official --scope user`, после установки `worfy`, не до неё.
- [ ] Test: зависимость поставлена раньше окна, позже `worfy`, без даты, дата не читается, plugin не в списке — ни
      одной команды удаления.
- [ ] Test: `uninstall` упал — Harness `installed`, в итоге строка с хвостом stderr; повтор на следующем Update.
- [ ] Test: Linked machine удаление не запускает.
- [ ] Test Codex: fake Codex с временным `CODEX_HOME` — без времени установки и без записи worfy plugin остаётся.
- [ ] Test: установка зависимости из fixture-копии пишет запись worfy (Claude Code и Codex); plugin с записью worfy
      удаляется без окна времени, запись без plugin-а в списке — ничего.
- [ ] Contract и e2e установщика зелёные на fixture-копии с зависимостью; `test/contract/harness-plugin.test.ts`
      проверяет, что у настоящего `plugin.json` зависимостей нет.
- [ ] Windows: contract-test-ы установщика и `test/e2e/harness-install.spec.ts` — exit 0.
  - needs: windows
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный (Linux, macOS и Windows job-ы).

## Тесты

- Contract `test/contract/harness-dependency-cleanup.test.ts` (новый): правило, порядок команд, ошибки, Linked machine.
- Contract `test/contract/harness-install.test.ts`, `harness-codex-install.test.ts`, `first-run-checks.test.ts`,
  `harness-plugin.test.ts`; unit `test/unit/harness-codex-manifest.test.ts`, `harness-status.test.tsx`,
  `subagent-type.test.ts`; e2e `test/e2e/harness-install.spec.ts`, `first-run.spec.ts`; acceptance
  `test/acceptance/e3.spec.ts`.
- Сначала падающий: «установка на пустом stub-е не зовёт `mattpocock-skills`» — красный на `main`.
- Stub `claude` и fake Codex; ни одного обращения к настоящему `~/.claude` или `~/.codex`.

## Где в коде

- `harness/.claude-plugin/plugin.json`
- `src/main/harness/install.ts`
- `src/main/harness/codex-install.ts`
- `src/main/harness/dependency-cleanup.ts` (новый)
- `src/main/update/harness-after-update.ts`
- `src/main/ipc/harness.ts`
- `src/shared/ipc/harness.ts`
- `src/shared/agent/subagent-type.ts`
- `scripts/eval-harness.mjs`
- `test/contract/harness-plugin.test.ts`
- `test/contract/harness-install.test.ts`
- `test/contract/harness-codex-install.test.ts`
- `test/contract/harness-dependency-cleanup.test.ts` (новый)
- `test/contract/first-run-checks.test.ts`
- `test/unit/harness-codex-manifest.test.ts`
- `test/unit/harness-status.test.tsx`
- `test/unit/subagent-type.test.ts`
- `test/e2e/harness-install.spec.ts`
- `test/e2e/first-run.spec.ts`
- `test/e2e/claude-plugin-stub.ts`
- `test/acceptance/e3.spec.ts`
- `test/fixtures/first-run-tools/README.md`

Только читать: `src/main/first-run/checks.ts`, `src/main/vendors/codex/protocol/`, `docs/adr/0059-installer-installs-plugin-dependencies.md`,
`test/unit/agent-options.test.ts` и `test/contract/workflow-profile.test.ts` (там `mattpocock-skills` — пример plugin-а
пользователя, он остаётся), `test/fixtures/claude-home-legacy/` (старый Harness).

## Итог

Ветка `worfy-skills/03`.

### Откуда worfy читает время установки (шаг 1, до кода)

- **Claude Code** — `claude plugin list --json` встроенного Claude Code 2.1.289 (SDK
  `@anthropic-ai/claude-agent-sdk` 0.3.289, `claudeCodeVersion` в его `package.json`). Проверено без запуска, по строкам
  бинарника `@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`: вывод `plugin list` собирает у каждой записи
  `{ id, version, scope, enabled, installPath, …, installedAt, lastUpdated, projectPath, … }`; схема записи
  `installed_plugins.json` в `sdk.mjs` описывает `installedAt` как «ISO 8601 timestamp of installation». `plugin update`
  сохраняет `installedAt` прежней записи (`installedAt: … ?? new Date()` в коде обновления). `plugins/installed_plugins.json`
  worfy не читает: хватает того же `plugin list`, который installer уже зовёт.
- **Codex** — времени установки для plugin-а из marketplace нет. `codex plugin list --json` Codex 0.166.0
  (`test/fixtures/codex-cli/plugin-list-0.166.0.json`) поля не отдаёт; в протоколе app-server
  (`src/main/vendors/codex/protocol/ts/v2/PluginSummary.ts`, версия протокола 0.166.0) `installedAt: number | null` —
  «Unix timestamp in seconds when the remote plugin was installed», только у remote plugin-ов. Поэтому в Codex решает
  только запись worfy; если `plugin list` когда-нибудь отдаст `installedAt` (секунды), действует то же окно. Команда
  удаления — `codex plugin remove <id>` (help-текст в бинарнике 0.166.0: «Uninstall a plugin and remove its local cache»).
  Настоящий Codex не запускался.

### Что сделано

- `harness/.claude-plugin/plugin.json` — без `dependencies`; механизм ADR-0059 в коде остался, его test-ы берут
  fixture-копию с зависимостью `example-skills@claude-plugins-official` (contract — `makeBundle`, e2e — копия
  `out/harness` через `WORFY_HARNESS_BUNDLE`, которую читает только не упакованный запуск).
- `src/main/harness/dependency-cleanup.ts` — правило Q5: сначала запись worfy (`harness-dependencies.json` в папке
  данных worfy, рядом с `harness-codex.json`; id, Vendor, время), без неё — окно 10 минут до `installedAt` у
  `worfy@worfy-harness`. Запускается только после `plugin update` уже установленного `worfy` (Update Harness из toolbar и
  установка после Update), никогда на первой установке и не до `worfy`. Marketplace не трогается. Ошибка удаления —
  строка в итоге (`status.cleanup`), Harness остаётся `installed`, следующий Update пробует снова.
- Toolbar после такого Update пишет `· removed mattpocock-skills` (tooltip — команда возврата) или
  `· could not remove mattpocock-skills` (tooltip — вывод команды).

### Решено без владельца

1. **Строго раньше `worfy`.** Spec: «не раньше чем за 10 минут до и не позже». Время, равное времени `worfy`, не
   считается установкой worfy: installer ставил зависимость раньше, а одинаковое время у двух записей оставляет
   инструмент, который переписал все записи разом. Ошибка в безопасную сторону.
2. **Повторного `plugin list` нет, если удаляемого plugin-а не было в списке до установки** — Update без него идёт
   прежними командами.
3. **Запись в Codex с другим Vendor не считается** — запись `codex` не удаляет plugin из Claude Code, и наоборот.
4. `src/renderer/shell/toolbar/HarnessStatus.tsx` и `test/contract/harness-evals-run.test.ts` вне раздела «Где в коде»:
   первый показывает итог (п. 5 «Что делаем»), второй проверял, что у настоящего `plugin.json` есть `dependencies`.
   `docs/features/harness.md` — абзац об удалении и строка о зависимости.

### Сначала падающий test

На `main` (до правки `plugin.json`) красные: `test/contract/harness-plugin.test.ts` «declares no dependencies» и
`test/contract/first-run-checks.test.ts` «the Harness of this repository (worfy-skills 03): Install on an empty stub
runs no command for mattpocock-skills…» — 2 failed, exit 1; после правки — exit 0.
