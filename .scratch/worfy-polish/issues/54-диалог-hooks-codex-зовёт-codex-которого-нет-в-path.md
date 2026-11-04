# 54 — Диалог «Approve the Harness hooks in Codex» велит запустить `codex`, которого нет в PATH

Type: bug
Status: open
Blocked by:
Source: владелец 2026-11-04 через Session-мост, приёмка worfy-multi-vendor 43 п. 1 (Install Harness into Codex)
на Mac Stable `b09dfab0`; на ПК то же

## Что происходит

Диалог одобрения hook-ов Harness в Codex (`src/renderer/harness/CodexHooksStep.tsx:107`, ticket worfy-multi-vendor
39) в шаге 1 пишет «Open Codex in a terminal: `codex`». Но worfy запускает только свой встроенный binary Codex
(`src/main/vendors/codex/binary.ts`: `<Resources>/app.asar.unpacked/node_modules/@openai/codex-<platform>-<arch>/
vendor/<target>/bin/codex`). Отдельно Codex у пользователя может быть не установлен: на Mac владельца
`which -a codex` ничего не находит, Codex.app нет; на ПК тоже. Встроенный binary читает тот же `~/.codex`
(`CODEX_HOME` не переопределяется), так что `/hooks`, запущенный из него, одобряет то же доверие — но пользователь
не знает его пути.

## Что делаем

1. Шаг 1 диалога показывает путь встроенного binary этой сборки (тот же, что находит `binary.ts`) с кнопкой Copy;
   на Windows — в кавычках для PowerShell (`& "C:\…\codex.exe"`). Если в PATH есть свой `codex` — можно упомянуть
   и его, но команда по умолчанию — встроенная.
2. Или кнопка «Open in Terminal», которая открывает Terminal worfy (или системный) с этим binary; выбрать одно из
   двух и записать почему в «Итог».
3. То же исправить в docs, где описан этот шаг (`docs/features/vendors.md`, `docs/features/ru/vendors.md`,
   `docs/features/harness.md`), если там написано «run `codex`».

Глубина review — `medium`. Платформенный: путь и кавычки разные на macOS и Windows.

## Готово, когда

- [ ] Unit test `CodexHooksStep`: шаг 1 показывает путь из main-процесса, Copy кладёт его в буфер; Windows-вид
      в кавычках.
- [ ] Contract test IPC, который отдаёт путь встроенного binary (или его отсутствие — тогда понятный текст).
- [ ] Все unit и contract test-ы `src/renderer/harness/` и `src/main/vendors/codex/`, `pnpm typecheck`,
      `pnpm lint` — exit 0.
