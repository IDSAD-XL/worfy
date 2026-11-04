# 12 — Electron fuses: без Node inspector и run-as-Node в собранном worfy

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Безопасность», п. 5 (известный предел до этого Ticket-а); review PR #1368 (Ticket 06)

Платформенный: меняет сборку приложения на macOS и Windows; вердикт Windows обязателен. Глубина ревью: high.

## Что происходит

- В собранном worfy Electron fuses не настроены: `electron-builder.yml` без `electronFuses`, после упаковки их никто не
  переключает (`src/main/program.ts:23-25`). Значит, `EnableNodeCliInspectArguments` и `RunAsNode` включены.
- Ticket 06 держит Auto-approval в Off, пока открыт debugging port или Node inspector (`debugAccess()` в
  `src/main/settings/store.ts`). Но Bash агента может послать `kill -USR1 <pid worfy>`: main откроет inspector на
  `ws://127.0.0.1:9229`, через `Runtime.evaluate` можно записать On в память store-а и закрыть inspector
  (`inspector.close()`). После этого `inspector.url()` пуст, проверка ничего не видит, `autoApprovalMode()` отвечает On.
- С включённым `RunAsNode` любой процесс Machine запускает бинарь worfy как Node (`ELECTRON_RUN_AS_NODE=1`), с правами и
  подписью worfy.

## Что делаем

1. Сначала найти каждое место, где собранный worfy полагается на run-as-Node или Node inspector, и перечислить их в
   «Итог». Известные на момент записи:
   - `src/main/program.ts:72` — override программы (`WORFY_GH` и др.), который кончается на `.mjs`, стартует как
     `process.execPath` с `ELECTRON_RUN_AS_NODE=1`;
   - `src/main/vendors/codex/launch.ts:56-58` — fake Codex (`WORFY_CODEX=fake`) стартует так же;
   - `scripts/vitest-electron.mjs:80`, `scripts/eval-run-env.mjs:97`, `scripts/terminal-flood-bench.mjs` — dev и test
     (не собранное приложение, но проверить, не запускают ли они собранный бинарь);
   - `test/e2e/launch-env.ts:67-71`, `test/e2e/projects-connect.spec.ts:290`, `test/e2e/packaged.spec.ts`,
     `test/e2e/helpers.ts` — e2e, в том числе запуск СОБРАННОГО приложения;
   - Harness и statusline bridge: запускают ли они бинарь worfy как Node.
   Для каждого — что ломается без fuse и чем заменить (обычный `node` с PATH, `utilityProcess.fork`, только dev).
2. Выключить fuses `EnableNodeCliInspectArguments` и `RunAsNode` в собранном приложении: `electronFuses` в
   `electron-builder.yml` или hook `afterPack` с `@electron/fuses`. Остальные fuses — по итогам п. 1, с причиной в «Итог».
3. Test: у собранного приложения эти fuses выключены — `npx @electron/fuses read --app <app>` в job-е `macos-package`
   (и в сборке Windows), либо contract test конфигурации сборки.
4. Windows — то же: сборка `.exe`, проверка fuses, вердикт Windows.
5. После слияния — в spec «Безопасность», п. 5 предел снять; Ticket 04 и 11 разблокированы этим Ticket-ом.

Не трогать `scripts/install-stable.mjs` и `src/main/update/` без согласования с orchestrator-ом (их держит другая
сессия).

## Готово, когда

- [ ] В «Итог» — список мест, где собранный worfy полагался на run-as-Node или inspector, и что с каждым сделано.
- [ ] В собранном приложении (macOS и Windows) `EnableNodeCliInspectArguments` и `RunAsNode` выключены; test это
      проверяет в CI.
- [ ] `kill -USR1 <pid>` собранного worfy не открывает inspector (ручная проверка или e2e собранного приложения).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный, вердикт Windows зелёный.

## Где в коде

- `electron-builder.yml`, `package.json`
- `src/main/program.ts`, `src/main/vendors/codex/launch.ts`
- `test/contract/electron-fuses.test.ts` (новый) или шаг job-а `macos-package` в `.github/workflows/ci.yml`
