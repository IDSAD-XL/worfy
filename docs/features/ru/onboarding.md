# Onboarding

> Перевод [английской версии](../onboarding.md), commit `same-pr`.

Как разработчик проходит путь от свежей установки до одного влитого Ticket-а. На странице три раздела. First run описывает
проверки Machine и действия, которые исправляют найденное. Getting started описывает список из шести шагов в боковой панели.
Demo project описывает небольшой Project, который worfy создаёт для этого списка. Термины объяснены в [Concepts](concepts.md).

## First run

### Behaviour

First run — это диалог поверх окна. Он перечисляет, что нужно worfy и Harness на этой Machine, и предлагает действие для того,
что можно исправить отсюда. Пока пользователь не подтвердит, ничего не меняется.

**Когда открывается сам.** worfy решает это один раз за загрузку окна. «Закрывался» значит, что диалог хотя бы раз закрыли на этой
Machine, любым способом.

| При запуске | Что открывается |
|---|---|
| Ни разу не закрывался, новый пользователь | Страница «Welcome to worfy», затем проверки |
| Ни разу не закрывался, существующий пользователь | Проверки |
| Закрывался, и сейчас падает проверка, которая не падала при последнем закрытии | Проверки |
| Закрывался, и новых упавших проверок нет | Ничего |

Что значит новый и существующий пользователь, сказано в разделе [Getting started](#getting-started).

**Другие входы.** «First-run checks» в Command palette открывает проверки в любой момент, с Project-ом и без него. То же делает
«Open checks» в шаге 1 Getting started. То же делают кнопки «First-run checks…» в диалоге «Add project», когда Harness останавливает
подключение или нет gh. Settings → Health показывает те же строки, действия и «Check again». Открытие этого раздела запускает
проверки, а закрытие Settings не считается закрытием First run.

**Страница «Welcome to worfy».** Она коротко объясняет три понятия: Project + Harness, Orchestrator и Canvas. Проверки уже идут за
ней. «Next» ведёт к ним. «Close» закрывает диалог как любое другое закрытие, поэтому сама страница больше не появится. При любом
другом входе First run начинается с проверок.

**Проверки.** В каждой строке есть chip (OK, Warning, Failed или Running…, пока идёт её действие), что найдено, строка о том, что
делать, и иногда команда с «Copy» или кнопка действия. Chip наверху подводит итог: «Checking…», «Everything is ready» или
«2 failed · 1 warning».

| Группа | Строка | Что спрашивает | Когда не OK |
|---|---|---|---|
| Claude Code | Sign-in | Учётную запись у процесса Claude Code, за 60 с | Failed, если вход не выполнен: запустить `claude`, затем /login. Failed и при отсутствии ответа |
| Claude Code | Claude Code in the terminal | `claude --version` против версии в этой сборке | Warning, если его нет, он старее или версия не читается, с `claude update`, кроме случая, когда его нет. Session-ы в worfy в любом случае работают на своей копии |
| Command-line tools | git, gh, jq | `--version` | Failed, с `brew install <tool>` |
| Command-line tools | git identity | `user.name` и `user.email`, вне любого репозитория | Warning, с двумя командами `git config --global` |
| Command-line tools | node | Версия 22 или новее | Failed, с `brew install node` |
| GitHub | GitHub accounts | `gh auth status` | Failed, если нет gh и если ни одна учётная запись не вошла, с «Sign in…» |
| Harness | Harness plugin | Состояние установщика | Failed, если не установлен («Install») или при ошибке установщика («Retry»). Warning, если выключен, с `claude plugin enable worfy@worfy-harness`, или если стоит другая версия («Update») либо та же версия из другой сборки («Replace») |
| Harness | Plugin dependencies | Plugin-ы, нужные plugin-у Harness | Failed, если какого-то нет, с «Install…». Warning, если проверить их пока не удалось |
| Harness | Harness scripts | `profile --help`, запущенный так же, как при чтении Epic-ов, за 15 с | Failed с exit code или сигналом и словами script-а: тогда worfy не читает Epic-и. Warning без Harness или без этого script-а |
| Harness | Old Harness in ~/.claude | Файлы старого Harness | Warning, с «Move…» |
| qmd | qmd | Версия 2.8.3 | Warning, если стоит другая версия, или если не установлен: «Install…» либо команда установки node, если node нет или он старше 22 |
| qmd | qmd models | Дан ли ответ на вопрос о моделях | Warning с размером и «Skip…», и «Download…», когда qmd установлен. После пропуска строка OK, а «Download…» остаётся, пока qmd установлен |
| qmd | qmd collections | Коллекции каждого подключённого Project-а с Profile | Warning с «Set up…» или с тем, что поставить сначала |

Размер моделей — 2.4 GiB или 2.2 GiB, если у какого-то Profile документы на русском. Строки qmd сообщают о найденном только как
Warning, потому что без qmd Harness ищет через grep. На ответ инструменту даётся 15 с. Проверка, которая бросила исключение, — Failed
с этой ошибкой, остальные строки всё равно работают.

**Действия.** Действие, которое что-то меняет, сначала показывает нативный диалог с «Confirm» и «Cancel», где названо, что произойдёт:
команда, папка и загрузка. Запускает его только «Confirm». Действия идут по одному, и пока идёт действие, диалог First run нельзя
закрыть. После действия проверки запускаются снова, кроме «Sign in…». Действие, которое упало, делает строку своей проверки Failed с
«The last attempt failed: …» до следующей попытки или пока сама проверка не пройдёт.

- «Install», «Update», «Replace», «Retry» и «Install…» в строках Harness запускают установщик Harness. Сборка для разработки показывает
  состояние и такой кнопки не предлагает, если `WORFY_CLAUDE_HOME` не указывает на sandbox.
- «Install…» в строке qmd запускает `npm install -g` для qmd в login shell. Модели — отдельный шаг.
- «Download…» и «Skip…» отвечают на вопрос о моделях. «Set up…» запускает script коллекций для каждого Project-а, у которого их нет.
- «Sign in…» спрашивает, затем ставит Terminal Node на Canvas активного Project-а с набранным `gh auth login`, и диалог закрывается.
  Пользователь отвечает на вопросы gh там и проверяет снова. Без Project-а кнопки нет, строка показывает команду для копирования.
- «Move…» открывает форму переноса старого Harness, которая спрашивает сама.

**«Check again»** сначала заново читает окружение login shell, поэтому инструмент, добавленный rc-файлом после запуска, становится
виден. Project боковой панели, у которого не прочитался Layout, затем пробует снова сразу.

**«Start Getting started»** стоит рядом с «Close» у нового пользователя, пока шаг 6 Getting started не отмечен. Кнопка закрывает
First run так же, как «Close», и показывает раздел боковой панели с фокусом на нём.

#### Windows

Список тот же, с такими отличиями. Первая строка диалога говорит «PC» вместо «Mac». Инструменты ищутся в PATH окружения, которое worfy
строит для Session, а не login shell. Команда для отсутствующего инструмента — `winget install` с `Git.Git`, `GitHub.cli`, `jqlang.jq`
или `OpenJS.NodeJS.LTS`. У инструмента, который не ответил, завершается всё дерево процессов.

- jq не обязателен: если его нет или он сломан, это Warning.
- **Git Bash** (Command-line tools): ищется так же, как его ищут Session-ы. Failed, если не найден и если
  `CLAUDE_CODE_GIT_BASH_PATH` называет несуществующий файл или файл в папке Windows, например запускатель WSL.
- **Windows version** (группа Windows): сборка 19044, Windows 10 21H2, или новее, иначе Failed. Нечитаемая сборка — Warning.
- **Architecture** (группа Windows): всё, кроме x64, — Warning. Предпочитается архитектура машины, а не процесса worfy.
- **PowerShell** (группа Windows): OK с PowerShell 7. Только с Windows PowerShell — Warning с `winget install Microsoft.PowerShell`.
- **Limits from terminal** (Claude Code): запускает ли status line Claude Code мост Limits этой сборки, иначе Warning. «Set up…» меняет
  только эту настройку, после диалога с нынешней и новой командой. У сборки для разработки своего моста нет, и кнопки в строке нет.

#### На Linked machine

First run и Settings → Health всегда описывают Machine, на экране которой показаны. Linked machine не может запускать эти проверки и
действия здесь. В «Add project» для папки на Linked machine диалог говорит, что Harness настраивается на той Machine, в её собственных
first-run checks, и что вход в gh делается там же.

### How it works

**Проверки только читают, а действия всегда спрашивают.** Проверка ничего не пишет. worfy не ставит git, gh, node и jq: он даёт команду
для копирования. То, что он запускает сам, он сначала называет.

**Окружение то же, что получают агенты.** Пройденная здесь проверка должна значить, что Session найдёт инструмент. Поэтому инструменты
запускаются с окружением login shell ([ADR-0007](../../adr/0007-claude-code-launch-environment.md)), а на Windows с окружением,
построенным для Session ([ADR-0057](../../adr/0057-agent-environment-on-windows.md)). Строка Harness scripts использует runner и окружение
чтения Epic-ов, поэтому падает по тем же причинам, что и это чтение.

**Вход — это вопрос к Claude Code.** Процесс Claude Code стартует как для Session и отвечает на `accountInfo()`
([ADR-0009](../../adr/0009-claude-code-login-check-account-info.md)). Он не получает prompt, не может использовать инструменты и
закрывается после ответа, ошибки или timeout-а.

**Отметка.** Закрытие диалога пишет собственный файл worfy `first-run.json` в папке данных
([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)) с проверками, которые падали в этот момент. При каждом следующем запуске main
гоняет проверки и открывает диалог только из-за нового падения, поэтому известное падение не возвращается при каждом запуске. Упавшее
действие считается, только пока его проверка не проходит, поэтому причина, исправленная вне worfy, диалог не откроет.

### Implementation

- `src/main/first-run/checks.ts` содержит все проверки и `runChecks`. Система, её release, архитектура и ответы инструментов приходят
  через `CheckDeps`, поэтому test-ы проверяют Windows на любой машине.
- `src/main/first-run/actions.ts` содержит `FirstRunActions`: диалоги, одно действие за раз и падения по строкам. Сама работа — в
  `src/main/harness/install.ts` и `src/main/harness/qmd.ts`.
- `src/main/ipc/first-run.ts` связывает их с приложением, пишет и читает отметку и сообщает Getting started о каждом отчёте. Каналы — в
  `src/shared/ipc/first-run.ts`, все с отметкой доступа `local`.
- `src/renderer/shell/FirstRun.tsx` — диалог. `src/renderer/shell/FirstRunConcepts.tsx` — страница приветствия.
  `src/renderer/shell/FirstRunChecks.tsx` рисует строки и запускает действия для диалога и для
  `src/renderer/settings/HealthSection.tsx`. `src/renderer/shell/first-run-store.ts` держит состояние вне React.
- `WORFY_FIRST_RUN_AUTO=0` не даёт диалогу открыться самому, для e2e-запусков, кроме его собственных.
- Главные test-ы: `test/contract/first-run-checks.test.ts`, `test/unit/first-run-windows.test.ts`,
  `test/unit/first-run-concepts.test.tsx` и `test/e2e/first-run.spec.ts`, который использует подставные инструменты из
  `test/fixtures/first-run-tools/`.

## Getting started

### Behaviour

Getting started — раздел боковой панели, выше Projects. В нём шесть шагов, которые проводят один Ticket Demo project от Orchestrator-а
через ревью до merge. Он ничего не блокирует и никогда не бывает модальным окном.

**Новый и существующий пользователь.** worfy решает это один раз, до первого окна, и больше не пересматривает.

| Пользователь | Чем определяется | Что получает |
|---|---|---|
| Новый | В списке нет Project-ов, не считая Demo project | Раздел показывается сам, а First run, если ни разу не закрывался, начинается со страницы приветствия |
| Существующий | В списке есть Project, или список не прочитался и отложен в сторону | Раздел скрыт. Одно уведомление в углу, «New: Getting started — a guided demo of worfy.», с «Open» и «Not now» |

Уведомление держится, пока пользователь не ответит или не закроет его. Как бы оно ни ушло, в следующем окне или при следующем запуске
оно не вернётся. «Open» показывает раздел.

**Шаги.** Шаг отмечается сам, когда факт верен, в любом порядке, и когда работа сделана другим путём. Первый неотмеченный шаг — текущий,
и только у него есть кнопка. Кнопка — это короткий путь, а не условие. Отмеченный шаг показывает галочку, а в tooltip — время.

| Шаг | Когда отмечается | Кнопка |
|---|---|---|
| 1 Check your setup | В отчёте проверок нет упавшей строки среди нужных demo (ниже). Warning не считается | «Open checks» |
| 2 Open the demo project | Demo project существует и стоит в списке Project-ов | «Create demo project» |
| 3 Meet the Orchestrator | Закончился ход Orchestrator-а demo | «Open the Orchestrator» |
| 4 Ship the ticket | Ticket demo прошёл Implementing | «Ship the ticket» |
| 5 See the review | Ticket demo прошёл Agent review | Нет |
| 6 Merge | Status Ticket-а demo — `done` | Нет |

Шаг 1 смотрит на проверки Sign-in, git, git identity, node, jq, Harness plugin, Plugin dependencies и Harness scripts. Считается любой
отчёт: при запуске, «Check again», после действия или в Settings → Health. git identity только предупреждает, поэтому шаг 1 может быть
отмечен, а «Create demo project» всё равно откажет из-за отсутствия автора commit-а.

Шаги 3 и 4 делают demo Project-ом окна, открывают его Orchestrator и кладут в поле ввода готовый текст: «What is planned in this
project?» и `/worfy:ship-ticket todo 01`. Ничего не отправляется: отправляет пользователь. Текст не ложится поверх того, что пользователь
уже набрал.

Удаление Demo project снимает шаги 2–6. В остальном отмеченный шаг остаётся: упавшая позже проверка не снимает шаг 1. Шаги продолжают
отмечаться, пока раздел скрыт или окно показывает другой Project.

**Подсказки.** Пока раздел виден и Ticket demo стоит на Stage с подсказкой, подсказка — строка под текущим шагом, а когда отмечены все, под
шагом 6. Кроме того, каждая подсказка один раз становится toast, с учётом всех окон и перезапусков. Этот toast принадлежит Demo project,
поэтому виден, только пока этот Project активен.

| Ticket demo | Подсказка |
|---|---|
| Queued, шаг 3 отмечен, шаг 4 нет | An Epic is a goal; a Ticket is one piece of work in it. Both are files in the project, under .scratch/. |
| Implementing | Implementer started in its own worktree — a separate checkout, so main stays untouched. |
| Agent review | The reviewer started. It reads the change and runs the project's checks itself. |
| Снова Implementing после упавшего ревью | The reviewer found a problem — this is the rework round. The implementer fixes it on the same branch. |
| Gate & merge | Review passed. The Orchestrator runs the Gate — the project's full checks — and merges. |
| Done | Merged. The ticket is done. |

**Ревью, которое ничего не нашло.** Demo устроен так, что ревью, вероятно, найдёт проблему, но это не гарантировано. Если шаг 5 отмечен, а
круга доработки не было, шаг говорит «This time the review found nothing.» и предлагает «Show an example». Это раскрывает на месте записанный
пример: REJECTED ревьюера с находкой, правка implementer-а и VERIFIED ревьюера.

**Done.** Когда шаг 6 отмечен, раздел показывает «Done — the ticket is merged» вместо шагов, с «Connect your own project» и «Remove the demo
project». «Show steps» возвращает список до следующего монтирования раздела.

**Выйти и вернуться.** «Skip» внизу скрывает раздел, ничего не удаляет и говорит, откуда он возвращается. «Getting started» в Command palette
показывает раздел снова в любой момент, развёрнутым и с фокусом на нём, с Project-ом и без него. «Connect your own project» под шагами не
входит в demo: «Connect…» открывает тот же «Add project», что и «+» в Projects.

#### Windows

Шаги и тексты те же. Шаг 1 смотрит ещё на Windows version, Architecture, PowerShell и Git Bash.

#### На Linked machine

Состояние принадлежит той Machine, на которой лежит, и Linked machine не может его прочитать или изменить. Окно, показывающее Linked machine,
всё равно показывает Getting started своей Machine.

### How it works

**Вид над фактами.** Шаги берутся из того, что произошло, а не из того, что нажато: проверки, список Project-ов, Session-ы, Stage-ы и Status
Ticket-а. Поэтому считается и шаг, сделанный другим путём, и ревью, прошедшее, пока окно было в другом месте. main не пишет Status Ticket-а:
источником остаются Stage-ы и файлы Harness ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md)). Само состояние — собственный файл
worfy `getting-started.json` ([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)).

**Сообщения отправляет пользователь.** Кнопки шагов 3 и 4 только готовят текст, чтобы Orchestrator был виден как Session, которая делает работу.

### Implementation

- `src/main/getting-started/state.ts` — файл состояния. Каждая запись — одно синхронное чтение, изменение и запись, в памяти между вызовами ничего
  не хранится, поэтому несколько источников не теряют отметки друг друга. Ключи, неизвестные этой сборке, сохраняются.
- `src/main/getting-started/progress.ts` отмечает шаги. Его `GettingStartedProgress` подписан на состояние, список Project-ов, все события Session-ов
  и Stage-ы demo; эта подписка закрывается, когда Project уходит из списка. `firstRunPasses` содержит проверки, на которые смотрит шаг 1.
- `src/main/ipc/getting-started.ts` содержит handler-ы и `startGettingStarted`, который `src/main/index.ts` запускает до первого окна. Это первое чтение
  решает, новый пользователь или существующий. Каналы — в `src/shared/ipc/getting-started.ts`, все с отметкой доступа `local`.
- `src/renderer/shell/sidebar/GettingStartedSection.tsx` — раздел. `src/renderer/getting-started/store.ts` держит снимок main в окне, а окно пишет только
  раздел и уведомление. `src/renderer/getting-started/hints.ts` выбирает подсказку. `src/renderer/getting-started/notice.ts` — уведомление.
  `src/renderer/getting-started/ReviewExample.tsx` и `src/renderer/getting-started/DoneScreen.tsx` — записанный пример и экран Done.
  `src/renderer/session/pending-input.ts` держит готовый текст.
- `WORFY_GETTING_STARTED_AUTO=0` оставляет раздел скрытым для нового пользователя и считает уведомление показанным, для e2e test-ов.
- Главные test-ы: `test/contract/getting-started-state.test.ts`, `test/unit/getting-started-progress.test.ts`,
  `test/unit/getting-started-section.test.tsx`, `test/unit/getting-started-hints.test.ts`, `test/unit/getting-started-notice.test.tsx`,
  `test/e2e/getting-started.spec.ts`, `test/e2e/getting-started-entry.spec.ts`, `test/e2e/getting-started-hints.spec.ts` и
  `test/e2e/getting-started-done.spec.ts`.

## Demo project

### Behaviour

Demo project — небольшой todo CLI в локальном git-репозитории, без GitHub. В нём один Epic, `todo`, и один Ticket, `01`: добавить `done <n>`, который
отмечает задачу сделанной. Агенты работают по-настоящему и расходуют Claude Code пользователя. worfy говорит об этом под шагом 2, без цен.

**Создание.** «Create demo project» в шаге 2 ничего не спрашивает и не тратит токены. Шаг показывает каждый этап строкой:

1. Creating the folder: `worfy-demo` в домашней папке, или `worfy-demo-2`, `-3` и так далее до `-100`, если имя занято. Папку пользователь не выбирает.
2. Writing the files.
3. Making the first commit, автором, которого знает git, с выключенными подписью и hook-ами для этого одного commit-а.
4. Connecting the project to the Harness, со своим Profile `worfy-demo`.
5. Adding the project: Project попадает в список.
6. Opening the Orchestrator. Затем Project становится активным. Сообщение не отправляется.

**Когда создать нельзя.** Шаг показывает «Could not create the demo project:» и причину. Главные причины:

| Причина | Что делать |
|---|---|
| Домашняя папка лежит внутри временной папки системы, которую система чистит | Там ничего не создаётся никогда |
| git не знает автора commit-а | Выполнить две команды `git config --global` из сообщения |
| git не запускается | Поставить git |
| Заняты имя и 99 папок после него | Освободить одну из папок |
| Harness не запускается или не знает `--no-qmd` | Проверить или обновить Harness в first-run checks |
| У Harness есть Profile `worfy-demo`, созданный не этим demo | Удалить или переименовать его. worfy оставляет его как есть |
| Harness отказывает в Project-е по другой причине | В сообщении слова Harness |

Сбой при создании отменяет сделанное этим вызовом: Project уходит из списка, активным снова становится прежний активный Project, Profile снимается, папка
удаляется. То, что отменить не удалось, названо после «Not undone:». Проверки автора и домашней папки идут первыми, поэтому отказ на них ничего не создаёт.

**Чем отличается от другого Project-а.** Это Full mode, и Ticket заканчивается локально: зелёный Gate full, затем ветка вливается в `main` этого репозитория.
PR и CI нет. В Pipeline пять Stage-й: Queued, Implementing, Agent review, Gate & merge и Done. Линзы ревью — correctness и tests. qmd для него не настраивается.

**Почему вероятен круг доработки.** Проверка изменения и Gate fast запускают только быстрые test-ы, которые покрывают `add` и `list`. Gate full запускает все
test-ы, в том числе уже сделанную задачу и номер вне списка. Ticket об этих случаях не говорит. Пока Ticket не сделан, быстрые test-ы проходят, а весь набор
падает только в test-ах `done`.

**Стоимость.** Под шагом 2, пока demo есть, переключатель «Demo agents» предлагает «Sonnet — a bit cheaper» и «Opus — a bit more expensive». Demo начинает на
Sonnet с effort medium. Opus использует effort модели по умолчанию. Выбор сохраняется для Orchestrator-а demo и доходит до работающей Session со следующего хода.
Если та Session отказывает, переключатель говорит, что выбор сохранён до следующего запуска, а работающая Session оставила свои настройки. Переключатель меняет
только demo.

**Удаление.** «Remove the demo project» стоит на экране Done, то есть доступна, когда шаг 6 отмечен. Сам demo не удаляется: ни от Skip, ни от Done, ни от
перезапуска. Сначала worfy проверяет, что папка — это созданный им demo, а иначе отказывает, ничего не трогая и ни о чём не спрашивая. Папка не может быть корнем
диска, домашней папкой или папкой над ней и не может пересекаться с папкой данных worfy. Кроме того, Harness должен знать её как `worfy-demo`, и этот Profile должен
быть привязан только к этой папке.

Затем нативный диалог спрашивает «Remove the demo project?», называет папку и говорит, что это нельзя отменить. «Cancel» — вариант по умолчанию, он ничего не делает.
После «Confirm»:

1. Orchestrator demo останавливается и не может открыться, пока удаление не закончится, а все Session-ы и Terminal-ы, работающие внутри папки, закрываются, и worfy
   ждёт их завершения.
2. Снимается Profile с записями в Gate registry и его runs. Если это не удалось, ничего не удаляется, и раздел говорит почему.
3. Project уходит из списка, его папка в папке данных worfy удаляется.
4. Снимаются шаги 2–6. Шаг 1 остаётся.
5. Удаляется папка, не больше 5 попыток с паузой 1 с.

Toast «The demo project was removed.» говорит, что всё получилось. Если что-то осталось, раздел называет это с причиной. Транскрипты demo в Claude Code остаются:
это данные Claude Code. После удаления список шагов возвращается, и шаг 2 может создать новый demo.

#### Windows

Создание и удаление demo работают на обеих системах одним кодом. Отвергаемая временная папка — `%TEMP%`. Profile пишет команды worktree с разделителями `/` и
одинарными кавычками, для Git Bash.

#### На Linked machine

Для Linked machine Demo project не существует. Его нет в списке, который она получает. Вызов, который называет его по id или по пути внутри него, получает отказ
`<name> is local to this Machine`, а события, которые его называют, не передаются. «Linked machines can work with my Projects» этого не меняет.

### How it works

**Шаблон, а не черновик.** При подключении другого Project-а черновик Profile пишет Session. У demo Profile уже готов в шаблоне, поэтому токены не тратятся, пока
пользователь не отправит первое сообщение.

**Файлы.** Шаблон — это код, а не ресурс сборки, поэтому упаковка ради него не меняется:

```text
worfy-demo/
  package.json                          без зависимостей; script-ы test:fast и test
  bin/todo.js                           CLI: add и list
  src/todo.js                           читает и пишет todo.json в текущей папке
  test/fast/todo.test.js                add и list
  test/full/cli.test.js                 CLI глазами пользователя, включая done и его крайние случаи
  README.md
  .gitignore                            todo.json и .claude/worktrees/
  .scratch/todo/spec.md                 Epic
  .scratch/todo/issues/01-done-command.md   Ticket
```

**Отметки без GitHub.** Отметка агентов `review` обычно — commit status на GitHub, а у этого репозитория нет `origin`. В Full mode с `workflow.finish` `local-green`
и без `origin` команда `bin/ticket mark` пишет файл отметок, который использует Silent mode, и worfy читает Stage-ы из него
([ADR-0045](../../adr/0045-one-ticket-one-repository.md), [ADR-0067](../../adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md)). Обе стороны применяют одно
правило. Файл — `<Harness home>/runs/worfy-demo/marks/todo-01.json`.

**Sonnet или Opus на всё demo.** Переключатель меняет только настройки Orchestrator-а. Implementer и ревьюер наследуют его модель, а effort берут из своих определений.

**Удаление сначала доказывается.** Удаление стирает папку, которую называет файл, поэтому файлу верят, только если Harness согласен. Orchestrator держится закрытым, потому
что окно, открывшееся в это время, иначе запустило бы Session в этой папке. Запись уходит раньше папки, потому что Stage-ы следят за папкой, пока запись её называет, а на
Windows папка под наблюдением может быть занята.

### Implementation

- `src/main/getting-started/demo-template.ts` содержит файлы и черновик Profile, включая запись Gate registry с fast script `test:fast` и full script `test`. Ввода и вывода
  в нём нет.
- `src/main/getting-started/demo.ts` содержит `createDemo`, его `DemoCreator` (одно создание за раз, второй вызов получает тот же ответ) и `DemoCostSwitch`. Запись, папка
  которой на месте, открывает этот demo снова. Запись, папка которой исчезла, снимается, а её Profile удаляется, только пока Gate registry ещё привязывает его к этой папке.
  Orchestrator открывается с `CHEAPER_SETTINGS` раньше, чем Project становится активным: приложение само открывает Orchestrator активного Project-а, и он стартовал бы на
  настройках по умолчанию.
- `src/main/getting-started/remove.ts` содержит `removeDemo`, `DemoRemover` и `protectedReason`. `keepClosed` из `src/main/agent/app-orchestrators.ts` держит Orchestrator
  закрытым.
- `harness/bin/project-connect` подключает с `--no-qmd` и снимает с `--remove`. `harness/bin/ticket` пишет отметки, а `marksInFile` из `src/main/workflow/stages.ts` читает
  то же правило.
- `localOnly` из `src/main/projects/store.ts` помечает Project. `src/main/link/caller.ts` и `src/main/link/ipc-adapter.ts` отказывают в вызовах и отбрасывают события.
- git, script-ы Harness, список Project-ов, Orchestrator-ы и состояние приходят через `DemoDeps`, `CostDeps` и `RemoveDeps`. `src/main/ipc/getting-started.ts` подключает
  настоящие. `src/renderer/getting-started/CostSwitch.tsx` — переключатель.
- Главные test-ы: `test/contract/getting-started-demo.test.ts`, `test/contract/getting-started-remove.test.ts`, `test/contract/getting-started-cost.test.ts`,
  `test/contract/demo-template.test.ts`, который запускает собственные test-ы шаблона и настоящий `project-connect --check`, `test/unit/demo-template.test.ts`,
  `test/unit/getting-started-cost-switch.test.tsx` и `test/unit/link-caller-local-only.test.ts`.
