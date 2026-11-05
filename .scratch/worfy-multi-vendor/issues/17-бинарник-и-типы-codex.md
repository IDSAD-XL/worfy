# 17 — Бинарник Codex, типы протокола и capabilities Codex

Type: task
Status: done 2026-11-02T14:38Z
PR: #1247
Blocked by: 13
Source: [spec.md](../spec.md), «Codex: бинарник и совместимость», «Windows», «Риски», п. 7; решение 06 ([06-граница-vendor.md](06-граница-vendor.md), «Codex ведётся через `codex app-server`»); Ticket 02 ([02-codex-управление-сессией.md](02-codex-управление-сессией.md), поставка и лицензия); [ADR-0008](../../../docs/adr/0008-claude-code-native-binary-path.md); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что происходит

- Claude Code приходит native binary-ем платформенного пакета SDK, распакованным из `app.asar`
  (`electron-builder.yml:43-52`, `package.json:29`); путь — `claudeExecutablePath` (после Ticket-а 13 —
  `src/main/vendors/claude/options.ts`).
- Codex: npm `@openai/codex` (Apache-2.0) с бинарниками по платформам через `optionalDependencies` (darwin-arm64/x64,
  win32-x64/arm64); типы протокола — `codex app-server generate-ts`, «each output is specific to the Codex version».

## Что делаем

1. `@openai/codex` в `dependencies` с точной версией — последняя stable на момент claim. Платформенные пакеты — в
   `asarUnpack`. LICENSE и NOTICE Codex — в ресурсах сборки.
2. `src/main/vendors/codex/binary.ts` — `codexExecutablePath(runtime)` (packaged — из `app.asar.unpacked`, иначе —
   из `node_modules`; `codex.exe` на Windows), по образцу `claudeExecutablePath`.
3. `scripts/codex-protocol.mjs` — запускает закреплённый Codex дважды: `codex app-server generate-ts --out …`
   (типы TypeScript) и `codex app-server generate-json-schema --out …` (JSON Schema того же протокола; команда есть в
   `rust-v0.166.0`, `codex-rs/cli/src/main.rs:647`, `:735`). Оба вывода — в `src/main/vendors/codex/protocol/`
   (`ts/`, `json/`) с файлом `VERSION`. Без `--experimental`. `pnpm lint` сверяет `VERSION` с версией в
   `package.json` (скрипт без запуска Codex). Схемы руками не пишутся и не правятся.
   Проверка сообщений во время работы — `ajv` (прямая зависимость с точной версией) по этим JSON Schema; её
   применяют Ticket-ы 18, 19, 30.
4. `src/main/vendors/codex/capabilities.ts` — статические capabilities Codex: `steer`, `resume`, `limitWindows`,
   `slashCommands` — да; `inProcessMcp`, `canvasTools`, `subagents` (до второго выпуска) — нет, с причинами для
   tooltip; presets «Read only», «Auto», «Full access» (approval policy + sandbox).
5. `src/main/vendors/codex/index.ts` — driver Codex из файлов частей `session.ts`, `account.ts`, `limits.ts`,
   `history.ts`, `commands.ts`, `mcp.ts`; каждая часть пока — stub, который отвечает «not available yet».
   Ticket-ы 20, 21, 22, 33 заменяют только свой файл части, `index.ts` не правят. `vendorDriver('codex')` в
   реестре. В интерфейсе Codex не появляется до Ticket-а 24.
6. В PR — размер сборки до и после.

Глубина review — `high` (driver Codex). Платформенный: упаковка и путь с веткой по платформе.

## Готово, когда

- [ ] Unit test пути бинарника: packaged и dev, macOS и Windows (разделители и `codex.exe`), как test-ы
      `claudeExecutablePath`.
- [ ] Unit test проверки `VERSION`: несовпадение с `package.json` — красный.
- [ ] В `protocol/json/` лежит bundle JSON Schema закреплённой версии; `ajv` компилирует его без ошибок (test).
- [ ] Unit test capabilities Codex: три presets, недоступное — с причиной.
- [ ] `pnpm build` на Mac кладёт бинарник Codex в `app.asar.unpacked`; рост размера сборки записан в PR.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `package.json` — `:29` (рядом); `pnpm-lock.yaml`
- `electron-builder.yml` — `:43-52`
- `scripts/codex-protocol.mjs` (новый); проверка `VERSION` — в скриптах `pnpm lint`
- `src/main/vendors/codex/binary.ts`, `capabilities.ts`, `index.ts`, `session.ts`, `account.ts`, `limits.ts`,
  `history.ts`, `commands.ts`, `mcp.ts`, `protocol/ts/`, `protocol/json/` (новые)
- `src/main/vendors/registry.ts`
- Test-ы: `test/unit/codex-binary.test.ts`, `test/unit/codex-capabilities.test.ts` (новые)

Только читать: `src/main/vendors/claude/options.ts` (после Ticket-а 13; сейчас `src/main/agent/options.ts:96-130`).

## Итог

PR #1247. Ревью — комментарий PR #1247: раунд 1 (глубина high) — VERIFIED, находок high и med нет.

- `@openai/codex` 0.166.0 (npm `latest` на момент claim) и `ajv` 8.20.0 — точные версии; бинарник лежит в
  `app.asar.unpacked/node_modules/@openai/codex-darwin-arm64/…/bin/codex` и запускается (`codex-cli 0.166.0`).
- Размер `.app` на Mac вырос примерно на 346 MiB (+354 088 KiB); почти весь рост — пакет `codex-darwin-arm64`
  (`bin/codex` 257 MB, `codex-code-mode-host` 66 MB). Таблица — в описании PR. Без `codex-code-mode-host` не
  пробовали: неизвестно, что из него нужно app-server.
- Пункт «`pnpm build` кладёт бинарник в `app.asar.unpacked`»: на деле это делает `pnpm package`; `pnpm build` пишет
  только `out/`. Проверено через `pnpm package`.
- Решено implementer-ом, подтверждено владельцем 2026-11-05 (`harness` позже изменён Ticket-ом 39): `limitWindows` → `limitSource: 'windows'`; `slashCommands` →
  `commandsComplete: false` с причиной (команды только TUI в меню не попадут, Ticket 22); `hooks`, `harness`,
  `oneShotToolFree` — false; `historyList`, `modelSwitchStable` — true; `effortLevels` и `models` пустые до
  `model/list` (Ticket 20).
- `codexAjv` — strict ajv с `strictTypes: false` и `allowUnionTypes: true`: иначе сгенерированные схемы не
  компилируются.
- Consider (low): у режима генерации `scripts/codex-protocol.mjs` нет test-а — выживают mutant-ы на проверке версии,
  на коде выхода Codex и на `CODEX_HOME` (без него Codex писал бы в `~/.codex` пользователя); нужен test со
  stub-launcher-ом.
- Consider (low): test «compiles in strict ajv» (`test/unit/codex-protocol.test.ts:81`) строгость не проверяет —
  mutant `strict: false` выживает; нужен случай с неизвестным format.
- Принято (low): якорь `$` в проверке точной версии, пустые `ts/` и `json/`, границы int64/uint/uint16 в
  `schema.ts`, resolver без установленного `@openai/codex` (`binary.ts:42`) и цель linux-arm64 не закреплены test-ами;
  абсолютные размеры `.app` в PR расходятся с повтором на 12 712 KiB (прирост сходится).
- Не сделано, вне Ticket-а: `eslint` и gate не исключают сгенерированные `protocol/`; `.gitattributes` не помечает их
  `linguist-generated` (diff PR — 157 тыс. строк).
- Вердикт Windows: job `windows / full-suite` в `ci-ok` зелёный; scope `pc` (упаковка) — gate full на ПК после Wave.
