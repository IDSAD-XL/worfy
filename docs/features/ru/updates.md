# Updates

> Перевод [английской версии](../updates.md), commit `same-pr`.

Одна Feature. **Update** заменяет Stable copy новой сборкой `main` вместе с её Harness. **Available update** — commit
`main`, который новее запущенной Stable copy, с зелёным CI и меняет приложение или Harness. Термины объяснены в
[Concepts](concepts.md).

## Update

### Behaviour

**Где Update включён.** Только в Stable copy: в упакованном приложении, которое запущено из того места, куда ставит
`pnpm install:stable`, — `~/Applications/worfy-stable.app` на macOS и `%LOCALAPPDATA%\worfy-stable` на Windows.
Dev-сборка, копия установщика и упакованная сборка в любом другом месте Update не проверяют и ничего о нём не показывают.
Так worfy никогда не заменяет Stable copy, которая не запущена.

**Проверка.** Через десять секунд после старта и потом раз в час worfy без входа спрашивает GitHub о голове `main`
публичного репозитория `IDSAD-XL/worfy`. Голова — Available update, когда выполнено всё это:

- это не тот commit, который запущен;
- её check `ci-ok` от push прошёл успешно. Pending, упавший или отсутствующий check — Available update нет до следующей
  проверки;
- сравнение GitHub говорит, что она впереди запущенного commit-а. Копия, собранная с ветки, которой на GitHub нет, Update
  не получает;
- commit-ы между ними меняют хотя бы один путь вне `docs/`, `.scratch/`, `test/`, `.github/` и Markdown-файлов корня
  репозитория. Список из 300 файлов, на котором GitHub его обрезает, считается изменением.

Тексты называют новую версию как `<version из package.json на этом commit-е>+<short SHA>` — в том же виде, что build
version приложения. Кандидат — только голова `main`: каналов обновлений и Update на другой commit нет. Нет сети, отказ
или сбой GitHub, запрос дольше 15 секунд — проверка пропускается: одна строка в log main process. Плановая проверка на
экране ничего не показывает; проверка, которую запустил «Check now», показывает свою причину в Settings. Без входа
GitHub даёт 60 запросов в час с одного адреса, проверка тратит от одного до четырёх.

**Где это видно.**

| Место | Что |
|---|---|
| Version chip | Версия приложения во второй строке пункта Harness в toolbar становится кнопкой с акцентной точкой. Tooltip: «worfy <version> is available», «Building worfy <version>…», «worfy <version> is ready — restart to update» или «The update to <version> failed — see Settings → Health». Меню: «Update worfy» (после сборки — «Restart now» или «Restart when idle»; во время сборки — неактивный «Building worfy <version>…»), «What's new» и «Later», который только закрывает меню |
| Toast-ы | См. следующую таблицу |
| Settings → General | Блок из трёх строк: «Updates», «Update automatically» и «Roll back to previous version» |
| Settings → Health | Строка «worfy version» группы «worfy»: «<version>, up to date», «<version> available», «update failed» с «Show log» или «<tool> not found». Её сбои сами First run не открывают |
| Command palette | «Update worfy» в группе Action, с подробностью «worfy <version> available», «ready — restart» или «check for a new version» |

Точка и строка Health остаются, пока Update не поставлен. Toast-ы:

| Текст | Кнопки | Когда |
|---|---|---|
| «New worfy <version> available» | Update, Later | Available update, пока «Update automatically» выключен |
| «worfy <version> ready» | Restart now или Restart when idle, Later | Сборка готова. Первая кнопка меняется на месте, когда работа начинается или кончается |
| «worfy restarts when no Session is working and Autopilot has stopped» | Нет | После кнопки «Restart when idle» в toast-е «ready», когда worfy начинает ждать |
| «Update failed» | Show log | Сборка упала |
| «Harness out of date: <from> → <to>» | Update, Later | Установленный Harness отстаёт от Harness этой копии |
| «worfy updated to <version>. The new Harness applies from the next Session.» | Нет | Первый старт после перезапуска в Update |
| «worfy is back to <version>. Automatic updates wait for the next commit on main.» | Нет | Первый старт после отката |
| «worfy was not updated to <version>: <reason>» или «rolled back» вместо «updated» | Нет | Перезапуск или откат не случился, или после него запущена не новая копия |
| «The Harness was not updated» | Open Health | Harness новой копии не встал |

«Later» или любой другой способ закрыть toast держит его закрытым до следующего старта; toast «available» приходит один
раз за загрузку окна, какой бы ни был commit. Новое состояние (другая сборка, новый сбой, другая версия Harness)
предлагается снова. Итог перезапуска сообщается один раз, а не при каждом старте.

**Settings → General → Updates.** Строка «Updates» говорит «worfy <version>. Last checked <time>.», «worfy <version> is
available.», «Building worfy <version>…» или «worfy <version> is ready.». Её кнопки — «Check now» и «Update worfy», а
для собранного Update — «Restart now» или «Restart when idle». Если проверка, которую запустил «Check now», была
пропущена, под строкой видна причина. Пока «Restart when idle» ждёт, под строкой видно «worfy restarts when no Session
is working and Autopilot has stopped», а её кнопка «Restart when idle» неактивна. В строке «Update automatically»
переключатель, в «Roll back to previous version» — кнопка «Roll back» (см. ниже). Где Update выключен, блока нет.

**Update automatically.** Переключатель по умолчанию включён: «Build new versions of worfy in the background. worfy
restarts only when you say so.» Включён — worfy сам собирает Available update сразу после проверки, которая его нашла.
Toast «available» тогда не приходит: chip показывает сборку, а toast «ready» приходит в её конце. Выключен — ничего не
собирается, пока пользователь не нажмёт «Update worfy» в меню chip-а, в Settings или в Command palette, или «Update» в
toast-е. В обоих случаях сборка никогда не перезапускает worfy: перезапуск — всегда отдельное нажатие.

**Сборка.** worfy собирает в своём clone в папке данных (см. [Storage and diagnostics](storage-and-diagnostics.md)):
`~/Library/Application Support/worfy/update/repo` на macOS, `%APPDATA%\worfy\update\repo` на Windows. Clone делается
один раз `git clone`, потом в него делается fetch. Сборка — та же, что у `pnpm install:stable`: `pnpm install
--frozen-lockfile`, потом `pnpm package`. Checkout пользователя и папки Project-ов не трогаются никогда. Вывод идёт в
`build.log` рядом с clone, новый на каждую сборку. Сборка идёт одна за раз. При включённом «Update automatically» более
новый commit, найденный во время сборки, собирается после неё; при выключенном более новый commit ждёт «Update worfy».
Выход из worfy во время сборки её останавливает, и commit считается не собранным, а не упавшим.

**Упавшая сборка** оставляет запущенную Stable copy как есть. Tooltip chip-а называет сбой, toast «Update failed»
предлагает «Show log», который открывает `build.log` программой системы для такого файла, а строка Health говорит «update
failed» с последней строкой журнала. Если git, node или pnpm нет в PATH, ничего не запускается: Settings говорит «Updates
need git, node and pnpm: <missing> not found. See Settings → Health.», а Health называет инструмент с командой, которая
его ставит. Шаг git дольше 30 минут останавливается, и сборка падает. Полный диск — такая же упавшая сборка с журналом:
проверки свободного места заранее нет. Упавший commit worfy сам заново не собирает: следующий новый commit `main`
собирается как обычно, а «Update worfy» собирает тот же ещё раз.

**Перезапуск.** Собранный Update ставится только нажатием «Restart now» или «Restart when idle» — в toast-е, меню chip-а,
Settings или Command palette. «Restart now» предлагается, пока ничего не работает, «Restart when idle» — пока что-то
работает. Ничего не работает, когда ни одна Session не в ходе (busy или ждёт разрешения), ни у одной Session нет
background task и не идёт ни один run Autopilot, включая остановленный run, который ещё ждёт background tasks своего
Orchestrator-а. Terminal-ы не считаются: их процессы worfy и так закрывает при выходе. «Restart when idle» перезапускает
сам, как только всё стихло. Ход, начатый за это время, заставляет ждать дальше, а выход из worfy снимает ожидание.

Затем worfy выходит, и замену делает отдельный процесс. Он ждёт выхода worfy, не больше двух минут, отодвигает
работавшую копию в `worfy-stable.previous`, ставит сборку на её место и запускает её. Нажатие — это и согласие на
Harness новой копии (см. ниже). Если в замене отказано, например потому что процесс старой копии после ожидания ещё
работает на её месте, ничего не меняется: старая копия запускается снова и показывает «worfy was not updated to
<version>: <reason>». Перезапуску нужен системный `node`; без него на нажатие приходит отказ с «node was not found: a
restart into an Update needs it (Settings → Health)».

**Harness после Update.** При первом старте новой копии worfy ставит её Harness, если установленный устарел или его нет,
без второго диалога и только один раз. Claude Code берёт его со следующей Session. Сбой показывает «The Harness was not
updated» с «Open Health», а пункт Harness — своё состояние ошибки с Retry. Подробности — на странице
[Harness](harness.md#installing-from-the-app).

**Harness out of date.** Harness, который отстаёт от Harness этой копии, виден в трёх местах. Кнопка «Update Harness» в
toolbar получает акцент и точку, toast «Harness out of date: <from> → <to>» предлагает «Update», а строка Health «Harness
plugin» падает с «<from> → <to>» и «Update it to the Harness of this build». Меньший semver отстаёт в любой сборке, но
toast приходит только там, где Update включён. Для того же semver из другого commit-а worfy спрашивает GitHub, и только
пока Update включён; нет ответа от GitHub — нет сигнала, остаётся простой «Replace Harness».

**Откат.** Settings → General → Updates, строка «Roll back to previous version», кнопка «Roll back». Строка называет
копию: «Return to worfy <version>. Automatic updates wait for the next commit on main.» Сначала спрашивает нативный
диалог: «Roll back to worfy <version>?», «worfy quits, puts the previous copy back and starts it. Its Harness is
installed too.», с «Roll back» и «Cancel». Как и перезапуск, откат отказывается, пока что-то работает, и замену делает
тот же процесс.

Хранится только одна прежняя копия. Копия, с которой откатились, удаляется, так что строка затем говорит «No previous
version is kept.», а её кнопка неактивна до следующего Update. После отката commit, с которого откатились, молчит: нет
точки на chip-е, нет toast-а, нет красной строки Health, и «Update automatically» его не собирает. Settings говорит
«worfy is back to <version>. Automatic updates wait for the next commit on main.» Следующий новый commit `main`
предлагается как обычно, а «Check now» снова предлагает и тот, что молчит.

**Когда новая копия не стартует.** Кнопка отката живёт в запущенной копии. Копию, которая падает до того, как откроется
окно, откатывают руками, при закрытом worfy. Рядом со Stable copy лежат прежняя копия и её файл: `worfy-stable.previous` и
`worfy-stable.previous.json`. На macOS, в `~/Applications`:

```sh
mv worfy-stable.app worfy-stable.failed.app
mv worfy-stable.previous worfy-stable.app
mv worfy-stable.previous.json worfy-stable.json
```

На Windows, в `%LOCALAPPDATA%`, те же три переименования: `worfy-stable` в сторону, `worfy-stable.previous` в
`worfy-stable`, `worfy-stable.previous.json` в `worfy-stable.json`. Файл называет commit, который запущен, и worfy сравнивает
с `main` именно его. Скрипт из clone делает то же с проверками:
`node ~/"Library/Application Support/worfy/update/repo/scripts/install-stable.mjs" --rollback` на macOS. Если новая
копия упала раньше, чем прочитала, чем кончился её перезапуск, первый старт после отката руками видит, что запущен не тот
commit, который поставил перезапуск. Он показывает «worfy was not updated to <version>: <old version> runs instead: the
new copy did not start, or was rolled back by hand», и commit, с которого откатились, молчит, как после «Roll back».
Новая копия, упавшая позже, это уже прочитала: тогда commit не молчит, и «Update automatically» собирает его снова;
выключите эту настройку, пока в `main` не появится более новый commit.

**What's new.** «What's new» в меню chip-а открывает popover под chip-ом: «What's new in worfy <version>», строку «<PR
title> #<number>» на каждый PR, влитый между запущенной копией и новой версией, новые сверху, и первый пункт меню chip-а
как кнопку. Новая версия — сборка, которая идёт или готова, иначе Available update. Строки берутся из одного сравнения на
GitHub: первая строка каждого commit-а, который кончается на `(#<number>)`, как пишет squash merge. Commit, запушенный в
`main` без PR, в список не попадает. Сравнение отдаёт не больше 250 commit-ов; при 250 последняя строка — «…and more on
GitHub», ссылка на страницу сравнения. Номера и эта ссылка открываются в браузере системы. Пока список читается, popover
говорит «Reading the pull requests on GitHub…», без PR — «No pull requests between this copy and the new version.», при
сбое показывает причину. Файла changelog нет.

#### On Windows

- Stable copy — папка `%LOCALAPPDATA%\worfy-stable`, прежняя копия — `%LOCALAPPDATA%\worfy-stable.previous`, данные
  Update — `%APPDATA%\worfy\update\`. Замена запускает `worfy.exe` новой копии.
- Перезапуску нужен `node.exe` в Path. Один `node.cmd` отказывается: «the node found is no program worfy can start by
  itself (node.exe)».
- Clone берёт байты `main` как есть (`core.autocrlf` выключен), что бы ни просил Git for Windows.

#### On a Linked machine

Update принадлежит Machine, на которой запущен. Все каналы Update закрыты для Linked machine, и каждая Machine обновляет
свою Stable copy сама.

### How it works

- **Источник — `main`, читается без входа.** worfy пользуется публичным GitHub API и никогда — токеном `gh`
  пользователя: ни один запрос не несёт заголовок Authorization, а `GH_TOKEN` и `GITHUB_TOKEN` не читаются
  ([ADR-0089](../../adr/0089-update-builds-main-in-own-clone.md), пункт 1).
- **Сборка идёт на Machine, в своём clone worfy.** Так не нужны подписанные сборки, а повторная сборка тянет только
  изменения. Цена — git, node, pnpm и место под clone на Machine. Checkout пользователя не используется никогда: в нём
  бывают незакоммиченные правки и чужие ветки, а worfy ничего не пишет в репозитории Project-ов
  ([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)).
- **Граница доверия — зелёный `ci-ok` на `main` репозитория worfy.** Перед каждым fetch remote clone-а снова ставится на
  заданный адрес, и commit собирается, только если он предок `main` там. Так API, который отвечает что угодно, может
  назвать только commit настоящего `main`. Шаги сборки идут без `GH_TOKEN` и `GITHUB_TOKEN`.
- **Замена — после выхода worfy, системным node.** Файлы запущенного приложения заменить нельзя, поэтому помощник —
  `scripts/install-stable.mjs` из clone, который системный `node` запускает отдельным процессом (detached). Его рабочая
  папка — папка Update, а не Stable copy: иначе Windows отказалась бы её переносить. Раз он приходит из clone, его
  исправления приходят вместе с самим Update. Итог он пишет в файл, и следующий старт его читает.
- **Перезапуск — всегда нажатие пользователя.** Сборка идёт минуты, и перезапуск посреди работы был бы неожиданностью.
  Нажатие — это и согласие на новый Harness, поэтому второго диалога нет
  ([ADR-0089](../../adr/0089-update-builds-main-in-own-clone.md), пункт 5).
- **Одна прежняя копия.** Замена хранит заменённую копию как прежнюю и удаляет ту, что хранилась до неё. Ручной `pnpm
  install:stable` прежней не хранит: он, как раньше, удаляет копию, которую заменяет.
- **Не здесь: подписанные сборки.** GitHub Releases, `electron-updater`, подпись Developer ID, нотаризация Apple и
  подпись установщика Windows остаются в E4 [roadmap](../../roadmap.md)
  ([ADR-0089](../../adr/0089-update-builds-main-in-own-clone.md), пункт 8;
  [ADR-0019](../../adr/0019-harness-claude-code-plugin.md)). На macOS копия, собранная Update, подписана ad hoc, как и
  копия `pnpm install:stable`.

### Implementation

| Что | Где |
|---|---|
| GitHub API без входа: голова `main`, `ci-ok`, сравнение, версия | `src/main/update/github.ts` |
| Является ли голова Available update; расписание проверок | `src/main/update/check.ts` |
| Где лежит Stable copy, какой commit она запускает, включён ли Update | `src/main/update/stable-copy.ts` |
| Файл состояния `update/state.json` | `src/main/update/state.ts` |
| «Update automatically»: какой Update собирается | `src/main/update/auto.ts` |
| Clone, сборка, `build.log`, недостающие инструменты | `src/main/update/build.ts` |
| Работает ли что-нибудь | `src/main/update/idle.ts` |
| «Restart now», «Restart when idle», откат, итог последнего перезапуска | `src/main/update/restart.ts` |
| Harness при первом старте после перезапуска | `src/main/update/harness-after-update.ts` |
| Harness out of date | `src/main/update/harness-lag.ts` |
| What's new | `src/main/update/whats-new.ts` |
| Замена, `--keep-previous`, `--rollback`, `--wait-pid`, `--relaunch`, `--result` | `scripts/install-stable.mjs` |
| Каналы `update` и сервис за ними; нативный диалог отката | `src/shared/ipc/update.ts`, `src/main/ipc/update.ts` |
| Старт и выход в приложении | `src/main/index.ts` |
| Настройка `autoUpdate` в `app-settings.json` | `src/shared/settings/app-settings.ts` |
| Строка Health «worfy version» и строка Harness | `src/main/first-run/checks.ts` |
| Снимок в renderer | `src/renderer/update/store.ts` |
| Version chip и What's new | `src/renderer/update/UpdateChip.tsx`, `src/renderer/update/WhatsNew.tsx` |
| Toast-ы | `src/renderer/update/toasts.ts` |
| Settings → General → Updates | `src/renderer/settings/UpdatesBlock.tsx` |
| «Update worfy» в Command palette | `src/renderer/palette/commands.ts` |
| Акцент «Update Harness» | `src/renderer/shell/toolbar/HarnessStatus.tsx` |

Файлы Update лежат в `<папка данных>/update`: `state.json`, clone `repo`, `build.log`, `restart.json` (что делает
перезапуск и из какой копии), `result.json` (что записал помощник) и `restart.log` (что помощник напечатал). Переменные
окружения для test-ов: `WORFY_UPDATE=1` включает Update в неупакованной сборке, `WORFY_UPDATE_API` подменяет адрес GitHub
API, `WORFY_UPDATE_REPO` — репозиторий clone-а, `WORFY_UPDATE_BUILD` — команду сборки, `WORFY_UPDATE_STABLE` — место
Stable copy.

Test-ы: stub GitHub `test/update-stub.ts`; `test/unit/update-check.test.ts`, `test/contract/update-github.test.ts`,
`test/contract/update-state.test.ts`, `test/contract/update-build.test.ts`, `test/unit/update-idle.test.ts`,
`test/contract/update-restart.test.ts`, `test/contract/update-harness.test.ts`, `test/unit/update-harness-lag.test.ts`,
`test/unit/update-whats-new.test.ts`, `test/unit/install-stable-update.test.ts`; интерфейс — в
`test/unit/update-chip.test.tsx`, `test/unit/update-toasts.test.tsx`, `test/unit/updates-block.test.tsx`,
`test/unit/whats-new-view.test.tsx`, и e2e test-ы `test/e2e/update-toolbar.spec.ts`, `test/e2e/update-toasts.spec.ts` и
`test/e2e/update-settings.spec.ts`.
