# 35 — Ссылка в markdown на `.command` или `.app` в Project-е запускает его по щелчку

Type: bug
Status: done 2026-10-21T19:33Z
PR: #692
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

**Платформенный PR (ADR-0056, пункт 2):** в main есть ветка по `process.platform`: свой список
документов для win32, правило имени с `:` и подпись кнопки «Show in Explorer». Перед мержем нужен
вердикт Windows (`check/windows`).

**Решение владельца (2026-10-21, PR #692): «удобство важнее безопасности», вариант «в».** Что
привело к нему:

- Круг 1 ревью нашёл обход списка программ: файл `.term` (сессия Terminal со строкой
  `ExecutionString`) в список не входил, и Terminal выполнял его команду с одного щелчка.
- Orchestrator перевернул проверку: белый список документов вместо списка программ.
- Владелец выбрал вариант «в»: документ из белого списка открывается сразу; для любого другого файла
  main сначала спрашивает.

**Изменение поведения против main:** ссылка в Markdown и «Open in editor» больше не открывают
не-документ сразу.

- **Белый список** (`src/main/ipc/shell.ts`, `isDocument` по реальному пути после
  `resolveProjectFile`, симлинки уже раскрыты): обычный файл (`isFile`), расширение без учёта
  регистра.
  - На всех системах: `.md .markdown .txt .log .json .jsonc .yaml .yml .toml .ts .tsx .css .png .jpg
    .jpeg .gif .webp .pdf` — текст, markdown, форматы данных, TypeScript и CSS как текст, картинки,
    PDF. Всё это открывается в редакторе или просмотрщике.
  - Только macOS и Linux: `.js .mjs .cjs .jsx`. На Windows `.js` и `.jse` запускает Windows Script
    Host, а у `.mjs` и `.cjs` там нет редактора по умолчанию.
  - Нигде: `.html .htm .svg .xml`. Они открываются в браузере, а страница может перейти на
    обработчик схемы URL (`ms-msdt:`, `search-ms:`, `x-apple…:`). `.csv` открывается в таблице,
    которая может вычислять формулы.
- **Всё прочее спрашивает.** Это каталог (bundle `.app`, `.plugin`, каталог `Guide.md/`), файл без
  расширения или с любым другим расширением, `.command`, `.term`, скрипты, `trail.md.`,
  `space.md `, на win32 — имя с `:` (поток NTFS). Для таких файлов main показывает
  `dialog.showMessageBox` на окне, которое позвало:
  - заголовок `Open <имя>?`;
  - текст `This file may run a program. worfy opens documents directly; this one is not a
    document.`;
  - кнопки `Cancel` / `Show in Finder` (`Show in Explorer` на win32, `Show in folder` на прочих) /
    `Open`.
  
  `Cancel` — кнопка по умолчанию и ответ на Escape, поэтому Return программу не запускает. `Open` —
  `shell.openPath`, как раньше; `Show` — `shell.showItemInFolder`; `Cancel` — ничего. Ошибка самого
  окна вопроса — отказ, файл не открыт.
- **Решение и окно вопроса — в main**: renderer не доверенный.
- **Ответ** `shell.openInEditor`: `outcome: 'opened' | 'revealed' | 'cancelled'` и
  `revealedIn: 'darwin' | 'win32' | 'other'`, только при `revealed`. Тип `RevealPlatform` — через
  `z.infer` из `src/shared/ipc/shell.ts`. Текст UI строит renderer (`src/renderer/toast/revealed.ts`):
  - ссылка в Markdown после «Show» пишет рядом `Shown in Finder: not a document`;
  - панель ADR и «Open in editor» Ticket-а показывают тот же текст toast-ом (ADR или Ticket —
    симлинк на не-документ);
  - после `Cancel` и `Open` текста нет.
- **Linked machine:** канал `shell.openInEditor` помечен `desktop`. Окно на Linked machine его не
  зовёт, а показывает «File is on <Machine>». Вызов с Linked machine main отклоняет: «not open to
  Linked machines», `test/contract/link-access.test.ts`. Окно вопроса и запуск программы бывают
  только на Machine окна, которое щёлкнули; на другой машине программа не открывается.
- **Не смотрим:** бит исполнения — файл с расширением система определяет по расширению, а файл с
  FAT или SMB со всеми битами открывается в своём редакторе. `PATHEXT` — он задаёт поиск команд в
  командной строке, а двойной щелчок решает ассоциация.

Test-ы:

- `test/contract/shell.test.ts`, блок «shell.openInEditor opens documents and asks about anything
  else». `dialog.showMessageBox` — stand-in.
  - `.term`: окно вопроса на окне-отправителе, все тексты, `Cancel` — default и cancel.
  - `Show`, `Open`, `Cancel` → `showItemInFolder`, `openPath`, ничего.
  - Без окна — `showMessageBox(options)`; ошибка окна вопроса — отказ.
  - Буквальный список известных пусковых видов по платформам (среди них `.term`, `.search-ms`,
    `.library-ms`, `.iso`, `.vhd`, `.appinstaller`, `.chm`, `.dmg`, `.mobileconfig`, `.jar`,
    `.shortcut`, `.applescript`): каждый вид в обоих регистрах спрашивает, подпись «Show» — по
    платформе.
  - Неизвестное расширение и файл без расширения, каталоги на трёх системах, симлинк `.md` на
    `.term` (окно вопроса называет настоящее имя), имя с `:` на win32.
  - Документы с `+x` в любом регистре открываются без вопроса. `.js` открывается без вопроса на
    macOS и Linux и спрашивает на Windows.
- `test/unit/markdown.test.tsx`: причина рядом со ссылкой после `revealed`, текст для каждого кода
  системы, после `cancelled` текста нет. `test/unit/adr-section.test.tsx` и
  `test/unit/ticket-focus.test.tsx`: toast с причиной.
- `test/e2e/ticket-focus.spec.ts`: ссылка на `setup.command` через настоящий IPC. Main спрашивает
  (stand-in отвечает «Show»), `shell.showItemInFolder` получает файл, `shell.openPath` не вызван,
  рядом причина.

Не проверено:

- запуск на настоящем Windows: test-ы подменяют `process.platform`;
- настоящее окно вопроса macOS: e2e подменяет `dialog.showMessageBox`;
- ассоциация, которую поменял сам пользователь (например `.ts` → программа, которая его
  запускает), не видна: такой файл откроется без вопроса.
