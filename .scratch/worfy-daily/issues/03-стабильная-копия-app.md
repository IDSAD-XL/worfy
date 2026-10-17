# 03 — Стабильная копия worfy.app вне репозитория

Type: task
Status: done 2026-10-06
PR: #37
Blocked by: —
Source: [spec.md](../spec.md), тема A, риски 5 и 6; [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md) — папка данных worfy; Ticket 32 worfy-mvp (сборка `.app`)

## Что делаем

Autopilot над самим worfy нельзя вести из сборки, которую агенты в это же время переписывают. Сейчас
`pnpm package` (`electron-vite build && electron-builder --mac dir`) кладёт `.app` в `dist/`, и
следующая сборка его заменит. Детали `electron-builder.yml`: output `dist/`, target `dir`, identity
`'-'` (ad-hoc), `notarize: false`. Нужна копия вне репозитория, которая меняется только по явной
команде.

**Скрипт `scripts/install-stable.sh`** и команда `pnpm install:stable` в `package.json`:

- Собирает `.app` и копирует `dist/mac*/worfy.app` в `~/Applications/worfy-stable.app`. Путь можно
  передать аргументом.
- Отказывает с кодом ≠ 0 и понятным текстом, если копия сейчас запущена.
- Пишет рядом с копией файл с commit-ом и временем сборки, например
  `~/Applications/worfy-stable.json`. Внутрь `.app` после копирования ничего не пишется: это сломало
  бы подпись.

**Папка данных.** Копия и dev-запуск (`pnpm dev`) сейчас делят
`~/Library/Application Support/worfy`: `src/main/storage/paths.ts:10-13`, `userData` переставлен
туда же в `src/main/index.ts:15`. Одновременный запуск двух процессов портит `limits.json` и
`bindings.json`. Решение принимает ADR (номер с 0022). Варианты:

- (а) dev-запуск (`app.isPackaged === false`) берёт отдельную папку, например `worfy-dev`;
- (б) `app.requestSingleInstanceLock()` — lock по `userData`, и тогда dev не запустится, пока
  работает копия;
- (в) оба.

Что известно из ручной проверки 2026-10-06, ночь (проверка 27, Ticket 21 `worfy-mvp`): щелчок по
уведомлению macOS 4 раза из 4 запускал вторую копию worfy из другой сборки на диске — LaunchServices
выбирает по bundle id `dev.worfy.app` одну из пяти сборок. Копия открывалась на той же папке данных и
запускала свой `claude --resume` Orchestrator-а. На main `app.requestSingleInstanceLock()` не
вызывается (`src/main/index.ts:21`).

e2e это не затрагивает: у них `WORFY_DATA_DIR` во временной папке.

**Раздел «Стабильная копия» в `README.md`:**

- как поставить копию;
- что Autopilot над worfy идёт только на ней;
- когда и в каком порядке её обновлять:
  1. main зелёный — Gate full и CI;
  2. Autopilot на копии остановлен или стоит между Wave-ами;
  3. запущен `pnpm install:stable`;
  4. копия запущена;
  5. системные диалоги новой копии получили ответ до старта Autopilot.

**Права macOS.** Ad-hoc подпись меняется с каждой сборкой, поэтому macOS может заново спросить права
у новой копии: уведомления и другие. Проверяется вживую, список увиденных диалогов идёт в «Итог».

## Готово, когда

- [x] `pnpm install:stable` кладёт копию в `~/Applications/worfy-stable.app` или в путь из аргумента. Повторный запуск заменяет копию. Если копия запущена — отказ с понятным текстом и кодом ≠ 0.
- [x] Рядом с копией записаны commit и время сборки.
- [x] ADR о папке данных копии и dev-запуска принят. Одновременный запуск копии и `pnpm dev` не пишет в одни и те же `limits.json` и `bindings.json` — это проверяет test на `paths.ts` или на single-instance lock, по выбранному варианту.
- [x] В `README.md` есть раздел «Стабильная копия» с порядком обновления.
- [x] e2e `@packaged` в `test/e2e/packaged.spec.ts` запускает копию, которую скрипт положил во временную папку. Путь передаётся через env (`WORFY_PACKAGED_APP`). Terminal test `@packaged` в `test/e2e/terminal.spec.ts` по-прежнему запускает `dist/mac*/worfy.app`: файл вне следа этого Ticket-а.
- [x] (вручную) Копия запущена из Finder, открыт Project worfy. Через computer use снят экран после старта: системных диалогов нет, или они перечислены в «Итог». (Проверено 2026-10-07: новых системных диалогов нет; два окна, которые были на экране до запуска, перечислены — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).)

## Тесты

- `test/unit/paths.test.ts` — папка данных packaged- и dev-запуска по принятому ADR.
- `test/e2e/packaged.spec.ts` — `@packaged`: путь к `.app` из env, а не только `dist/mac*/worfy.app` (`:14-31`).
- Сначала падающий test: копия и dev-запуск получают одну папку данных (или оба берут lock) — test по принятому ADR, красный на нынешнем коде.

## Где в коде

- `scripts/install-stable.sh` (новый)
- `package.json`
- `src/main/storage/paths.ts`
- `src/main/index.ts`
- `README.md`
- `test/unit/paths.test.ts`
- `test/e2e/packaged.spec.ts`
- `scripts/statusline-bridge.sh`, `test/contract/statusline-bridge.test.ts` — добавлены по ревью (круг 1): мост status line знает обе папки данных
- `docs/adr/0023-separate-data-roots-packaged-and-dev.md` (новый) — добавлен по ревью (круг 2): номер выдал Orchestrator

## Итог

**Что сделано.**

- `scripts/install-stable.sh` и `pnpm install:stable [<путь>.app]`. Скрипт собирает `.app`
  (`pnpm package`), копирует `dist/mac*/worfy.app` через `ditto` сначала во временную папку рядом с
  целью, потом меняет её на место старой копии. Commit, признак незакоммиченных правок, время сборки
  (mtime `Info.plist` собранного `.app`) и время установки пишутся рядом: `<цель без .app>.json`,
  по умолчанию `~/Applications/worfy-stable.json`. Внутрь `.app` ничего не пишется.
- Отказ, если копия запущена: в списке процессов (`ps`) есть путь `<цель>/Contents/`. Путь
  сравнивается в двух написаниях — как дан и через `pwd -P`: на macOS `/var` — ссылка на
  `/private/var`. Проверка идёт до сборки и ещё раз перед копированием.
- Цель обязана кончаться на `.app`: скрипт удаляет старую копию, и опечатка в аргументе не должна
  удалить чужую папку.
- `WORFY_STABLE_PREBUILT=<путь к .app>` пропускает сборку. Им пользуются e2e: они ставят уже
  собранный `dist/` во временную папку. В JSON тогда поле `source` показывает, откуда копия.
- Папка данных и lock — по [ADR-0023](../../../docs/adr/0023-separate-data-roots-packaged-and-dev.md). `src/main/storage/paths.ts`: `dataRoot(env, kind)`,
  `setBuildKind()`. `src/main/index.ts` ставит вид сборки из `app.isPackaged` до первого
  `dataRoot()` и берёт `app.requestSingleInstanceLock()` после `setPath('userData')`.
- e2e `@packaged` (`test/e2e/packaged.spec.ts`) запускает копию, которую скрипт поставил во
  временную папку; `WORFY_PACKAGED_APP` подменяет её любой другой, например настоящей
  `~/Applications/worfy-stable.app`. Отдельные test-ы скрипта: установка в путь из аргумента и
  JSON рядом, замена прежней копии, отказ при запущенной копии. Без тега (идут в `pnpm test:e2e`):
  dev-запуск берёт `worfy-dev`, второй dev-запуск над той же папкой выходит, цель не `.app` —
  отказ.

**Как падал первый test.** `test/unit/paths.test.ts` на нынешнем коде: 2 из 11 красные —
`dataRoot({}, 'dev')` вернул `…/Application Support/worfy` вместо `…/worfy-dev` (копия и dev-запуск
получают одну папку), и `setBuildKind is not a function`.

**Mutation testing.** Каждый мутант краснит свой test:

- `setBuildKind('packaged')` вместо `app.isPackaged` в `index.ts` — e2e «dev run keeps its state in
  worfy-dev»;
- lock всегда «взят» (`requestSingleInstanceLock() || true`) — e2e «a second dev run … quits»;
- в скрипте нет отказа при запущенной копии — «refuses … while the copy is running»;
- JSON пишется внутрь `.app` — подпись (`codesign --verify --strict`) и `diff -rq` с `dist/`;
- копия кладётся поверх старой без удаления — «a second run replaces the previous copy».

**Вне следа.** `test/contract/main-ipc-wiring.test.ts`: в mock `electron.app` добавлены
`isPackaged` и `requestSingleInstanceLock`. Без них contract test `src/main/index.ts` падает
`app.requestSingleInstanceLock is not a function`. Правка механическая, две строки; файл не
входит в след соседей по Wave 1 (01, 02, 21).

**README.** Раздел назван «Stable copy»: `README.md` написан по-английски, как всё, что видит
команда. Содержание — то, что Ticket требует от раздела «Стабильная копия».

**Ручные проверки.**

- запуск копии из Finder, открытый Project worfy и системные диалоги macOS после старта проверены
  2026-10-07 — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).
- Установка в путь по умолчанию проверена e2e без настоящей папки владельца: скрипт без
  аргумента с `HOME=<временная папка>` кладёт `<HOME>/Applications/worfy-stable.app` и
  `worfy-stable.json` рядом. Настоящую `~/Applications/worfy-stable.app` этой ночью не ставили.
  Полный путь со сборкой (`pnpm install:stable <временная папка>/worfy-stable.app`) прогнан:
  копия встала, `codesign --verify --deep --strict` прошёл, JSON записан.
- Отказ при запущенной копии проверен e2e на копии, запущенной через Playwright.

**Доработка после ревью (круг 1).**

- ADR: файл `docs/adr/NNNN-*.md` в PR не заведён. По правилам этой ночи номер ADR и файл заводит
  Orchestrator; черновик был готов к переносу как есть. Пункт «Готово, когда» про ADR оставался
  `[ ]`, пока файл не принят (принят в круге 2 — ADR-0023, ниже).
- `scripts/statusline-bridge.sh` (вне следа, назван в ревью): без `WORFY_DATA_DIR` пишет
  `statusline-limits.json` в каждую существующую из папок `…/worfy` и `…/worfy-dev`, с
  `WORFY_DATA_DIR` — только туда. Раньше писал только в `…/worfy`, и dev-запуск рядом с копией
  терял Limits из status line. `test/contract/statusline-bridge.test.ts` берёт имена обеих папок
  из `dataRoot()` в `paths.ts`: переименование папки в `paths.ts` краснит test, пока скрипт не
  догонит. Комментарий в `paths.ts` называет скрипт единственной копией этого знания.
- Обработчик `second-instance` в `src/main/index.ts` покрыт e2e: свёрнутое окно первого процесса
  разворачивается, а без окон первый процесс открывает новое (dev-запуск без тега и копия с
  тегом `@packaged`).
- `install-stable.sh`: слеш на конце цели убирается до проверки `.app` (раньше путь
  `…/worfy-stable.app/` получал отказ); признак `dirty` учитывает неотслеживаемые файлы — сборка
  их включает. Оба поведения, а также путь по умолчанию, проверяют e2e без тега на подставном
  `.app` (`WORFY_STABLE_PREBUILT`), без сборки.
- README: абзац о том, что мост status line пишет в обе папки.
- Мутанты этого круга, каждый краснит свой test: событие переименовано в `second-instance-MUTANT`
  (оба test-а обработчика); нет `restore()` (test свёрнутого окна); `if (started)` никогда не
  истинно (test без окон); мост пишет только в `…/worfy` (два test-а моста); мост пишет в папки
  по умолчанию и при `WORFY_DATA_DIR` (test моста с `WORFY_DATA_DIR`); путь по умолчанию
  `~/Apps/…` (test без аргумента); слеш убирается после проверки `.app` (test со слешем);
  `--untracked-files=no` (test признака `dirty`).

**ADR.** Решение о папках данных принято как
[ADR-0023](../../../docs/adr/0023-separate-data-roots-packaged-and-dev.md): dev-запуск берёт
`Application Support/worfy-dev`, packaged-сборка — `…/worfy`, над каждой папкой один процесс
(single-instance lock). Черновик, который стоял здесь, перенесён в этот файл.

**Доработка после ревью (круг 2).** Единственная находка — файл ADR не заведён. Orchestrator выдал
номер 0023; черновик из «Итог» перенесён в `docs/adr/0023-separate-data-roots-packaged-and-dev.md`
по формату принятых ADR, с разделом о том, что меняется по сравнению с ADR-0005 (сам ADR-0005 не
тронут). Пункт «Готово, когда» про ADR отмечен. Код не менялся. Ветка перенесена на `origin/main`
(там влит Ticket 21, он менял `test/e2e/helpers.ts`), e2e прогнаны заново.

### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (проверка M16 второго круга ручных проверок): пересборка Stable copy
и запуск из Finder.

- Перед пересборкой: прогон Autopilot `2026-10-07T00-32-09-524Z-66ddaf` кончился `run-stopped`, Epic
  `worfy-week` закрыт 7/7. Ни одна Session worfy не была `busy`.
- Чистый worktree на origin/main 6df9791. `GATE_SCOPE=all gate.sh full` под `/tmp/worfy-e2e.lock` —
  exit 0, «[gate] зелено (full)» (lint, typecheck, test, test:e2e, test:package). CI main — success на
  4dbd67e; 6df9791 меняет только `.md` и `.scratch`, CI на нём не запускается.
- Копия из 5060858 закрыта ⌘Q. `pnpm install:stable` — exit 0: в `worfy-stable.json` commit 6df9791,
  `dirty: false`, подпись ad-hoc, атрибута quarantine нет.
- Запуск из Finder — клавишами в своём окне Finder: ⌘N → ⌘⇧G `~/Applications` → выбор worfy-stable →
  ⌘O. Путь через AppleScript «tell Finder» из плана был закрыт: на экране висел неотвеченный запрос
  Automation «"claude" wants access to control "Finder"» (проверка M15, «Итог» Ticket-а 31), его не
  трогали.
- Результат: pid 152, родитель — launchd, PATH как у launchd. За 30 с появилось одно новое окно — окно
  worfy; новых системных диалогов нет. Два окна были на экране до запуска и к нему не относятся:
  этот запрос Automation (UserNotificationCenter) и предупреждение `universalAccessAuthWarn` о
  Screen Recording.
- На снимке окна: «worfy — CanvasForAI», CanvasForAI · main, Canvas, Epic-и 32/32, 33/33, 7/7.
- Не проверено, за владельцем: спросит ли macOS разрешение на уведомления у новой ad-hoc подписи при
  первом уведомлении. При старте не спросил.
- После проверки копия перезапущена с CDP на порту 9351 и логом main (pid 2455): `app.version`
  отвечает, ошибок в stderr нет. На ней шли проверки M17–M24.
- Вердикт: проверено.
- Улики (в scratchpad Session Orchestrator-а, в репозиторий не положены): `M16-window.png`,
  `M16-finder-selected.png`, `M16-gate.txt`, `M16-stable.json`, `M16-wins-before.txt`,
  `M16-wins-after.txt`, `M16-launch.txt`, `M16-ci.txt`.

### Долги из HANDOFF (2026-10-08)

- [low] границы модулей: формат журнала Autopilot из Ticket-а 01 называет папкой по умолчанию
  `~/Library/Application Support/worfy` (`src/shared/autopilot/journal.ts:7`), а пример для наблюдателя
  жёстко прописывает этот путь (строка 48). После PR #37 dev-запуск хранит данные в `…/worfy-dev`
  (ADR-0023), и для него описание неверно.
- [low] Нет test-а на второй запуск, пока первый процесс ещё стартует и окна у него нет (ветка
  `started=false` в `src/main/index.ts`, на 2026-10-08 — строки 50–62). e2e свёрнутого окна требует
  оконного сервера macOS: локально 3 из 3 и на CI macos-latest были зелёные; без входа пользователя в
  оконную систему может вести себя иначе.
