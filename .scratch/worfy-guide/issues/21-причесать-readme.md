# 21 — Причесать README и показать в нём Map of worfy

Type: task
Status: done 2026-11-01T11:06Z
PR: #1204
Blocked by: 20
Source: [spec.md](../spec.md), Q22, слово владельца 2026-10-31

## Что происходит

Репозиторий публичный, README — первое, что видит человек. Owner: «нам нужно причесать readme потом». Уже известные расхождения с кодом: `README.md:40` об Autopilot из Stable (`worfy-feature-docs` 03, `## Итог`) и текст про Gate full в обновлении Stable.

## Что делаем

1. Переписать `README.md`: что такое worfy, короткий путь к первому запуску, ссылки на Guide и `docs/features/`. Детали сверить с кодом.
2. Отдельная экспортная версия Map of worfy: токены приложения в README недоступны, GitHub показывает SVG как картинку.
3. Перед началом показать владельцу план README: это решение о том, как проект выглядит снаружи.

## Готово, когда

- [x] Owner принял план и результат. — план принят 2026-11-01; результат — не проверено: owner видит его в PR #1204.
- [x] Каждое утверждение README сверено с кодом. — таблица в «Итог»; сверку каждой строки делает второй агент.
- [x] Схема читается на светлой и тёмной странице GitHub. — снимки и контраст в «Итог».

## Тесты

Нет.

## Где в коде

- `README.md`.

## Итог

PR: #1204, ветка `worfy-guide/21`. План README владелец принял 2026-11-01 (ответы 1–6 плана: тон для разработчика, только английский и строка на `docs/features/ru/`, без цен, «No license yet: all rights reserved», Windows поддерживается с пометкой «final acceptance open»).

**Что сделано.**

- `README.md` переписан по плану: что такое worfy, Map of worfy, для кого, статус, требования, первый запуск, обновление, Guide и документация, разработка (с Windows), закрытие Terminal на Windows, Stable copy. Исправлены 7 неверных и 3 неточных утверждения из раздела 1 плана. Убраны история winget, подробности data-папок, второго запуска, status line bridge и `hang-sample.mjs`: они есть в `docs/features/storage-and-diagnostics.md:17,25-27,126-128,338`.
- Оставлены, хотя план предлагал убрать: раздел о закрытии Terminal на Windows (в `docs/features/terminal.md` нет `Stop-Process -Force`, отсутствия подтверждения, потери несохранённого, судьбы процессов без родителя и elevated, проверки pid, предела 3 s и сигналов macOS: переносить отдельным docs-PR) и подробности `pnpm install:stable` (папки `.installing-`/`.replaced-`, отказы на Windows: их нет на страницах docs/features). Перенесены docs-PR 2026-11-01 (ветка `docs/day-2026-11-01`): закрытие Terminal — в `docs/features/terminal.md` («Closing a Terminal»), папки и отказы — в `docs/features/updates.md`, с переводом в `docs/features/ru/`; README ссылается туда. На раздел «Stable copy» ссылаются `scripts/install-stable.mjs:3`, `scripts/hang-sample.mjs:7` и ADR-0034:31, на «Development on Windows» — `test/contract/windows-tests-workflow.test.ts:525`; заголовки сохранены.
- Map of worfy — два SVG, `docs/images/map-of-worfy-light.svg` и `-dark.svg`, в `<picture>` с `media="(prefers-color-scheme: dark)"`. Их пишет `node scripts/map-of-worfy-svg.mjs` из данных самой Map: блоки, рамки, подписи областей и Edge-и — `src/renderer/guide/topics/map-of-worfy/spec.ts`, тексты — его `en.json`, геометрия — `src/renderer/guide/scene/model.ts` (`edgeShape`, `noteLines`, размеры), группы — `src/renderer/guide/scene-colours.ts`, цвета — hex из `src/renderer/theme/tokens.css` и `src/renderer/guide/guide.css` (светлые и блок `@media (prefers-color-scheme: dark)`). Отличия от живой схемы: свой непрозрачный фон `--surface`, все подписи Edge-ей видны сразу, нет бегущих точек и шагов.
- `test/unit/map-of-worfy-svg.test.tsx`: закоммиченные SVG совпадают с выводом скрипта (CRLF Windows-checkout-а приводится к LF); каждый текст ≥4.5:1 к своему фону; на схеме все блоки, подписи и метки Edge-ей Map; стрелки — ровно Edge-и `spec.ts`; нет ссылок, script, web-шрифтов и локальных путей; README показывает тёмный файл через `<source>` и светлый через `<img>` с alt.

**Контраст текста (измерен по цветам из SVG, формула WCAG).** Светлая: минимум 5.60:1 (`#636366` на `#f7f7f9`, «Tickets for one goal»), затем 5.99:1 (`#636366` на `#ffffff`, подписи областей), 9.12:1 (заметки блоков), заголовки 13.95–16.83:1. Тёмная: минимум 5.93:1 (`#9c968d` на `#1b1a18`), 6.58:1 (`#9c968d` на `#0f0e0d`), 9.22:1 (заметки), заголовки 9.43–14.24:1. Фон SVG свой, поэтому от фона страницы GitHub контраст не зависит.

**Перекрытия.** Одноразовая проверка Playwright по bounding box (вне репозитория, удалена): ни одна метка Edge-а не пересекает другую метку, блок, наконечник стрелки или подпись области; текст метки помещается в её плашку; текст блока не выходит за блок — в обеих темах, с системным шрифтом macOS и с Arial и Helvetica Neue. С Verdana (её нет в стеке шрифтов) «Ready wave · N» выходит за chip; для Linux в стек добавлен Liberation Sans (метрики Arial).

**Снимки.** GitHub (страница README ветки, светлая и тёмная тема браузера): [светлая](../evidence/21-readme-github-light.png), [тёмная](../evidence/21-readme-github-dark.png). Playwright, страница `github.com/IDSAD-XL/worfy/blob/worfy-guide/21/README.md` без входа, `colorScheme` light и dark; `currentSrc` картинки — `map-of-worfy-light.svg` и `map-of-worfy-dark.svg` соответственно, то есть GitHub выбрал файл по теме.

### Утверждения README и их источники

| README | Утверждение | Источник |
|---|---|---|
| 3 | desktop-приложение для macOS и Windows | `electron-builder.yml:4-5,71-74` |
| 3 | Project — git-репозиторий или папка над несколькими; ровно один Canvas | `docs/features/concepts.md:9-11` |
| 3 | на Canvas: Epic frames с Ticket-ами, Sessions с Subagents, Cards (HTML-приложения агента), Browsers, Terminals | `src/renderer/guide/topics/map-of-worfy/en.json:4`, `docs/features/concepts.md:21-23` |
| 3 | Harness — плагин Claude Code, который ставит worfy; ведёт работу по Profile Project-а | `docs/features/harness.md:12`, `en.json:5` |
| 3 | Autopilot запускает Waves Epic-а без человека | `docs/features/concepts.md:59`, `docs/features/autopilot.md:3` |
| 5–10 | картинка ведёт на Concepts; тёмная/светлая версия по теме | `docs/images/*.svg`, `test/unit/map-of-worfy-svg.test.tsx` (тест README) |
| 8 | alt = описание схемы | `en.json:8` (`scene.description`), слово в слово |
| 12 | Map of worfy — первая Topic Guide | `src/renderer/guide/registry.ts:20-22` |
| 12 | картинку рисует `node scripts/map-of-worfy-svg.mjs` из схемы Guide | `scripts/map-of-worfy-svg.mjs:21-23` (импорт `spec.ts`, `model.ts`, `scene-colours.ts`) |
| 16 | две Machine связываются 6-значным кодом; открыть Projects другой, если та разрешает | `docs/features/link.md:4-5`, `docs/features/concepts.md:117-120` |
| 20 | Windows 10 21H2+ и 11, x64 | `src/main/first-run/checks.ts:156`, `docs/features/onboarding.md:94-95`, `electron-builder.yml:71-74`, ADR-0054:66 |
| 20 | приёмка `worfy-windows` 16 открыта | `.scratch/worfy-windows/issues/16-приёмка-worfy-windows.md:4`, `HANDOFF.md:9` |
| 21 | скачать нельзя, сборка из исходников | `electron-builder.yml:91` (`publish: null`), `docs/roadmap.md:17` |
| 21 | сборки не подписаны сертификатом | `electron-builder.yml:4,60` (ad-hoc, без notarization), `:79-80` (installer и worfy.exe не подписаны) |
| 22 | лицензии нет | файла `LICENSE` в корне нет, поля `license` в `package.json` нет; ответ владельца 5 |
| 26 | Claude Code с входом; Sessions тратят usage аккаунта; Limits действуют | `docs/features/onboarding.md:45,291-292`, `docs/features/transcripts-and-usage.md:5` |
| 27 | git, gh, jq; gh вошёл в GitHub | `docs/features/onboarding.md:47,50` |
| 27 | Windows: Git for Windows, его Git Bash нужен Claude Code и Harness; jq необязателен | ADR-0054:15-17,69, `docs/features/sessions.md:153`, `docs/features/onboarding.md:91-92` |
| 28, 66 | Node.js 24, не ниже 24.15; pnpm из `packageManager` | `package.json:8-10`, `.nvmrc`, `pnpm-lock.yaml:207,211,2258,3299`, `pnpm-workspace.yaml:15-17`; `test/contract/node-version.test.ts` |
| 30 | при первом старте worfy сам проверяет Claude Code, инструменты, GitHub, Harness и предлагает исправление | `docs/features/onboarding.md:11-12,43-58` |
| 35 | адрес clone | `docs/features/updates.md:16` (публичный `IDSAD-XL/worfy`) |
| 41 | `pnpm install:stable` собирает и ставит Stable copy по этим путям | `scripts/install-stable.mjs:7,18-21,46,93-94` |
| 43 | First run: список нужного и состояние, ничего не меняет без подтверждения | `docs/features/onboarding.md:11-12,39,64` |
| 43 | Getting started ведёт один Ticket Demo project от Orchestrator через review до merge; Demo — локальный репозиторий без GitHub; агенты тратят usage | `docs/features/onboarding.md:148,152-153,290-292` |
| 47 | «Update worfy» в Version chip, Settings → General, Command palette | `docs/features/updates.md:40,42,44,65` |
| 47 | только в Stable copy на её месте по умолчанию | `docs/features/updates.md:11-14` |
| 47 | собирает голову `main` при зелёном `ci-ok`, в своём clone; заменяет копию после выхода; перезапуск — нажатие | `docs/features/updates.md:16-20,78-81,190,194` |
| 47 | хранит одну прошлую копию; ручной `pnpm install:stable` — ни одной | `docs/features/updates.md:197-198` |
| 51 | Help ▸ worfy Guide; «worfy Guide» в Command palette | `src/main/menu.ts:105`, `src/renderer/palette/commands.ts:36,364`, `docs/features/app-shell.md:389` |
| 52 | индекс feature-документации; перевод `docs/features/ru/` | `docs/features/README.md:1-11`, `docs/features/ru/README.md` |
| 53 | CONTEXT.md — глоссарий по-русски, термины английские | `docs/features/concepts.md:3-4` |
| 58 | `pnpm dev` — свои данные `worfy-dev` | `package.json:13`, `docs/features/storage-and-diagnostics.md:17` |
| 59–63 | команды lint, typecheck, test (под Node Electron), test:e2e (сборка, затем Playwright), test:package | `package.json:17-21`, `scripts/vitest-electron.mjs:2,6` |
| 66 | `engines.node` `>=24`, `.nvmrc` и CI — 24; четыре зависимости `^24.15.0`; `engineStrict` — `ERR_PNPM_UNSUPPORTED_ENGINE` до установки; тесты под Node Electron 24; скрипты под системным Node.js | `package.json:9-10,23,27`, `.nvmrc`, `pnpm-workspace.yaml:15-17`, `pnpm-lock.yaml:207,211,2258,3299`, `.scratch/worfy-windows/issues/24-*.md:440`, `test/contract/node-version.test.ts:130-138` |
| 68 | macOS: nvm читает `.nvmrc`, или установщик с nodejs.org; pnpm через corepack или npm | без изменений из прежнего README (проверено планом); `.nvmrc` |
| 70 | merge — при зелёном `ci-ok` | ADR-0083:39 |
| 70 | CI: lint, typecheck, unit и contract на Linux; tests, e2e, packaged app на macOS; tests и e2e на Windows; PR — нужная часть, push в `main` — всё | `.github/workflows/ci.yml:8-14,22,25,30,36,46,349,371,419-428` |
| 74–78 | Windows: Git for Windows, Node.js 24.15+ (.msi), pnpm; nvm for Windows и `ERR_PNPM_BAD_PM_VERSION` | ADR-0054:69, `.scratch/worfy-windows/issues/24-*.md:444-449` |
| 80 | Developer Mode для symlink-тестов | `test/contract/windows-tests-workflow.test.ts:525-526`, `test/contract/counted-fs.ts:13` |
| 82 | Build Tools не нужны, node-pty не пересобирается на Windows | `scripts/postinstall.mjs:7,9,23` |
| 86 | закрытие: сначала процессы под shell (`Stop-Process -Force`), потом pseudo-console | `src/main/terminal/windows-pty.ts:155-165,212`, `docs/features/terminal.md:75`, `src/main/terminal/pty.ts` (ветка Windows close) |
| 86 | worfy не спрашивает перед закрытием | `src/renderer/canvas/overlays/SelectionToolbar.tsx:229` (Delete сразу в trash, без диалога), `docs/features/terminal.md:26` |
| 86 | обход дерева по живым родителям; ребёнок старше родителя — не ребёнок | `src/main/terminal/windows-pty.ts:155-161,193-196` |
| 86 | программы со своим окном завершаются сразу, без просьбы закрыться: несохранённое теряется | `src/main/terminal/windows-pty.ts:153-216` (`Stop-Process -Force` на `:212`), `src/main/terminal/pty.ts:959-960` |
| 86 | программа на console shell-а всё равно завершается: закрытие pseudo-console её заканчивает | `src/main/terminal/pty.ts:961-963,989-991` |
| 88 | pseudo-console закрывается в каждом из этих случаев | `src/main/terminal/pty.ts:971-981` (ошибка помощника только в log, затем `release`), `:1007` (`pty.kill()`) |
| 88 | те же случаи: Node уходит из Layout, Project удалён, ушло последнее окно или Linked machine, выход | `docs/features/terminal.md:24-29` |
| 88 | elevated остаётся, pid в log | `src/main/terminal/windows-pty.ts:163,226,246` |
| 88 | предел 3 s, для Git Bash 4.5 s (hangup и 1.5 s) | `src/main/terminal/windows-pty.ts:12,32,52,237` |
| 88 | pid shell-а у другого процесса или создан позже — ничего не завершается | `src/main/terminal/windows-pty.ts:14-17,157-159,210-211` |
| 90 | macOS: SIGHUP группе, SIGKILL через секунду | `src/main/terminal/pty.ts:83,936-942` |
| 94 | Autopilot отказывает репозиторию worfy только в development build, любой checkout и worktree тоже; packaged — можно | `src/main/autopilot/run.ts:406,417-418,428`, `docs/features/autopilot.md:29-30` |
| 99–105 | пути по умолчанию и свои | `scripts/install-stable.mjs:18-21,93-94,111-113` |
| 108 | собирает (`pnpm package`), меняет, пишет commit и время рядом, внутрь копии не пишет | `scripts/install-stable.mjs:7-13`, `metadataPath` `:131-133` |
| 108 | прошлая копия отодвигается, пока новая не на месте, и возвращается при неудаче замены | `scripts/install-stable.mjs:7-9` |
| 108 | отказ с ненулевым кодом, пока копия запущена; остановить Autopilot или ждать паузы между Waves | `scripts/install-stable.mjs:13,929` |
| 108 | `.installing-<pid>` и `.replaced-<pid>`, следующий запуск их убирает | `scripts/install-stable.mjs:9-10,194-198,973-975` |
| 110 | Stable copy на Windows — копия `dist\\win-unpacked`, запуск `worfy.exe`, ярлыка в меню Пуск нет | `scripts/install-stable.mjs:20-21,46` (копирует `win-unpacked`; ярлыков скрипт не создаёт: слова shortcut в нём нет) |
| 110 | SmartScreen: More info → Run anyway | `electron-builder.yml:79-80` (SmartScreen спрашивает); названия кнопок — интерфейс Windows, перенесены из прежнего README:60 |
| 110 | на Windows unsigned installer `dist\worfy Setup <version>.exe` в `%LOCALAPPDATA%\Programs\worfy`; SmartScreen | `electron-builder.yml:5,79-83` |
| 110 | installer останавливает программы с путём из его папки; отказы: внутри, вокруг, с тем же началом пути; `Uninstall worfy.exe`; непустая папка не копия; папка с `worfy.exe` заменяется целиком | `electron-builder.yml:87-89`, `scripts/install-stable.mjs:109-128,172-182` |
| 112 | на Mac после установки новой копии ответить на её диалоги до старта Autopilot: ad-hoc подпись меняется с каждой сборкой, macOS может спросить снова | `electron-builder.yml:60` (`identity: '-'`), `docs/features/link.md:56` (подпись меняется с каждой сборкой); перенесено из прежнего README:78 |
| 114 | копия и `pnpm dev` — разные data-папки | `docs/features/storage-and-diagnostics.md:17,136` |
| 114 | экран не гаснет весь прогон, в т.ч. ожидание Limits и фоновых задач после Stop | `src/main/autopilot/power.ts:3`, `docs/features/autopilot.md:112` |
| 114 | крышку не закрывать, экран вручную не блокировать: Mac спит; на заблокированном экране Electron не показывает окно, e2e не идут | ADR-0034:7,24,30-31 |
| 116 | `WORFY_PACKAGED_APP=… playwright test --grep 'stable copy of the packaged app'` | `test/e2e/packaged.spec.ts:18,322,328` |

### Раунд 1 доработки (PR #1204, REJECTED, 5 medium и low)

1. README:112 — вернул совет ответить на диалоги macOS новой копии до старта Autopilot.
2. README:108 — вернул гарантию ручного `pnpm install:stable`: прошлая копия отодвигается и возвращается при неудаче.
3. README:110 — вернул: копия `dist\\win-unpacked` без ярлыка в меню Пуск, путь SmartScreen More info → Run anyway.
4. `scripts/ci-scope.mjs:56-59` — оба SVG в `READ_BY_TESTS`: PR только с SVG запускает тесты (`linux-tests`), случаи в `test/contract/ci-workflow.test.ts` рядом с README.md. `scripts/affected-tests.table.json` — строка `links`: оба SVG → `test/unit/map-of-worfy-svg.test.tsx`; случай в `test/unit/affected-tests.test.ts`, отдельный describe (describe реальной таблицы в карантине на macOS). Прогон `scripts/affected-tests.mjs` на пробном commit-е только с `docs/images/map-of-worfy-dark.svg`: `all:false`, тест выбран.
5. В ту же строку `links` — `src/renderer/theme/tokens.css` и `src/renderer/guide/guide.css`. Пробный commit только с `tokens.css`: `all:false`, тест выбран.

Low: число наконечников (`rotate(`) равно числу Edge-ей; проверка путей ловит `~/` и имя пользователя (целым словом, от трёх букв); `alt` равен экранированному `scene.description`; README:47 «at its default place»; `scripts/hang-sample.mjs:7` ссылается на `docs/features/storage-and-diagnostics.md`, а там после описания файлов — признак окна «восстановить окна?» (`NSPersistentUIRestorer`, `NSAlert runModal`, ссылка на `docs/lessons/agents.md`); строки README:86,88 выше.

Mutant-ы (каждый красный, потом файлы возвращены из копии и сверены `cmp`): строка `links` удалена — красный тест таблицы; лишний наконечник без `data-edge` (SVG перегенерированы) — красный «draws an arrow…» в обеих темах; комментарий `~/…` и комментарий с именем пользователя — красный «carries no link…»; изменённый `alt` — красный тест README; SVG убраны из `READ_BY_TESTS` — красные оба новых случая `ci-workflow.test.ts`.

### Подписи и стрелки SVG и их источники

Все тексты — значения `scene.labels` из `src/renderer/guide/topics/map-of-worfy/en.json:9-64` (ключ блока, ключ `…Note`, ключ области, ключ метки Edge-а), позиции — `spec.ts`. Тест сверяет, что на схеме есть каждый из них.

| SVG | Источник в `spec.ts` | Текст в `en.json` |
|---|---|---|
| OTHER MACHINE, THIS MACHINE, NOT NODES (подписи областей) | `:16-18` | `:10,11,64` |
| рамка Canvas и рамка Epic (вложенность позицией) | `:21-22` | — |
| Linked machine | `:26` | `:12-13` |
| Machine, Project, Profile, Harness, Gate (столбец This Machine) | `:28-32` | `:14-23` |
| Canvas (tab), Epic (tab), Ready wave · N (chip, пунктир) | `:34-36` | `:28-33` |
| Ticket, Session, Subagent, Card, Browser, Terminal (внутри рамки Canvas) | `:37-42` | `:34-45` |
| Autopilot, Limits (под NOT NODES) | `:44-45` | `:24-27` |
| Linked machine → Machine (без метки) | `:49` | — |
| Linked machine → Canvas «opens it, if access is on» | `:51` | `:46` |
| Machine → Project «hosts» | `:52` | `:47` |
| Project → Canvas «has exactly one» | `:53` | `:48` |
| Machine → Harness «one per Machine» | `:55` | `:49` |
| Harness → Profile «runs a Project by» | `:56` | `:50` |
| Profile → Project «describes» | `:57` | `:51` |
| Harness → Session «guides the agents» | `:58` | `:52` |
| Harness → Gate «includes» | `:59` | `:53` |
| Ticket → Ready wave «ready now» | `:61` | `:54` |
| Autopilot → Ready wave «runs» | `:62` | `:55` |
| Autopilot → Limits «waits for reset» | `:63` | `:56` |
| Session → Subagent «starts» | `:64` | `:57` |
| Session → Ticket, Subagent → Ticket «Binding» | `:65-66` | `:58` |
| Session → Card «may change» | `:67` | `:59` |
| Session → Browser «arrives signed in» | `:68` | `:60` |

Цветовые группы — `src/renderer/guide/scene-colours.ts:9-22` по полю `group` блока в `spec.ts:26-45`, как в Map приложения. Шагов и бегущих точек в SVG нет.

Оценка токенов автора: около 0.3 млн токенов контекста (автор ~190k, агент сверки источников 111k); с повторным чтением кэша за ~90 вызовов — порядка 8 млн входных токенов.
