# 54 — Диалог «Approve the Harness hooks in Codex» велит запустить `codex`, которого нет в PATH

Type: bug
Status: claimed 2026-11-04T09:54Z
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

Ещё два факта с приёмки на Mac (Stable `b09dfab0`):

- Первый запуск встроенного binary по полному пути сразу упал: «Error: No such file or directory (os error 2)».
  После `cd ~` тот же binary без правки PATH запустился и показал «Hooks need review — 13 hooks are new or
  changed» для `hooks.json` Harness в `~/.codex/plugins/cache/…`. Значит, дело не в PATH (`codex-path/rg`).
  Вероятная причина — текущая папка shell-а, которой уже нет (например, удалённый worktree); не подтверждено.
- Codex пишет «clamping SessionEnd hook timeout to 3s» для обоих hook-ов `SessionEnd` Harness
  (`harness/hooks/hooks.json`: `session-end.mjs` — 10 s, `bin/worktree-lock release` — 5 s). На Codex они
  получают 3 s.

## Что делаем

0. Проверить причину «os error 2»: запуск из несуществующей текущей папки (test с временной папкой, которую
   удаляют до запуска; отдельный `CODEX_HOME` во временной папке, никогда не `~/.codex`). Кнопка или команда
   диалога запускает Codex в домашней папке пользователя. Если в протоколе app-server есть метод доверия
   hook-ам — рассмотреть одобрение прямо из worfy по нажатию пользователя, без terminal.
0a. Hook-и `SessionEnd` на Codex: успевают ли `session-end.mjs` и `worktree-lock release` за 3 s (замер); если
    нет — что теряется, и как это исправить (быстрее, фоном, или отдельный timeout для Codex в установке
    Harness). Записать в «Итог».
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
