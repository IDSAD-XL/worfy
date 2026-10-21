# 35 — Ссылка в markdown на `.command` или `.app` в Project-е запускает его по щелчку

Type: bug
Status: claimed 2026-10-21T12:16Z
Branch: worfy-polish/35
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

- [x] Contract `test/contract/shell.test.ts` (или файл test-ов `shell.openInEditor`): `.command`,
      каталог `.app`, файл с битом исполнения, `.cmd` на win32 — `showItemInFolder`, `openPath` не
      вызван; `.md`, `.ts`, `.png` — `openPath`, как раньше. `shell` Electron — stand-in.
- [x] Мутант красный: проверка вида файла убрана — `.command` уходит в `openPath`.
- [x] Unit: ссылка на такой файл в `Markdown` показывает причину после ответа main.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

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

**Платформенный PR (ADR-0056, пункт 2):** в main есть ветка по `process.platform` для win32 (свой
список расширений, `PATHEXT`, обрезка точки и пробела в конце имени, имя с `:`). Перед мержем нужен
вердикт Windows (`check/windows`).

Что сделано:

- `src/main/ipc/shell.ts`: `runsAsProgram(target)` решает в main, по реальному пути после
  `resolveProjectFile` (симлинки уже раскрыты), запустит ли ОС файл вместо открытия. Такой файл
  уходит в `shell.showItemInFolder`, а не в `shell.openPath`, и ответ несёт `revealedIn`
  (`Finder` / `Explorer` / `the file manager`). Renderer не доверенный: он только показывает причину.
- Что считается программой:
  - любой каталог (`.app`, `.workflow`, `.plugin` и каталог с именем вида `Guide.md`), на всех
    платформах;
  - macOS, по расширению без учёта регистра: `.app .command .terminal .tool .workflow .action .scpt
    .scptd .applescript .pkg .mpkg .sh .bash .zsh .csh .tcsh .ksh .fish .py .pyw .jar .webloc .inetloc
    .fileloc .dmg .mobileconfig .prefpane .saver .kext .osax .shortcut`. `.py` и `.jar` — из-за
    Python Launcher и Jar Launcher, которые их запускают;
  - Windows: стандартный `PATHEXT` (`.com .exe .bat .cmd .vbs .vbe .js .jse .wsf .wsh .msc`) и
    `PATHEXT` системы, плюс `.lnk .url .pif .scf .ps1 .psm1 .msi .msp .mst .scr .cpl .hta .reg .inf
    .jar .application .appref-ms .appx .appxbundle .msix .msixbundle .appinstaller .settingcontent-ms
    .library-ms .search-ms .diagcab .chm .gadget .iso .img .vhd .vhdx`; точка и пробел в конце имени
    отбрасываются, имя с `:` (поток NTFS) — всегда программа;
  - Linux и прочие: `.sh .bash .zsh .csh .ksh .fish .py .jar .desktop .appimage .run .deb .rpm
    .flatpakref .snap`;
  - не на Windows: файл с битом исполнения, если его расширение не из списка документов (`.md .txt
    .json .yaml .ts .js .mjs .css .html .png .pdf` и подобные). Файл без расширения с битом
    исполнения и `tool.xyz` с битом — показываются; `notes.md` и `check.mjs` с битом — открываются.
- Ссылки `file://` и прочие схемы кроме `https:` в renderer и так не ссылки (`links.ts`, не менялся);
  test-ы это закрепляют. `%2E` в ссылке renderer раскрывает до вызова main, main судит по реальному
  имени файла.
- `src/renderer/markdown/Markdown.tsx`: после ответа с `revealedIn` рядом со ссылкой появляется
  `Shown in Finder: worfy does not run programs from links` (`role="status"`, класс
  `w-md__link-note` в `markdown.css`).

Test-ы: `test/contract/shell.test.ts`, блок «shell.openInEditor never runs a program» (6 test-ов,
красные на main: 5 из 6); `test/unit/markdown.test.tsx` — причина рядом со ссылкой, ссылки с `%2E`,
`/` в конце и `?#` уходят в main, `file://` — не ссылка. Мутанты (каждый убран по одному) — все
красные: проверка в обработчике, правило каталога, список расширений, бит исполнения, исключение для
документов, обрезка точки в конце на win32, нижний регистр, причина в renderer.

Не проверено: запуск на настоящем Windows (test-ы подменяют `process.platform`; test бита исполнения
на win32 пропускается); гонка — файл подменён программой между `stat` и `shell.openPath`
(файл лежит в Project-е, окно гонки — миллисекунды). Вызовы `shell.openInEditor` из `AdrSection` и
`TicketNode` причину не показывают: ADR и Ticket — всегда `.md`.
