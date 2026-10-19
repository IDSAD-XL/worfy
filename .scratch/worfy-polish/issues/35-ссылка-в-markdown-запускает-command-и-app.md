# 35 — Ссылка в markdown на `.command` или `.app` в Project-е запускает его по щелчку

Type: bug
Status: open
Blocked by: —
Source: ревью PR [#530](https://github.com/IDSAD-XL/worfy/pull/530) (worfy-polish 33, Ticket целиком в
focus mode), круг 1, находка вне диффа (security). Код перечитан по main `2af91b51`; запуском не
проверено.

## Что происходит

- Тело Ticket-а (focus mode, Ticket 33) и документы Project-а рисуются компонентом
  `src/renderer/markdown/Markdown.tsx`. Щелчок по ссылке: `classifyLink` (`src/renderer/markdown/links.ts:75`)
  делит ссылки на `external` (только `https:`) и `file` (относительный или абсолютный путь). Ссылка `file`
  уходит в `shell.openInEditor` (`Markdown.tsx:49-52`).
- `shell.openInEditor` (`src/main/ipc/shell.ts:76-83`) проверяет только, что файл существует и лежит в
  Project-е или его worktree (`resolveProjectFile`, `:49-65`), и отдаёт его `shell.openPath` (`:80`).
  Проверки вида файла нет.
- `shell.openPath` делает то же, что двойной щелчок в Finder или Explorer. Для `.command`, `.app`,
  `.terminal`, `.tool` на macOS и `.exe`, `.bat`, `.cmd`, `.lnk`, `.ps1` на Windows это **запуск**, а не
  открытие в редакторе.
- Значит: строка `[подробности](scripts/setup.command)` в Ticket-е, документе или README Project-а —
  а их пишут агенты, чужие PR и склонированные репозитории — запускает программу одним щелчком
  пользователя, без предупреждения. Канал `shell.openInEditor` — `desktop` (`src/shared/ipc/shell.ts:19`),
  поэтому окно Linked machine-а его по связи не зовёт: запуск идёт на той Machine, где щёлкнули.

## Что делаем

1. В main, в обработчике `shell.openInEditor`: файл, который ОС запустила бы, а не открыла, —
   не `shell.openPath`, а `shell.showItemInFolder` (показать в Finder / Explorer). Как определить:
   - каталог-bundle на macOS (`.app` и другие каталоги — `stat().isDirectory()`);
   - расширение из списка исполняемых для платформы (macOS: `.app`, `.command`, `.terminal`, `.tool`,
     `.workflow`, `.scpt`, `.pkg`; Windows: значения `PATHEXT` плюс `.lnk`, `.ps1`, `.msi`, `.url`);
   - на macOS и Linux — файл с битом исполнения и без расширения текста.
   Точный список — в «Итог»; при сомнении безопаснее показать в папке, чем запустить.
2. Окно получает в ответе, что файл показан в папке, а не открыт; рядом со ссылкой — короткая причина
   («Shown in Finder: worfy does not run programs from links»), английский текст, как остальной UI.
3. Отдельный жест «запустить» не добавляем.

## Готово, когда

- [ ] Contract `test/contract/shell.test.ts` (или файл test-ов `shell.openInEditor`): `.command`,
      каталог `.app`, файл с битом исполнения, `.cmd` на win32 — `showItemInFolder`, `openPath` не
      вызван; `.md`, `.ts`, `.png` — `openPath`, как раньше. `shell` Electron — stand-in.
- [ ] Мутант красный: проверка вида файла убрана — `.command` уходит в `openPath`.
- [ ] Unit: ссылка на такой файл в `Markdown` показывает причину после ответа main.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: contract «`.command` не уходит в `openPath`» — красный на main.

## Где в коде

- `src/main/ipc/shell.ts` (`:49-65`, `:76-83`)
- `src/shared/ipc/shell.ts` (ответ `shell.openInEditor`)
- `src/renderer/markdown/Markdown.tsx` (`:41-53`)

Только читать: `src/renderer/markdown/links.ts`.

## Вне скоупа

- Ссылки `https:` — уже только `shell.openExternal` с проверкой схемы (`shell.ts:67-73`).
- Открыть Ticket в редакторе в Silent mode (Workflow folder вне Project-а) — [36](36-долг-после-review-pr-530.md).

## Итог

Заполняется при закрытии.
