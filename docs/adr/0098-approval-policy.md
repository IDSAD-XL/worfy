# 0098 — Approval policy для unattended Session-ов
Дата: 2026-11-06. Статус: принят.

**Контекст.** Autopilot ведёт Run через Session Orchestrator-а, запущенную unattended: человека нет, и до Epic-а
`worfy-auto-approve` любой запрос разрешения получал отказ сразу. Claude Code в `bypassPermissions` всё равно спрашивает
перед несколькими своими проверками (многострочный `zsh -c` с `rm`, `rm` по переменной, here-document); ночью такой
отказ ломал шаг Ticket-а, хотя команда оставалась внутри worktree. Перепись прошлых ночей (Ticket 01, spec
`.scratch/worfy-auto-approve/spec.md`, «Данные прошлых ночей») нашла на Mac-е 10 отказов: 6 — проверки shell-команд Claude Code, 4 — AskUserQuestion.
Владелец принял
направление 2026-11-04: три исхода, жёсткий запрет, Shadow mode, строка Journal на каждое решение, утренняя сводка,
тот же ответ на Codex.

**Решение.**

1. **Auto-approval — настройка Project-а на Machine с тремя положениями.** Off (по умолчанию): политика не зовётся,
   отказ как раньше, строка Journal `refused-dialog`. Shadow: политика считает исход и пишет его в Journal как
   `would-allow` / `would-deny` / `would-park` (hard deny — как `hard-deny`), а агент получает прежний отказ, без
   подсказок и без park, чтобы ночь Shadow можно было сравнить с ночью Off. On: исход политики и есть ответ. Режим
   читается при каждом запросе (`src/main/agent/auto-approve/mode.ts`), переключение действует со следующего запроса;
   режим, который не прочитать, — Off.
2. **Approval policy — чистая функция `judge(request, context)`** (`src/main/agent/auto-approve/policy.ts`). Вход —
   tool и его input; контекст — корни Run-а, окружение процесса Session-а, факты git, живые Session-ы. Исходы: allow,
   deny с подсказкой, park, hard-deny. Порядок проверки задан в коде: вопрос с вариантами ответа (AskUserQuestion) — deny
   с подсказкой «реши по правилам Project-а или запиши вопрос в Ticket»; команда, которую разбор не
   прочитал, — deny; hard deny; без домашней папки — deny; то, что агент может переписать (symlink на пути, удаление
   целого корня, config / hooks / attributes git) — deny; allow, если каждая цель внутри корней и каждое действие
   проходит одно из правил allow; всё остальное — park. Подсказка — константа модуля, без кусков пришедшей команды:
   prompt injection не может вернуть через неё модели свой текст.
3. **Корни** (`src/main/agent/auto-approve/roots.ts`): worktree-ы Ticket-ов текущей Wave, `.scratch` Project-а,
   папка Run-а для временных файлов (`<WORFY_DATA_DIR>/autopilot-tmp/<run>`, Session получает её как `TMPDIR`) и
   scratchpad Session-а. Цель каждой команды, которая пишет или удаляет, приводится к абсолютному пути (`cd` по ходу
   команды, `realpath` каждого существующего компонента). Путь вне корней — не allow; symlink-компонент на пути — не
   allow; сам корень удалять нельзя, только внутри него.
4. **Правила allow — список в коде** (`ALLOW_RULES`): файловые программы внутри корней без сети;
   `sh` / `bash` / `zsh -c`-скрипт, каждое действие которого проходит другое правило; git в worktree своей Wave без push и
   без удаления ветки; Edit / Write / MultiEdit / NotebookEdit (Claude Code) и `fileChange` (Codex) внутри корней. Push не
   одобряется никогда, самое большее park: URL remote-а лежит в config-е репозитория, которого политика не читает.
5. **Hard deny — в коде; ни режим, ни ответ владельца его не снимают.** Запись, удаление и чтение секретов в
   `~/.claude`, `~/.codex`, `~/.ssh`, `~/.gnupg`, `~/.config/gh`, `~/.gitconfig`, `~/.config/git`, `~/.npmrc`,
   файлах shell rc, `~/Library`, `%APPDATA%` и в папке данных worfy (кроме папки Run-а); запись и удаление в Harness
   home, в папках других живых Session-ов и в других worktree; программы настроек ОС и приложений (`sudo`, `launchctl`, `security`,
   `crontab`, запись `defaults` и подобные); `chmod` / `chown` вне корней; force push, push с удалением, push в ветку по
   умолчанию или в ветку другого worktree, удаление, checkout и commit таких веток; исполнение скачанного
   (`curl … | sh`); отправка наружу файла вне корней.
6. **Park** (`src/main/agent/auto-approve/park.ts`) — запрос открывается на gate Session-а Orchestrator-а как карточка
   разрешения с правилом и путями, уходит уведомление «Parked: …», остальные Subagent-ы работают. Один ответ покрывает
   один запрос: Always allow и «accept for this Session» не предлагаются. Без ответа за 60 минут или при остановке Run-а
   запрос получает отказ с подсказкой.
7. **Journal и сводка.** Каждое решение в Shadow и On — строка `auto-approval` (режим, исход, правило, цели с `~`
   вместо домашней папки, команда до 200 символов с секретами как `***`); `run-started` несёт режим Run-а. Утром
   решения видны в Run history (блок Auto-approval) и одной строкой в чате Orchestrator-а в конце Run-а:
   «Auto-approval: allowed 3, denied 1, parked 0» или «Shadow: would allow 2, would deny 1, would park 0».
8. **Режим хранит worfy, не Profile.** Место — `app-settings.json` папки данных worfy, поле `autoApproval` по id
   Project-а (`src/main/settings/store.ts`); пишет его только меню Modes через IPC. Пока worfy запущен с debugging port
   или Node inspector, действует Off, что бы ни было сохранено.

Вопрос Card-а (`session.ask`) до политики не доходит: unattended Session-у его отклоняет `refuseUnattended`
(`src/main/ipc/card-api.ts`) в любом режиме, со строкой Journal `refused-dialog`.

**Почему своя грамматика.** Разбор команды (`src/main/agent/auto-approve/shell.ts`) — маленькая консервативная
грамматика: простые команды, `&&`, `||`, `;`, `|`, кавычки, `$VAR` с известным значением, `cd`, присваивание литерала
и `X=$(mktemp -d)`, glob в последнем компоненте. Всё прочее (подстановка команды в цели, `eval`, циклы с целью-переменной,
исполняемый here-document, built-in-ы zsh, неизвестная переменная) — «не могу судить», и это deny, никогда не allow.
Готовые парсеры (`shell-quote`, `bash-parser`) решают другую задачу: им не нужно говорить «не знаю», и они читают
больше, чем мы можем проверить. Маленькую грамматику с отказом на остальное можно проверить целиком; differential
test сравнивает её разбор с настоящими `sh`, `bash`, `dash`, `zsh` (и Git Bash на Windows).

**Почему режим не в Profile.** Eco mode пишет Profile через Harness, и Profile агент меняет обычной командой
(`bin/profile-set`), файл в репозитории — коммитом. Настройка, которая разрешает агенту больше, не может лежать там,
где агент её сам переключит. Поэтому режим — в данных worfy, а hard deny от режима не зависит.

**Чего политика не закрывает.** В `bypassPermissions` Claude Code исполняет большинство команд без `canUseTool`:
политика видит только запросы, которые Claude Code сам счёл подозрительными. Значит, Auto-approval не делает Autopilot
опаснее `bypassPermissions`: он только говорит «да» части запросов, которые раньше получали «нет». Закрыть сам
`bypassPermissions` (sandbox Autopilot-а) — не это решение. Не видны разбору и aliases / functions из shell snapshot-а
Claude Code и опции zsh из `~/.zshenv`. Процесс того же пользователя может поправить `app-settings.json`, пока worfy
закрыт, или память работающего worfy: от процессов Machine с правами пользователя worfy себя не защищает. Electron fuses
собранного приложения (Ticket 12) закрывают только путь через Node inspector и `ELECTRON_RUN_AS_NODE`.

**Codex (Ticket 05).** Approval-запрос unattended Session-а Codex судит та же политика (`src/main/vendors/codex/session.ts`,
`judged`): allow → `accept`, deny и hard deny → `decline`, park ждёт владельца на той же карточке. Команда Codex-а
приходит в обёртке login shell (`/bin/zsh -lc '<script>'`). Обёртка `<shell> -lc` или `<shell> -c`, где shell — `zsh`,
`bash` или `sh` по имени или из `/bin`, `/usr/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, со скриптом одним словом в
кавычках и ничем после него, судится как `<shell> -c '<script>'` (`codexScript`); любая другая форма не одобряется. `fileChange` судится по каждому пути, который пишет; запрос с `grantRoot` (запись под папкой до
конца Session-а) политика не принимает никогда. У ответа Codex-а нет поля текста, поэтому подсказка правила остаётся
только в Journal. Пока unattended Codex идёт в Full access (`approvalPolicy: never`), запросов нет; ветка нужна для любого
другого preset-а.

**Последствия.** Переход Shadow → On делает владелец сам, когда просмотрел список `would-allow` в Run history.
Attended Session-ы не меняются. Новое правило allow — правка `ALLOW_RULES` со своим test-ом; ослабить hard deny нельзя
никаким режимом.

## Considered Options

- **Готовый shell-парсер** (`shell-quote`, `bash-parser`) — отклонено: такой парсер читает больше, чем мы можем
  проверить, и не умеет отвечать «не знаю»; ошибка разбора стала бы allow.
- **Режим в Profile, рядом с Eco mode** — отклонено: Profile агент меняет сам, без вопроса.
- **PreToolUse hook, который переписывает команду до проверки Claude Code** (вариант (в) Ticket-а 01) — не выбран:
  перепись не отнесла к нему ни одной категории отказов, и не проверено, видит ли проверка Claude Code изменённую
  команду. Вместо него — правила агента в `harness/hooks/rules/common.md` (Ticket 09).
- **Одобрять всё внутри Project-а без park** — отклонено: часть запросов (push, неизвестный tool, git при активных
  hooks) решает только человек; без park они уходили бы в allow или терялись в deny.
- **Включать сразу On, без Shadow** — отклонено: владелец хочет сначала увидеть, что политика разрешила бы, и
  переключить сам.

## Amendments

- 2026-11-06 — на Codex при суде не известна ни одна переменная окружения команды (ни `TMPDIR`, ни git-окружение Run-а,
  ни `HOME` / `USERPROFILE`): Codex 0.166.0 применяет `include_only` владельца после `shell_environment_policy.set`, и
  закреплённые worfy переменные могут не дойти до shell-а команды. Команда со ссылкой на такую переменную или с
  `mktemp -d` вне macOS не одобряется; `~` по-прежнему домашняя папка app-server-а (bash и zsh без `HOME` берут её из
  базы пользователей). git на Codex политика не одобряет никогда, а то, что одобрила бы на Claude Code, паркует как
  `git-without-run-environment` (worfy-auto-approve 14, PR #1498).
