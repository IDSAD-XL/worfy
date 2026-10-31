# worfy-update: Update Stable copy из `main` вместе с Harness

Status: решения владельца 2026-10-31 (пункты 1–12 раздела «Решения владельца») приняты; Р1–Р15 раздела
«Решено без владельца» и «Тексты (черновик)» — на подтверждение владельцу. Ticket-ы раздаются после
onboarding 13 и 14.
Source: решения владельца 2026-10-31; [CONTEXT.md](../../CONTEXT.md), термины Update, Available update и
Stable copy; [ADR-0089](../../docs/adr/0089-update-builds-main-in-own-clone.md) (сборка `main` в своём
clone, Releases и подпись — в E4), [ADR-0005](../../docs/adr/0005-worfy-own-state-inventory.md) (своё
состояние worfy), [ADR-0019](../../docs/adr/0019-harness-claude-code-plugin.md) (Harness и E4),
[ADR-0047](../../docs/adr/0047-harness-lessons-by-pr-early-owner-switch.md) (отставание Harness),
[ADR-0056](../../docs/adr/0056-windows-checks-and-two-sessions.md) и
[ADR-0086](../../docs/adr/0086-pc-gate-full-once-per-wave.md) (проверка Windows),
[ADR-0083](../../docs/adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md) (`ci-ok`),
[ADR-0088](../../docs/adr/0088-feature-pages-in-english.md) (Feature page).
Ticket-ы: Epic `worfy-update`, 12 Ticket-ов, нумерация с `01`. Шапка — тот же диалект, что у
worfy-onboarding (`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`, `ticket`
и вычисление Wave в worfy (`src/shared/workflow/waves.ts`).

## Цель

Пользователь Stable copy узнаёт о новой версии worfy сам и ставит её одной кнопкой вместе с Harness. Сборка
идёт в фоне, перезапуск — когда пользователь скажет, неудачная сборка ничего не ломает, а прежняя версия
возвращается одной кнопкой.

Epic готов, когда:

1. Stable copy при старте и раз в час узнаёт, есть ли Available update: голова `main` новее запущенной
   копии, `ci-ok` на ней зелёный, приложение или Harness менялись. Без сети ничего не видно и ничего не
   падает. Dev-сборка не проверяет.
2. Available update видно в трёх местах: точка на version chip в toolbar (меню «Update worfy · What's new
   · Later»), один sticky toast при старте, красная строка в Settings → Health. Так же видно отстающий
   Harness: акцентная кнопка Harness с точкой, toast, строка Health.
3. С «Update automatically» новая версия собирается в фоне в clone папки данных worfy. Готово — toast
   «worfy <version> ready · Restart now · Later»; пока Session в ходе или идёт Autopilot — «Restart when
   idle», и перезапуск случается сам, как только всё стихло.
4. После перезапуска работает новая Stable copy, её Harness поставлен без второго диалога и действует со
   следующей Session. Прежняя копия лежит как `worfy-stable.previous`; Settings → General → Updates «Roll
   back to previous version» возвращает её, и автоматический Update молчит до следующего commit-а `main`.
5. Сбой сборки: текущая копия работает, toast «Update failed · Show log», недостающие инструменты видны в
   Health; повтор — на следующем commit-е или по «Check now».
6. «What's new» показывает заголовки PR, влитых между запущенной копией и новой версией.
7. Всё это одинаково на macOS и на Windows.

Проверку семи пунктов делает Ticket 12 вместе с владельцем: Mac и Windows-ПК.

## Как устроено

- **Состояние Update** — свои файлы worfy в `<dataRoot()>/update/` (`src/main/storage/paths.ts:35`,
  ADR-0005): `state.json` (последняя проверка, Available update, сборка, откат), `repo/` (clone), `build.log`,
  `restart.json` (что сделать после перезапуска), `result.json` (итог помощника замены). Ведёт их main;
  renderer получает снимок и изменения по домену IPC `update` (новый, `src/shared/ipc/update.ts`; все каналы `local`). Схема состояния целиком —
  в Ticket-е 01, следующие Ticket-ы её заполняют и не меняют.
- **Где Update включён** (Р1). `app.isPackaged` и программа запущена из Stable copy: путь — как
  `defaultTarget` скрипта (`scripts/install-stable.mjs:74-77`). Запущенный commit — из файла
  `<target>.json` рядом с копией (`metadataPath`, `:114-116`; поле `commit`, его пишет `:827`), без файла —
  SHA из build version (`app.version`, `src/main/ipc/app.ts:7`; формат `scripts/build-version.ts:11`).
- **Проверка** (Ticket 01). Без входа, `https://api.github.com/repos/IDSAD-XL/worfy/…`: голова `main`
  (`commits/main`), check `ci-ok` на ней (`commits/<sha>/check-runs?check_name=ci-ok`), сравнение
  (`compare/<running>...<head>`: `status`, `commits`, `files`), версия из `package.json` на голове
  (`contents/package.json?ref=<sha>`). Последние два — только когда голова новее. Адрес API подменяется
  переменной `WORFY_UPDATE_API` — для test-ов.
- **Сборка** (Ticket 03). `git clone https://github.com/IDSAD-XL/worfy.git <update>/repo` один раз, потом
  `git fetch` и `git checkout --force <sha>`; `pnpm install --frozen-lockfile`; сборка той же командой, что
  `buildCommand` скрипта (`scripts/install-stable.mjs:201`). Журнал — `build.log`. Одна сборка за раз.
  `node`, `pnpm`, `git` ищутся так же, как First run (`toolStart`, `src/main/first-run/checks.ts:196`;
  `runTool`, `:232`).
- **Замена и откат** (Ticket-ы 02 и 04). `scripts/install-stable.mjs` из clone, запущенный системным
  `node` отдельным процессом (detached), ждёт выхода worfy, ставит собранную копию
  (`WORFY_STABLE_PREBUILT`, `:723`; `swapIn`, `:263`), прежнюю переносит в `worfy-stable.previous` вместо
  удаления (`:804-811`) и запускает новую. Откат — тот же скрипт, обратный обмен. Итог скрипт пишет в файл,
  worfy читает его при старте.
- **Когда всё стихло** (Ticket 04, Р6). Session в ходе — состояние `busy` или `needs_permission`
  (`inTurn`, `src/main/agent/session.ts:111`) у одной из `SessionRegistry.list()`
  (`src/main/agent/session/registry.ts:104`; общий экземпляр — `sharedRegistry()`,
  `src/main/agent/app-registry.ts:197`; события — `observe`, `registry.ts:50`); background tasks —
  `Session.backgroundTasks()` (`session.ts:221`). Autopilot — `Autopilot.anyRunning()`
  (`src/main/autopilot/run.ts:809`; экземпляр — `sharedAutopilot()`, `src/main/ipc/autopilot.ts:143`;
  выход и так ждёт его остановки, `:195-196`).
- **Harness после Update** (Ticket 05). `restart.json` называет версию, на которую обновлялись. После
  старта новой копии, если это версия её Harness (`bundledHarnessVersion`, `src/main/harness/bundled.ts:25`),
  main зовёт `HarnessInstaller.install` (`src/main/harness/install.ts:422`) с `confirm`, который сразу
  отвечает «да». Сравнение версий — `compareHarnessVersions` (`install.ts:233`).
- **Сигналы** — toolbar (Ticket 06: version chip, `src/renderer/shell/toolbar/HarnessStatus.tsx:102-106`;
  кнопка Harness, `:146-156`, `IconButton` `:73`), toast-ы (Ticket 07: `showToast`,
  `src/renderer/toast/toasts.ts:131`; `action` toast остаётся до закрытия, `:8`; один toast на `key`, `:10`),
  Health (Ticket 08: проверки First run, `src/main/first-run/checks.ts:302-323`, строка Harness —
  `:619-644`). Settings → General — Ticket 09 (`src/renderer/settings/GeneralSection.tsx`, `order` 10;
  разделы находятся сами, `src/renderer/settings/sections.ts:35`). Command palette —
  `src/renderer/palette/commands.ts`.

## Этапы

1. **Основа** — 01: проверка и состояние; 02: режим замены и отката в `scripts/install-stable.mjs`.
2. **Сборка** — 03: clone и сборка в папке данных, «Update automatically».
3. **Перезапуск** — 04: «Restart now», «Restart when idle», откат из приложения.
4. **Harness и UI** — 05: Harness после Update; 06: toolbar; 07: toast-ы; 09: Settings и Command palette.
5. **Health и What's new** — 08: строки Health; 10: What's new.
6. **Документ** — 11: Feature page.
7. **Приёмка** — 12: с владельцем, Mac и Windows-ПК.

## Ticket-ы

| Ticket | Что | Решение | Blocked by |
| --- | --- | --- | --- |
| [01](issues/01-проверка-available-update-в-main.md) | GitHub API без входа, фильтр `ci-ok` и путей, состояние `update/state.json`, домен IPC `update`, store в renderer | 1, 2, 11; Р1–Р4, Р15 | — |
| [02](issues/02-install-stable-ждёт-выхода-хранит-прежнюю-копию-и-откатывает.md) | `scripts/install-stable.mjs`: ждёт выхода копии, `worfy-stable.previous`, откат, запуск копии, файл итога | 3, 6, 9; Р7, Р8 | — |
| [03](issues/03-сборка-update-в-своём-clone.md) | clone в папке данных, `pnpm install` и сборка, журнал, недостающие инструменты, «Update automatically» | 3, 7, 8 | 01 |
| [04](issues/04-restart-now-restart-when-idle-и-откат-из-приложения.md) | Помощник замены после выхода, «Restart now», «Restart when idle», откат, итог при старте | 4, 7, 9; Р5, Р6, Р8 | 02, 03 |
| [05](issues/05-harness-после-update-и-отстающий-harness.md) | Harness новой копии без второго диалога; Harness того же semver, отстающий по `main` | 4; Р10 | 04 |
| [06](issues/06-version-chip-и-кнопка-harness-в-toolbar.md) | Точка на version chip и меню; акцентная кнопка Harness с точкой | 5, 6; Р11, Р12 | 03, 04 |
| [07](issues/07-sticky-toast-ы-update.md) | Toast при старте, «ready», «Restart when idle», «Update failed», итог перезапуска | 5, 7, 8; Р11, Р12 | 03, 04 |
| [08](issues/08-строки-health-worfy-и-harness.md) | Строка `worfy-update` и красная строка Harness; First run сам не открывается | 5, 8; Р9 | 01, 05 |
| [09](issues/09-settings-general-updates-и-command-palette.md) | Блок «Updates»: Check now, «Update automatically», откат; Command palette «Update worfy» | 6, 7, 9 | 03, 04 |
| [10](issues/10-whats-new.md) | Заголовки PR между копией и новой версией; пункт меню chip-а | 10; Р13 | 01, 06 |
| [11](issues/11-feature-page-update.md) | `docs/features/updates.md` и перевод | Р14 | 01–10 |
| [12](issues/12-приёмка-epic-а-worfy-update.md) | Приёмка с владельцем: Mac и Windows-ПК | 12 | 01–11 |

## Решения владельца

2026-10-31, все приняты. Номера — как у владельца; Ticket-ы ссылаются на них.

1. **Источник.** worfy читает SHA `main` через GitHub API без входа (публичный `IDSAD-XL/worfy`), один раз
   при старте и раз в час. Без сети — молча пропускается. Токен `gh` пользователя — никогда.
2. **Available update** — commit `main` новее запущенной Stable copy, с зелёным CI push (`ci-ok` `success`),
   который меняет приложение или Harness. Commit-ы только с документами и Ticket-ами не предлагаются.
3. **Сборка** — в одном постоянном clone в папке данных worfy (Mac `~/Library/Application
   Support/worfy/update/`, Windows `%APPDATA%\worfy\update\`), переиспользуется, около 2–3 GB; та же
   сборка, что `pnpm install:stable`; никогда не checkout пользователя и не папки Project-ов (ADR-0005).
   Нужны `node` и `pnpm`. GitHub Releases, подпись Developer ID и нотаризация остаются в E4 (ADR-0019) —
   главный компромисс ADR-0089.
4. **Harness.** «Update worfy» после перезапуска ставит и Harness новой копии без второго диалога (нажатие
   — согласие). Отдельная кнопка «Update Harness» остаётся для случая, когда отстаёт только Harness. Новый
   Harness действует со следующей Session.
5. **Сигналы** — и для «Harness out of date», и для «new worfy available»: акцентная кнопка в toolbar с
   точкой; один sticky toast при старте («… · Update · Later»); красная строка в Settings → Health.
6. **Места.** Version chip в toolbar (точка; меню «Update worfy · What's new · Later»); Settings → General,
   блок «Updates» («Check now», переключатель «Update automatically»); Command palette «Update worfy».
7. **Автоматически.** С «Update automatically» (по умолчанию включено) worfy собирает в фоне; перезапуск
   — только кнопкой пользователя: toast «worfy <version> ready · Restart now · Later». Пока Session в
   ходе или идёт Autopilot — вместо него «Restart when idle», который перезапускает, как только всё стихло.
8. **Сбой сборки** — текущая Stable copy остаётся, toast «Update failed · Show log»; недостающие
   инструменты видны в Health; повтор — на следующем новом commit-е или по «Check now».
9. **Откат.** Одна прежняя копия хранится как `worfy-stable.previous`; Settings → Updates «Roll back to
   previous version»; после отката автоматический Update молчит до следующего нового commit-а.
10. **What's new** — заголовки PR, влитых между запущенной копией и новой версией, с GitHub; файла
    changelog нет.
11. **Dev-сборки** — ни проверки, ни кнопки. Mac и Windows — одинаково.
12. **Когда.** Новый Epic — исключение владельца из правила «новых Epic-ов нет, пока не закрыты
    worfy-windows и worfy-browser»; раздаётся после onboarding 13 и 14.

## Решено без владельца

Каждый пункт — «решено без владельца». Ticket делает по пункту, пока владелец не сказал иначе; ответ
владельца правит пункт здесь и «Что делаем» Ticket-а.

- **Р1. Update только у Stable copy** (Ticket 01) — решено без владельца. Проверка включена, когда
  `app.isPackaged` и `process.execPath` лежит внутри Stable copy (путь `defaultTarget`). Упакованная сборка
  в другом месте (`pnpm test:package`, установщик в `%LOCALAPPDATA%\Programs\worfy`, копия в `/tmp`) — как
  dev-сборка: ни проверки, ни кнопки. Иначе worfy заменил бы Stable copy, которую не запускали.
- **Р2. «Меняет приложение или Harness»** (Ticket 01) — решено без владельца. В `files` сравнения есть хотя бы
  один путь вне `docs/**`, `.scratch/**`, `test/**`, `.github/**` и файлов `*.md` в корне. Список файлов
  обрезан (GitHub отдаёт не больше 300) — считается, что меняет. Лишняя сборка дешевле пропущенной правки.
- **Р3. Кандидат — только голова `main`** (Ticket 01) — решено без владельца. `ci-ok` на голове `success` —
  кандидат; `pending`, красный или нет check — Available update нет до следующей проверки. Сравнение
  должно дать `status: ahead`; `behind`, `diverged`, `identical` или 404 (копия собрана с ветки, которой
  нет на GitHub) — Update не предлагается.
- **Р4. Версия в текстах** (Ticket 01) — решено без владельца. `<version из package.json на этом
  commit-е>+<short SHA>` — тот же вид, что build version (`scripts/build-version.ts:14-19`).
- **Р5. «Update worfy» запускает сборку, перезапуск — всегда отдельная кнопка** (Ticket-ы 03, 04) — решено
  без владельца. И при выключенном «Update automatically»: сборка идёт минуты, и перезапуск посреди работы
  без второго нажатия был бы неожиданным. Согласие на Harness (пункт 4) — нажатие «Restart now» или
  «Restart when idle».
- **Р6. Что значит «всё стихло»** (Ticket 04) — решено без владельца. Ни одна Session не в `busy` и не в
  `needs_permission`, ни у одной нет background tasks, `Autopilot.anyRunning()` — `false` (он учитывает и
  остановленный run, который ждёт background tasks своего Orchestrator-а). Terminal-ы не учитываются: их
  процессы worfy и так закрывает при выходе.
- **Р7. Помощник замены — `scripts/install-stable.mjs` из clone** (Ticket-ы 02, 04) — решено без владельца.
  Запускает его системный `node`, а не Electron копии: файлы копии во время замены не должны быть заняты.
  Скрипт новой версии меняет копию, поэтому его исправления приходят с самим Update. Отметку `deploy`
  (`markDeploy`) этот режим не ставит: у пользователя нет `gh` с правом на статусы commit-ов.
- **Р8. Откат** (Ticket-ы 02, 04, 09) — решено без владельца. Сначала нативный диалог подтверждения
  «Roll back» / «Cancel». Копия, с которой откатились, удаляется; `worfy-stable.previous` пуст до следующего
  Update, кнопка отката неактивна. Harness откатанной копии ставится так же, как после Update, без второго
  диалога: подтверждение отката и есть согласие. Ручной `pnpm install:stable` прежнюю копию по-прежнему
  удаляет.
- **Р9. Красные строки Health не открывают First run** (Ticket 08) — решено без владельца. Строка
  `worfy-update` и строка `harness` для отстающего Harness — `fail`. Правило «First run открывается сам,
  когда появился новый `fail`» (`src/main/ipc/first-run.ts:217`) их не считает: сигнал при старте — toast,
  модального окна нет (пункт 5).
- **Р10. Отстающий Harness того же semver** (Ticket 05) — решено без владельца. Сегодня Harness того же semver
  из другого commit-а — «Replace Harness»: worfy не знает, какой новее (`compareHarnessVersions` →
  `unordered`, `install.ts:233-243`). У Stable copy с включённым Update сравнение GitHub
  `compare/<установленный SHA>...<SHA копии>` со `status: ahead` делает его отстающим: те же сигналы, что
  у Harness старшего semver. Не ответил GitHub — остаётся «Replace Harness».
- **Р11. Сигналы при «Update automatically»** (Ticket-ы 06, 07) — решено без владельца. Пока идёт фоновая
  сборка, toast «available» не показывается: видна только точка на chip-е, подсказка «Building worfy
  <version>…». Toast при старте — уже «ready», если сборка готова. Без автоматического Update — toast
  «available».
- **Р12. «Later»** (Ticket-ы 06, 07) — решено без владельца. «Later» в toast-е закрывает его до следующего
  старта worfy; «Later» в меню chip-а закрывает меню. Точка и строка Health остаются, пока Update не
  поставлен.
- **Р13. Откуда заголовки PR** (Ticket 10) — решено без владельца. Из `commits` того же сравнения: первая
  строка сообщения commit-а, который кончается на `(#<номер>)` (squash merge пишет туда заголовок PR). Без
  отдельного запроса на каждый PR — лимит 60 запросов в час без входа. Больше 250 commit-ов (столько
  отдаёт сравнение) — последняя строка «…and more on GitHub» со ссылкой на страницу сравнения.
- **Р14. Feature page — один Ticket в конце** (Ticket 11) — решено без владельца. Страница
  `docs/features/updates.md` пишется, когда поведение собрано целиком, а не кусками в шести PR одних
  Wave-ов: иначе их PR делили бы файл страницы. `app-shell.md` и `harness.md` получают ссылку на неё.
- **Р15. Ошибки GitHub — как нет сети** (Ticket 01) — решено без владельца. Ответ 403 или 429 (лимит), 5xx,
  обрыв — проверка пропущена, одна строка в log main; Settings показывает «Last checked <время>» и, после
  «Check now», причину.

## Тексты (черновик)

Все тексты интерфейса — английские. Ticket-ы берут их отсюда и не придумывают своих.

**Version chip в toolbar** (Ticket 06)

- Подсказка: «worfy <version> is available» · «Building worfy <version>…» · «worfy <version> is ready —
  restart to update» · «The update to <version> failed — see Settings → Health»
- Меню: «Update worfy» (при готовой сборке — «Restart now» или «Restart when idle»; во время сборки —
  неактивный «Building worfy <version>…») · «What's new» · «Later»

**Кнопка Harness** (Ticket 06) — подпись и подсказка — как сейчас («Update Harness: <from> → <to>»),
акцент и точка добавляются.

**Toast-ы** (Ticket 07)

- «New worfy <version> available» · «Update» · «Later»
- «Harness out of date: <from> → <to>» · «Update» · «Later»
- «worfy <version> ready» · «Restart now» · «Later»; пока не стихло — «Restart when idle» · «Later»
- после «Restart when idle»: «worfy restarts when no Session is working and Autopilot has stopped»
- «Update failed» · «Show log»
- после перезапуска: «worfy updated to <version>. The new Harness applies from the next Session.»
- Harness после Update не встал: «The Harness was not updated» · «Open Health»
- после отката: «worfy is back to <version>. Automatic updates wait for the next commit on main.»

**Settings → General → Updates** (Ticket 09)

- Строка «Updates»: «worfy <version>. Last checked <time>.» · «worfy <version> is available.» ·
  «Building worfy <version>…» · «worfy <version> is ready.»; кнопки «Check now», «Update worfy»
- Переключатель «Update automatically», описание: «Build new versions of worfy in the background. worfy
  restarts only when you say so.»
- «Roll back to previous version», описание: «Return to worfy <version>. Automatic updates wait for the
  next commit on main.»; без прежней копии — «No previous version is kept.»
- Подтверждение (нативный диалог): заголовок «Roll back to worfy <version>?»; текст «worfy quits, puts the
  previous copy back and starts it. Its Harness is installed too.»; кнопки «Roll back», «Cancel»
- Нет инструментов: «Updates need git, node and pnpm: <missing> not found. See Settings → Health.»

**Health** (Ticket 08), группа «worfy», строка «worfy version»

- `ok`: «<version>, up to date»
- `fail`: «<version> available», подсказка «Update worfy from the toolbar or Settings → General»
- `fail`: «update failed», подсказка — последняя строка журнала, действие «Show log»
- `fail`: «<tool> not found», подсказка «Updates need git, node and pnpm», команда установки
- строка Harness при отставании: `fail`, «<from> → <to>», подсказка «Update it to the Harness of this build»

**Command palette** (Ticket 09): «Update worfy», detail «worfy <version> available» · «ready — restart» ·
«check for a new version» (без Available update команда делает «Check now»).

**What's new** (Ticket 10): заголовок «What's new in worfy <version>»; строки «<PR title> #<number>»;
кнопка «Update worfy»; «…and more on GitHub».

## Не в этом Epic-е

- **GitHub Releases, `electron-updater`, подпись Developer ID, нотаризация, подпись установщика Windows** —
  E4 (ADR-0089, пункт 8).
- **Каналы обновлений** (beta, выбор ветки), Update на произвольный commit — нет: только голова `main`.
- **Update dev-сборки, копии из установщика и Linked machine-а** — нет (пункт 11, Р1). Каждая Machine
  обновляет свою Stable copy сама.
- **Файл changelog** — нет (пункт 10).
- **Проверка свободного места до сборки** — нет: нехватка места — тот же сбой сборки с журналом.
- **Откат больше чем на одну версию** — нет (пункт 9).

## Риски и открытые технические вопросы

1. **Инструменты сборки на Windows.** `pnpm install` пересобирает `node-pty` под Electron, а это требует
   компилятора. На ПК владельца он есть, у нового пользователя может не быть. Сбой сборки виден по
   пункту 8; строка Health называет только `git`, `node`, `pnpm`. Ticket 12 проверяет на ПК.
2. **Новая копия не стартует.** Откат — кнопка в Settings этой копии. Если копия падает до окна, откат
   руками: `worfy-stable.previous` переименовать обратно. Ticket 11 пишет это в Feature page; помощник
   замены (Ticket 02) проверяет только, что копия на месте, а не что она запускается.
3. **Сборка тратит время и место.** 2–3 GB и минуты CPU на каждый Update. «Update automatically» по
   умолчанию включено (пункт 7); Ticket 12 записывает время сборки на обеих машинах.
4. **Лимит GitHub без входа** — 60 запросов в час с адреса. За NAT-ом с другими машинами лимит общий;
   превышение — пропущенная проверка (Р15), а не ошибка.
5. **Выход с работающими Session-ами.** «Restart now» доступен, только когда всё стихло (пункт 7); во время
   ожидания «Restart when idle» пользователь может начать новый ход — перезапуск ждёт дальше.
6. **Autopilot над worfy идёт из Stable copy.** Update меняет её только после выхода и только когда
   Autopilot остановлен (Р6), так что run не теряет приложение посреди Wave. `scripts/install-stable.mjs`
   по-прежнему отказывается, пока копия запущена (`:711-720`); новый режим сначала ждёт выхода.
7. **Платформенные PR** (ADR-0056, пункт 2; ADR-0086). 02, 03 и 04 меняют работу с процессами, путями и
   файлами, у которой есть отличия Windows. Их вердикт Windows — по `scripts/windows-verdict-scope.mjs`.
   12 — приёмка на Windows-ПК.
8. **План Wave-ов — прогноз.** Wave, которую берут в работу, вычисляется заново в момент запуска
   (CONTEXT.md, термин Wave).

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-onboarding](../worfy-onboarding/spec.md), раздел «Соглашения для Ticket-ов этого Epic-а»:
сначала падающий test, ручные пункты «(вручную)», снимки UI в двух темах, Autopilot над worfy — только на
Stable copy. Отличия:

- **Начало** — после onboarding 13 и 14 (пункт 12). Раньше Ticket-ы не берутся.
- **Ветки** — `worfy-update/<NN>`; worktree — `.claude/worktrees/<NN>`.
- **Тексты** — только из раздела «Тексты (черновик)». Нужен новый текст — он сначала добавляется в этот
  раздел тем же PR, с пометкой «черновик».
- **Без настоящего GitHub в test-ах.** API — локальный HTTP-сервер из `test/update-stub.ts` (Ticket 01) с
  ответами-fixture; адрес — `WORFY_UPDATE_API`. Репозиторий для clone — локальный bare-репозиторий во
  временной папке (`WORFY_UPDATE_REPO`). Сборка — подменная команда, которая кладёт папку-«приложение»
  (`WORFY_UPDATE_BUILD`, Ticket 03).
- **Без настоящей Stable copy в test-ах.** Копия, `worfy-stable.previous` и `<target>.json` — во временной
  папке; путь — аргумент скрипта или `WORFY_UPDATE_STABLE`. Тест, который замечает путь в
  `~/Applications` или `%LOCALAPPDATA%`, падает (проверка в `test/update-stub.ts`).
- **Без Claude Code в test-ах.** unit, contract и e2e идут с `WORFY_AGENT=fake`; Harness ставится в
  песочницу `WORFY_CLAUDE_HOME`.
- **e2e Update** — в своих spec-файлах `test/e2e/update-*.spec.ts`. e2e запускают неупакованную сборку,
  поэтому Update в них включает `WORFY_UPDATE=1` (Ticket 01); без неё чужие e2e Update не видят.
- **Платформенный PR** — 02, 03, 04: пункт «Готово, когда» с вердиктом Windows (ADR-0056, пункт 2;
  ADR-0086; ADR-0071 для PR без окон и e2e).

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `src/main/update/github.ts`, `src/main/update/check.ts`, `src/main/update/state.ts`, `src/main/update/stable-copy.ts`, `src/shared/ipc/update.ts`, `src/main/ipc/update.ts`, `src/renderer/update/store.ts`, `src/main/index.ts`, `test/update-stub.ts`, `test/unit/update-check.test.ts`, `test/contract/update-github.test.ts`, `test/contract/update-state.test.ts` | 1 |
| 02 | `scripts/install-stable.mjs`, `test/unit/install-stable-functions.test.ts`, `test/unit/install-stable-update.test.ts` | 1 |
| 03 | `src/main/update/build.ts`, `src/main/update/auto.ts`, `src/shared/ipc/update.ts`, `src/main/ipc/update.ts`, `src/shared/settings/app-settings.ts`, `src/main/settings/store.ts`, `test/fixtures/update/`, `test/contract/update-build.test.ts`, `test/contract/app-settings.test.ts` | 2 |
| 04 | `src/main/update/restart.ts`, `src/main/update/idle.ts`, `src/shared/ipc/update.ts`, `src/main/ipc/update.ts`, `test/unit/update-idle.test.ts`, `test/contract/update-restart.test.ts` | 3 |
| 05 | `src/main/update/harness-after-update.ts`, `src/main/update/harness-lag.ts`, `src/main/index.ts`, `test/contract/update-harness.test.ts`, `test/unit/update-harness-lag.test.ts` | 4 |
| 06 | `src/renderer/shell/toolbar/HarnessStatus.tsx`, `src/renderer/shell/toolbar/UpdateChip.tsx`, `src/renderer/shell/shell.css`, `test/unit/harness-status.test.tsx`, `test/unit/update-chip.test.tsx`, `test/e2e/update-toolbar.spec.ts` | 4 |
| 07 | `src/renderer/update/toasts.ts`, `src/renderer/main.tsx`, `test/unit/update-toasts.test.ts`, `test/e2e/update-toasts.spec.ts` | 4 |
| 09 | `src/renderer/settings/GeneralSection.tsx`, `src/renderer/settings/UpdatesBlock.tsx`, `src/renderer/palette/commands.ts`, `test/unit/updates-block.test.tsx`, `test/unit/palette-commands.test.tsx`, `test/e2e/update-settings.spec.ts` | 4 |
| 08 | `src/main/first-run/checks.ts`, `src/main/ipc/first-run.ts`, `test/contract/first-run-checks.test.ts`, `test/unit/settings-health.test.tsx` | 5 |
| 10 | `src/main/update/whats-new.ts`, `src/shared/ipc/update.ts`, `src/main/ipc/update.ts`, `src/renderer/update/WhatsNew.tsx`, `src/renderer/shell/toolbar/UpdateChip.tsx`, `test/unit/update-whats-new.test.ts`, `test/unit/whats-new-view.test.tsx` | 5 |
| 11 | `docs/features/updates.md`, `docs/features/ru/updates.md`, `docs/features/README.md`, `docs/features/ru/README.md`, `docs/features/app-shell.md`, `docs/features/harness.md` | 6 |
| 12 | `.scratch/worfy-update/spec.md` | 7 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01 и 02.** Блокеров нет. Общих файлов нет: 01 — новый модуль `src/main/update/` и домен IPC;
  02 — только скрипт `install-stable` и его test-ы.
- **Wave 2 — 03, один.** Ждёт 01 (состояние, домен IPC).
- **Wave 3 — 04, один.** Ждёт 02 (режим замены скрипта) и 03 (готовая сборка, файлы домена `update`).
- **Wave 4 — 05, 06, 07 и 09.** 05 ждёт 04 (`restart.json`); 06, 07 и 09 ждут 03 (сборка, «Update
  automatically») и 04 (перезапуск, откат, «стихло»). Общих файлов нет: 05 — main, Harness; 06 — toolbar;
  07 — toast-ы; 09 — Settings и Command palette. `src/main/index.ts` у 05 и 01 — разные Wave-ы.
- **Wave 5 — 08 и 10.** 08 ждёт 01 и 05 (отставание Harness того же semver). 10 ждёт 01 и 06 (меню chip-а);
  по блокерам — Wave 5. Общих файлов нет: 08 — проверки First run; 10 — сравнение, домен `update`, окно и
  пункт меню.
- **Wave 6 — 11, один.** Ждёт 01–10: страница описывает собранное поведение (Р14).
- **Wave 7 — 12, один.** Ждёт все остальные Ticket-ы. Отмечает пункты «Готово, когда» в этом файле.

Таблица собрана руками по «Где в коде» Ticket-ов. Файлы, которые Ticket-ы допишут при claim, в таблицу не
вошли.
