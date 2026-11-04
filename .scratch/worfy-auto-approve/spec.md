# worfy-auto-approve: ответ на запросы разрешения в unattended Run-е по политике

Status: принят владельцем 2026-11-04 («Да, всё»): направление, решения ниже и ответы Q1–Q8 — по рекомендации
(Q1 (а), Q2 (в) с ориентиром (б), Q3 (в) с пределом park 60 мин, Q4 (а), Q5 (а), Q6 (а), Q7 (а), Q8 (в)).
Source: слова владельца 2026-11-04 («Claude Code часто спрашивает разрешения даже в bypassPermissions … ночью в
Autopilot запрос отклоняется и шаг ломается»; принятое направление: три исхода, жёсткий запрет, Shadow mode, строка
Journal на каждое решение, утренняя сводка, переключатель рядом с Eco mode, паритет Codex, Ticket 01 — данные);
общее правило Harness «Shell commands without a confirmation» (`harness/hooks/rules/common.md:80`, worfy-harness 48,
PR #595); [CONTEXT.md](../../CONTEXT.md), термины Run, Journal, Orchestrator, Session, Subagent, Wave, Profile,
Linked machine; ADR [0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md),
[0005](../../docs/adr/0005-worfy-own-state-inventory.md), [0094](../../docs/adr/0094-vendor-seam.md). Соседний
черновик — Epic `worfy-retry` (переключатель Auto-continue: повтор хода после ошибок API и resume после Limits),
раздел «Соседний Epic worfy-retry».
Ticket-ы: Epic `worfy-auto-approve`, 11 Ticket-ов, нумерация с `01`. Шапка — `Type:` / `Status:` / `Blocked by:` /
`Source:`, как у worfy-faults.

## Проблема

Autopilot ведёт Run через Session Orchestrator-а, запущенную unattended: человека нет, и любой запрос разрешения
отклоняется сразу (`SessionStart.unattended`, `src/main/vendors/session.ts:72-73`). Claude Code в `bypassPermissions`
всё равно спрашивает перед несколькими своими проверками. Пример (Run 2026-11-03, Journal этого Mac-а):
implementer-Subagent запустил многострочный `zsh -c '…'`, внутри которого был `rm`. Claude Code дал `decisionReason`
«This shell -c script runs rm and could not be checked», worfy отклонил запрос, шаг Ticket-а сломался. Человек на месте
нажал бы Allow: скрипт удалял временную папку внутри worktree Ticket-а.

Такие же отказы дают `rm -rf *` после `cd`, `rm -rf "$M/$d"` и `rm -rf $T/*`: цель — переменная, которую Claude Code не
может разрешить статически, даже если папка из `mktemp -d`. Правило агента «удаляй по буквальному пути, скрипт — в
файл» (`common.md:80`) с 2026-10-20 снижает их число, но не до нуля: агенты его иногда не выполняют.

## Что уже есть (проверено по коду, main `e9b117d0e`)

- **Seam.** Каждый запрос разрешения уже проходит через worfy:
  - `PermissionAsker` (`src/main/vendors/session.ts:57-64`) — откуда driver берёт ответы человека; `SessionStart`
    (`:68-90`) несёт `unattended` (`:73`), `permissions` (`:77`, «not asked when unattended») и
    `refused(subject, message, details)` (`:79`); `RefusalDetails` — `agent`, `reason` (`:48-51`).
  - Claude: `canUseTool` unattended Session — `unattendedCanUseTool` (`src/main/vendors/claude/session.ts:133-140`):
    отказ на всё; `decisionReason` Claude Code уходит модели в тексте отказа (`unattendedDeniedMessage`, `:62-63`) и в
    `refused` вместе с `agentID` Subagent-а. Выбор между ним и `claudeCanUseTool` — `:391`. Unattended Session всегда
    в `bypassPermissions` (`src/main/vendors/claude/options.ts:496`; `launchSettings`,
    `src/main/agent/session-settings.ts:47`).
  - Codex: approval-запросы app-server-а (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`)
    → `approvalAsk` (`src/main/vendors/codex/approvals.ts:59`); unattended — `decline` сразу и `refused`
    (`src/main/vendors/codex/session.ts:586-590`). **Но** unattended Session Codex идёт в preset `full-access`
    (`approvalPolicy: 'never'`, `sandbox: 'danger-full-access'`, `src/main/vendors/codex/capabilities.ts:43-44`;
    `bypassPermissions → full-access`, `:59`): Codex в Autopilot сейчас не спрашивает ничего.
  - Gate Session-а — `PermissionGate` (`src/main/agent/permissions.ts:51`): открывает `permission_request`, ждёт
    ответа из transcript-а, помнит `allow_always` по subject-у. Unattended Session до него не доходит (`:26-27`).
  - Unattended бывает только Session Orchestrator-а под Autopilot-ом (`relaunch(entry, { unattended: true })`,
    `src/main/agent/orchestrator.ts:329`); implementer-ы — её Subagent-ы, их запросы приходят с `agentID`.
- **Куда идут отказы сегодня.**
  1. `Session.refuseDialog` (`src/main/agent/session.ts:199-202`, подключён в `:529`): `console.warn` в stdout процесса
     main (только tool, без команды) и событие `refused_dialog` подписчикам.
  2. Run Autopilot-а пишет его строкой Journal `refused-dialog` (`src/main/autopilot/run.ts:1152-1154`,
     `refusedDialogLine` `:404-412`): `session`, `what` = «permission_request <tool>», `agent`, `reason` — домашняя
     папка как `~`, не длиннее 200 (`journalReason`, `src/shared/autopilot/journal.ts:503`; `REASON_MAX` `:370`;
     схема `:448`). **Сама команда не пишется** (`run.ts:399-403`). Файл — `<WORFY_DATA_DIR>/autopilot/<run>.jsonl`
     (`src/main/autopilot/journal.ts:1`).
  3. Flight Recorder показывает строку отметкой на дорожке Orchestrator-а (`src/shared/flight-recorder/from-journal.ts:363`).
  4. Команду видно только в transcript-е Claude Code самой Session (`~/.claude/projects/…/*.jsonl`): `tool_use` и
     `tool_result` с текстом отказа.
- **Уведомления.** `src/main/notify.ts:302`: каждый `permission_request` Session-а, которую ведёт worfy, даёт
  уведомление macOS / Windows, когда окно worfy не в фокусе; уходит и на Linked machine-ы.
- **Eco mode** — образец переключателя: composer item `src/renderer/session/composer/EcoMode.tsx` (`order = 15`,
  `:18`; класс `w-eco`, `:110-127`; только у Orchestrator-а; read-only в окне Linked machine, `ECO_MODE_ELSEWHERE`
  `:23`), IPC `ecoMode` (`src/shared/ipc/eco-mode.ts`, `src/main/ipc/eco-mode.ts`, каналы `local`), toast-ы.
  Composer item-ы собираются сами (`import.meta.glob`, `src/renderer/session/composer/index.ts:46`): новый файл не
  правит общий список.
- **Guard Harness-а** `harness/hooks/guard.mjs` (PreToolUse на Bash) режет команду на сегменты простым `split`
  (`:106`): для «запретить» такого разбора хватает, для «разрешить» — нет.

## Данные прошлых ночей

Подсчёт — Ticket 01, скрипт `scripts/refusal-census.mjs` (Node, только читает; печатает числа по категориям и
очищенные шаблоны, ни команд, ни путей, ни id). Mac и PC — 2026-11-04, Journal-ы установленного worfy и все
transcript-ы `~/.claude/projects`. Ни одной строки из настоящих данных в репозиторий не скопировано. Отказ — `tool_result`
с `is_error: true`, текст которого начинается с текста отказа: на Mac так помечены все 10 (10 из 10 с `is_error: true`).

- **Journal (Mac):** 40 Run-ов (36 до правила 2026-10-20, 4 после), 9 строк `refused-dialog` в 8 Run-ах (7 до правила,
  1 после): Bash — 5, AskUserQuestion — 4, `card_ask` — 0. `reason` есть у одной строки (поле появилось позже).
- **Transcript-ы (Mac):** 8973 файла, отказ в 8; 10 отказов за 7 дней, 8 до правила и 2 после. Все Bash-отказы — у
  Subagent-ов (implementer-ы), все AskUserQuestion — у самой Session Orchestrator-а. Причина Claude Code есть у двух:
  «This shell -c script runs rm and could not be checked» — 1 (у команды без `rm` и без `-c`: проверка Claude Code
  судит по своему разбору), «Dangerous rm operation on statically-unresolvable target: <path>» — 1; без причины — 8.
- Journal видит на один Bash-отказ меньше transcript-ов (5 против 6); почему — не выяснено (Run без Journal-а или
  отказ вне Autopilot-а). Счёт по категориям — по transcript-ам: только в них есть команда.
- **Codex:** 0 (unattended Codex не спрашивает, «Что уже есть»).

Категории: `rm-after-cd-glob` — `rm` с glob в той же команде после `cd`; `rm-var-target` — цель `rm` с переменной;
`multiline-c-script` — `sh` / `bash` / `zsh -c` с многострочным скриптом; `bash-other` — прочий Bash; дальше —
AskUserQuestion, Edit / Write (`Edit`, `Write`, `MultiEdit`, `NotebookEdit`), MCP tool, неизвестный tool. Порядок
проверки Bash — как в таблице: первая подошедшая категория. Решения: (а) одобрение по политике (Ticket 03),
(б) правило агента (`common.md`, Ticket 09), (в) PreToolUse hook, переписывающий команду (Ticket 09), (г) ничего —
отказ правильный.

| Категория | Mac, всего (после правила) | PC, всего | Чем лечить |
| --- | --- | --- | --- |
| `rm-after-cd-glob` | 2 (1) | 0 | (а) правило «удаление внутри корней» с учётом `cd` по ходу команды; цель вне корней — park; (б) правило «удаляй по буквальному пути» уже есть (`common.md:80`) |
| `rm-var-target` | 2 (0) | 0 | (а) для `X=$(mktemp -d)` и `X=<буквальное>` в той же команде; цель из цикла — deny-with-hint; (б) уточнить правило: не удалять в цикле по переменной |
| `multiline-c-script` | 1 (0) | 0 | (а) только если разобрана каждая строка; zsh built-in-ы (`zmodload`, `typeset`, `setopt` …) — deny-with-hint; (б) «скрипт — в файл» уже есть |
| `bash-other` | 1 (0) | 0 | (г): записи и удаления в команде нет, проверку Claude Code не повторить — deny-with-hint без одобрения |
| AskUserQuestion | 4 (1) | 0 | (б) правило для Orchestrator-а под Autopilot-ом (Ticket 09): не спрашивать, решить по правилам Project-а или записать вопрос в «Вопросы владельцу» Ticket-а; политика — deny-with-hint (Q8 → (а)) |
| Edit / Write | 0 | 0 | (а) внутри корней; данных нет |
| MCP tool | 0 | 0 | park (Q3); данных нет |
| Неизвестный tool | 0 | 0 | park (Q3); данных нет |
| **Всего** | **10 (2)** | **0** | |

**Черновая политика по прошлым отказам (Mac, `--draft`).** Грубый набросок Ticket-а 03 внутри скрипта (корни —
worktree-ы репозитория `cwd`, его `.scratch`, scratchpad Claude Code, папка `mktemp -d`; symlink не проверяется):
allow — 0, deny-with-hint — 9, park — 1, hard-deny — 0. Причины deny: вопрос — 4, цикл или условие — 3,
here-document — 1, zsh built-in — 1; park — цель вне корней. Вывод: на данных Mac-а одобрение не спасло бы ни одного
шага — команды агентов сложнее грамматики «Как работает», п. 2. Пользу дают текст deny-with-hint (агент переписывает
команду) и правила агента (Ticket 09); одобрение (Ticket 03) — для простых команд, которых в этих данных нет.
Повтор с настоящей политикой — после Ticket 03.

**(в) PreToolUse hook — не выбран ни для одной категории.** `updatedInput` в ответе PreToolUse hook-а есть в
Claude Code 2.1.289, который ставит worfy (`@anthropic-ai/claude-agent-sdk` 0.3.289, поле `claudeCodeVersion` его
`package.json`): `PreToolUseHookSpecificOutput.updatedInput?: Record<string, unknown>`
(`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2752`), документация — https://code.claude.com/docs/en/hooks
(PreToolUse, decision control). Живьём не проверено (настоящий Claude Code в test-ах не запускается): видит ли
собственная проверка `rm` Claude Code уже переписанную команду, неизвестно. Кроме того, hook меняет команду
незаметно для агента, а deny-with-hint даёт тот же результат ценой одного хода. Поэтому Ticket 09 — только
правила агента (AskUserQuestion; удаление не в цикле, не в here-document, не в `-c`-скрипте).

**Q8 по данным:** вопросы — 4 из 10 отказов, все — у Session Orchestrator-а; ответ — (а) deny-with-hint и правило
агента (Ticket 09), park не нужен.

**PC (Windows), 2026-11-04**, прогон через Session PC (PowerShell, ветка Ticket-а): 755 transcript-ов, Journal-ов нет:
Autopilot на ПК не запускался (папки `%APPDATA%\worfy\autopilot` нет). Отказов 0 во всех категориях, черновая
политика 0 / 0 / 0 / 0. Вывода это не меняет. Но и про Windows эти нули ничего не говорят: unattended-данных на ПК ещё
нет, и отказы, текст которых бывает только на Windows (Git Bash, пути `C:\…`), этим подсчётом не проверены.

## Что видит владелец

1. **Переключатель Auto-approval** в строке под полем ввода Orchestrator-а, рядом с Eco mode и Auto-continue: три
   состояния **Off / Shadow / On**, по умолчанию Off, своё у каждого Project-а. Tooltip объясняет каждое; в окне Linked
   machine переключатель read-only («Auto-approval is set in worfy on the Machine of the Project»).
2. **Ночью** при Shadow — ничего нового: запросы отклоняются как сейчас, worfy только пишет, что разрешил бы. При On
   запрос в пределах Project-а проходит сам; запрос, который агент может переписать, отклоняется с подсказкой; запрос,
   который решает только человек, ставится на Park — уведомление «Parked: …» и карточка разрешения в Session
   Orchestrator-а, ответить можно утром.
3. **Утром** — сводка в Run history (Flight Recorder) и одна строка в чате Orchestrator-а в конце Run-а:
   «Auto-approval: allowed 3, denied 1, parked 0» или «Shadow: would allow 2, would deny 1». Каждое решение — строка
   Journal: правило, цели (пути с `~`), команда в сокращённом и очищенном виде.
4. Переход Shadow → On делает владелец сам, когда просмотрел список «would allow» (Q2).

## Как работает

1. **Где решается.** Driver unattended Session-а вместо безусловного отказа зовёт `judge(request, context)` — чистую
   функцию политики (`src/main/agent/auto-approve/`). Вход — то, что driver уже знает: tool, его input,
   `decisionReason`, `agentID` (Claude) или команда / файлы и `cwd` (Codex). Контекст — корни Project-а и Run-а (п. 3),
   окружение процесса Session-а, режим переключателя. Исходы:
   - **allow** — все действия команды ограничены разрешёнными корнями;
   - **deny-with-hint** — отказ с текстом, как переписать (удалить по буквальному пути, вынести скрипт в файл
     scratchpad-а, не спрашивать, а записать вопрос в «Вопросы владельцу» Ticket-а);
   - **park** — запрос открывается на gate Session-а (`PermissionGate`), как у attended Session, уведомление уходит
     через `notify.ts`; ждёт владельца не дольше предела (Ticket 07), потом — deny-with-hint;
   - **hard-deny** — отказ, который не снимает никакой режим и никакой ответ (п. 5).
   Shadow считает исход тем же способом, пишет его как `would-allow` / `would-deny` / `would-park`, а агенту отвечает
   ровно как сегодня.
2. **Разбор команды** (Ticket 02). Своя консервативная грамматика, не общий shell-парсер: простые команды, `&&`, `||`,
   `;`, `|`, перевод строки; слова в одинарных и двойных кавычках; `$VAR` и `${VAR}` только с известным значением;
   `cd <путь>`; присваивание `X=<буквальное>` и `X=$(mktemp -d)` в той же команде; glob `*`, `?` в последнем компоненте.
   Всё прочее — подстановка команды в цели, `eval`, `source`, функции, циклы и `if` с целью-переменной, исполняемый
   here-doc, process substitution, `zmodload` и другие built-in-ы zsh, неизвестная переменная — исход «не могу судить».
   **Что не разобрано, то не разрешено**: «не могу судить» даёт deny-with-hint, никогда allow. Внутренний скрипт
   `sh -c`, `bash -c`, `zsh -c` разбирается той же грамматикой как отдельная команда, с тем же окружением и `cwd`;
   многострочный скрипт допустим, если разобрана каждая строка.
3. **Разрешение путей.** Цель каждой команды, которая пишет или удаляет (`rm`, `rmdir`, `mv`, `cp`, перенаправление
   `>` / `>>`, `mkdir`, `touch`, `git clean`, `git worktree remove`, Edit / Write), приводится к абсолютному пути: `cd`
   учитывается по ходу команды, `..` и `.` сворачиваются, каждый существующий компонент проходит `realpath`.
   Разрешённые корни: worktree-ы Ticket-ов текущей Wave (`.claude/worktrees/<NN>` по Profile), `.scratch` Project-а,
   папка Run-а для временных файлов (worfy создаёт `<WORFY_DATA_DIR>/autopilot-tmp/<run>/` и даёт её Session-у как
   `TMPDIR`; `mktemp -d` без шаблона попадает туда) и scratchpad самой Session Claude Code. Путь вне корней — не allow.
   Symlink-компонент на пути цели — не allow, куда бы он ни вёл (защита от подмены папки ссылкой). Цель «весь корень»
   (`rm -rf <корень>`, `rm -rf <корень>/*` для worktree или `.scratch`) — не allow: удалять можно внутри корня, не сам
   корень. На Windows сравнение без учёта регистра, `\` и `/` — один разделитель, форма Git Bash `/c/Users/…` — тот же
   путь (как в `journalReason`).
4. **Правила allow** — список в коде, у каждого id и test. Стартовый набор (уточняет Ticket 01): удаление и перезапись
   внутри корней; многострочный `-c`-скрипт, все действия которого внутри корней; `git` внутри worktree своей Wave без
   push. Остальное — park или deny-with-hint (Q3).
5. **Hard deny — в коде; переключатель его не снимает; в Shadow пишется как hard-deny:**
   - пути вне Project-а на запись, удаление и чтение секретов: `~/.claude`, `~/.codex`, `~/.ssh`, `~/.gnupg`,
     `~/.config/gh`, `~/.gitconfig`, `~/.npmrc`, файлы shell rc, `~/Library`, `%APPDATA%`, папка данных worfy
     (`WORFY_DATA_DIR`, кроме папки Run-а), Harness home;
   - настройки приложений и ОС: `sudo`, `defaults write`, `launchctl`, `security`, `pfctl`, `socketfilterfw`, `netsh`,
     `reg`, `crontab`, `chmod` / `chown` вне корней;
   - git: force push (`-f`, `--force`, `--force-with-lease`, refspec с `+`), push в `main` / default branch,
     `push --delete`, `branch -D` и `worktree remove` чужой ветки или worktree;
   - worktree-ы и ветки других Session-ов: `cwd` живых Session-ов из `SessionRegistry` и ветки, checkout-нутые в
     других worktree (`git worktree list`);
   - исполнение скачанного: `curl … | sh`, `wget -O- | bash` и подобные;
   - отправка наружу файлов вне корней (`curl -T`, `--data @<файл>`).
6. **AskUserQuestion и вопросы Card-ов** не одобряются никогда: у вопроса нет «правильного» ответа без человека. Исход —
   deny-with-hint «никого нет: реши по правилам Project-а или запиши вопрос в «Вопросы владельцу» Ticket-а» (или park,
   если Ticket 01 покажет, что такие вопросы нужны владельцу; Q8).
7. **Journal.** Новая строка `auto-approval` на каждое решение: `session`, `agent`, `vendor`, `mode` (`shadow` / `on`),
   `outcome` (`allow`, `deny`, `park`, `hard-deny`, `would-allow`, `would-deny`, `would-park`, `park-answered`,
   `park-expired`), `rule` (id правила), `targets` (пути, домашняя папка как `~`), `command` — не длиннее 200,
   присваивания `NAME=…` с `TOKEN`, `KEY`, `SECRET`, `PASSWORD` в имени — `NAME=***`. Строка `refused-dialog` остаётся
   для отказов при Off и для `card_ask`. `run-started` получает поле режима Auto-approval.
8. **Паритет Codex** (Ticket 05). Approval-ветка Codex (`codex/session.ts:586`) зовёт тот же `judge`: allow → `accept`,
   deny / hard-deny → `decline`, park → открыть на gate, как у attended. Пока unattended Codex идёт в `full-access`,
   запросов нет, и в Autopilot ветка не исполняется; она нужна для любого другого preset-а и для Q7. Как передать
   модели Codex подсказку при `decline` (у ответа нет поля текста) — не проверено, выясняет Ticket 05.

## Безопасность

Модель угрозы: файл репозитория (README, fixture, текст issue через `gh`, страница в Browser-е) или prompt injection
уговаривает агента сделать опасное, и агент просит разрешения.

1. **Чего политика не закрывает.** В `bypassPermissions` Claude Code исполняет большинство команд вообще без
   `canUseTool`. Политика видит только то, что Claude Code сам счёл подозрительным. Значит, Epic не делает Autopilot
   опаснее bypassPermissions: он может только сказать «да» части запросов, которые сегодня получают «нет». Закрыть
   сам bypassPermissions (sandbox Autopilot-а) — не в этом Epic-е.
2. **«Удали всё».** `cd ~ && rm -rf *`, `rm -rf $HOME/*`, `rm -rf "$X"/` с `X` из окружения: цель вне корней или
   неизвестна → не allow; `~/.claude`, `~/.ssh` и др. — hard-deny.
3. **Обход через ссылку.** Агент создаёт `.scratch/l -> ~` и просит `rm -rf .scratch/l/*`: symlink-компонент на пути
   цели → не allow. Подмена папки ссылкой после решения (фоновой задачей того же агента) — тот же запрет сужает окно;
   остаток риска — «Риски», п. 1.
4. **Расхождение разборщиков.** Команда, которую наша грамматика читает иначе, чем настоящий shell (подстановка в
   цели, хитрые кавычки, `IFS`): подстановки в целях и неизвестные конструкции — «не могу судить» → не allow. Ticket 02
   сравнивает разбор с настоящим `sh` на наборе команд (differential test).
5. **Включить себе одобрение.** Режим хранит worfy в `app-settings.json` своей папки данных (не Profile, не
   репозиторий); пишет его только UI (IPC `local`). Profile агент меняет обычной командой `bin/profile-set`, файл в
   репозитории — коммитом, поэтому там режима нет. Правку файла данных worfy из Bash bypassPermissions не остановит
   (п. 1), поэтому: hard deny от режима не зависит, режим каждого Run-а стоит в `run-started` и в утренней сводке, и
   Ticket 06 проверяет, что worfy не подхватывает правку файла, сделанную не через UI, до рестарта (не проверено —
   как `store.ts` читает файл сейчас). Ответ Ticket-а 06: `store.ts` читает файл один раз; правка извне видна после
   рестарта, следующая запись любой настройки её затирает. **Debugging port — это Auto-approval Off.** С
   `--remote-debugging-port` / `--remote-debugging-pipe` или Node inspector (`--inspect`) любой процесс Machine ведёт
   окно worfy и зовёт его IPC как UI, а агент может и сам перезапустить worfy с таким флагом. Поэтому, пока такой
   флаг есть, `autoApprovalMode()` отвечает Off, `autoApproval.set` отказывает в Shadow и On, переключатель
   показывает Off и причину (Ticket 06). **Что закрыл Ticket 12.** До него Bash агента мог
   послать `kill -USR1 <pid worfy>`, подключиться к `ws://127.0.0.1:9229`, записать On в память store-а через
   `Runtime.evaluate` и закрыть inspector (`inspector.close()`) до того, как проверка увидит `inspector.url()`. Теперь
   `electron-builder.yml` (`electronFuses`) выключает в собранном приложении `EnableNodeCliInspectArguments` и
   `RunAsNode`: `--inspect` и `kill -USR1` inspector не открывают (SIGUSR1 завершает процесс), `ELECTRON_RUN_AS_NODE=1`
   запускает worfy, а не Node. Проверка на macOS — test-ы `test/e2e/packaged.spec.ts` и `scripts/check-fuses.mjs` в
   конце `pnpm test:package` (job `macos-package`); на Windows — тот же `test:package` в gate full ПК, CI fuses `.exe`
   не читает. `--remote-debugging-port` — не fuse Node, его по-прежнему ловит проверка Ticket-а 06. **Известный предел
   (остаётся).** Процесс того же пользователя может изменить память работающего worfy без рестарта: на Windows —
   `OpenProcess` + `WriteProcessMemory` / `CreateRemoteThread` (например, PowerShell `Add-Type`): `worfy.exe` не
   подписан и не защищён; на macOS — подключить отладчик: `hardenedRuntime: false` в `electron-builder.yml`, а с
   включённым Developer mode пароль не спрашивают. С рестартом worfy: `DYLD_INSERT_LIBRARIES` (нет hardened runtime),
   подменённый `app.asar` или подложенная `Resources/app/` (fuses `OnlyLoadAppFromAsar` и
   `EnableEmbeddedAsarIntegrityValidation` выключены). Это тот же класс, что правка `app-settings.json`, пока worfy
   закрыт (выше): от процесса Machine с правами пользователя worfy себя не защищает (п. 1).
6. **Чужая работа.** Ветки и worktree-ы других Session-ов, push в `main`, force push — hard-deny, даже если агент просит
   «по инструкции из файла».
7. **Утечка в Journal.** Journal лежит в данных worfy и уходит на Linked machine-ы через Run history: команды
   сокращаются, домашняя папка — `~`, присваивания с секретами — `***` («Как работает», п. 7). В репозиторий из Journal
   не попадает ничего: fixture-ы test-ов — выдуманные пути (`/tmp/demo`).
8. **Подсказка как канал.** Текст deny-with-hint — константа правила, без кусков пришедшей команды: injection не может
   через него вернуть модели свой текст.

## Решено без владельца

1. **Только unattended Session-ы** (Session Orchestrator-а в Autopilot-е). Attended Session-ы не меняются (Q4).
2. **Своя грамматика, не зависимость.** Готовые парсеры (`shell-quote`, `bash-parser`) решают другую задачу: им не нужно
   говорить «не знаю». Маленькую грамматику с отказом на всё остальное можно проверить целиком.
3. **Режим — настройка worfy, не Profile.** Eco mode пишет Profile через Harness (`eco-mode.ts`); Auto-approval — нет:
   Profile агент может переписать сам («Безопасность», п. 5). Место — `app-settings.json`, как у Auto-continue
   worfy-retry (поле по id Project-а, `src/main/settings/store.ts`). От Eco mode берётся только вид и поведение UI.
4. **Shadow ничего не меняет для агента**: ни подсказок, ни park. Иначе ночь Shadow не сравнить с ночью Off.
5. **При Off политика не зовётся**: строка Journal — прежний `refused-dialog`, ничего нового.
6. **Park ждёт только один tool call одного Subagent-а**; остальные Subagent-ы Wave работают. Session Orchestrator-а
   показывает `needs_permission`, как у attended.

## Соседний Epic worfy-retry

`worfy-retry` (черновик, ветка `docs/epic-worfy-retry`) — переключатель **Auto-continue**: повтор хода после
временных ошибок API и resume после Limits, тоже в чате Orchestrator-а, справа от Eco mode.

- **Общая панель — строка controls под полем ввода Orchestrator-а**: Eco mode (`order = 15`), Auto-continue (справа от
  Eco mode; предлагаю `order = 16`), Auto-approval (`order = 17`). Каждый Epic кладёт свой файл composer item-а; общий
  список не правится (`composer/index.ts:46`). Вид — класс `w-eco` Eco mode; у Auto-approval три состояния, поэтому
  Ticket 06 добавляет вариант трёх положений рядом с ним, не меняя `w-eco`.
- **Без пересечения по смыслу.** Auto-approval отвечает только на запросы разрешения (`canUseTool`, approval Codex,
  `refused`). Auto-continue — только на ошибки хода (`turn-error`, API 5xx / 529, Limits). Ни один не читает событий
  другого.
- **Общие файлы:** `src/shared/settings/app-settings.ts`, `src/main/settings/store.ts`, `src/renderer/session/session.css`
  (Ticket 06 и worfy-retry 02); `src/main/autopilot/run.ts` (Ticket-ы 04, 08 и worfy-retry 04, 05);
  `src/shared/autopilot/journal.ts` (Ticket 04 и worfy-retry 04). Ticket-ы двух Epic-ов с общим файлом не идут
  параллельно: Orchestrator ставит их по очереди.
- Утренняя сводка (Ticket 08) — свой блок в Run history; строки Auto-continue («повторено N раз») — соседний блок.

## Новые термины

Предложение для `CONTEXT.md`, переносит Ticket 10:

- **Auto-approval** — ответ worfy на запрос разрешения unattended Session-а по Approval policy вместо безусловного
  отказа: allow, deny-with-hint, park или hard-deny. _Avoid_: автоодобрение, autoyes.
- **Approval policy** — правила в коде worfy, по которым считается исход; hard deny — их часть, которую не снимает ничто.
  _Avoid_: whitelist, разрешалка.
- **Shadow mode** — режим Auto-approval, в котором исход только пишется в Journal, а агент получает прежний отказ.
- **Park** — запрос, оставленный открытым до ответа владельца, с уведомлением и пределом ожидания.

## Ticket-ы

- **01 — Перепись отказов прошлых ночей.** Скрипт подсчёта (Journal + transcript-ы, только числа и очищенные шаблоны),
  прогон на Mac и PC, таблица категорий в spec и решение по каждой: правило агента, PreToolUse hook или одобрение.
  Blocked by: —. Ревью: medium.
- **02 — Разбор shell-команды.** Грамматика, `cd`, переменные, `mktemp -d`, вложенный `-c`-скрипт, исход «не могу
  судить»; differential test с настоящим `sh`. Blocked by: —. Ревью: high.
- **03 — Approval policy: корни, правила, hard deny.** Разрешение путей, symlink, Windows, список правил с id.
  Blocked by: 01, 02. Ревью: high.
- **04 — Claude: политика в unattended `canUseTool`, Shadow, строка Journal.** `SessionStart` получает режим и `judge`,
  папка Run-а как `TMPDIR`, строка `auto-approval`, режим в `run-started`. Blocked by: 03, 06, 12. Ревью: high.
- **05 — Codex: та же политика в approval.** Blocked by: 04. Ревью: high.
- **06 — Переключатель Off / Shadow / On.** Поле в `app-settings.json`, IPC `local`, composer item рядом с Eco mode,
  инвентарь ADR-0005. Blocked by: —. Ревью: high.
- **07 — Park: ожидание владельца.** Открыть на gate, уведомление, предел ожидания, `park-answered` / `park-expired`.
  Blocked by: 04. Ревью: high.
- **08 — Утренняя сводка.** Блок в Run history и строка в чате Orchestrator-а в конце Run-а. Blocked by: 04.
  Ревью: medium.
- **09 — Правила агента и PreToolUse hook по данным 01.** То, что Ticket 01 отнёс к «лечить не одобрением»; если
  ничего — закрывается без кода. Blocked by: 01. Ревью: high (hook меняет команды агента).
- **10 — Документация и термины.** Страница Feature, `CONTEXT.md`, ADR политики. Blocked by: 04, 05, 06, 07, 08, 09.
  Ревью: low.
- **11 — Приёмка с владельцем.** Ночи Shadow, разбор списка, переход в On. Blocked by: 01–10, 12.
- **12 — Electron fuses.** В собранном worfy выключить `EnableNodeCliInspectArguments` и `RunAsNode`, чтобы процесс
  Machine не открыл Node inspector worfy сигналом `SIGUSR1`; test, что у собранного приложения они выключены, на
  macOS и Windows. Blocked by: —.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде» нет. Таблица —
план; Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md, термин Wave).

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `scripts/refusal-census.mjs`, `test/unit/refusal-census.test.ts`, `test/fixtures/refusal-census/`, `.scratch/worfy-auto-approve/spec.md` | 1 |
| 02 | `src/main/agent/auto-approve/shell.ts`, `test/unit/auto-approve-shell.test.ts`, `test/contract/auto-approve-shell-sh.test.ts` | 1 |
| 06 | `src/shared/settings/app-settings.ts`, `src/main/settings/store.ts`, `src/shared/ipc/auto-approve.ts`, `src/main/ipc/auto-approve.ts`, `src/renderer/session/composer/AutoApprove.tsx`, `src/renderer/session/session.css`, `docs/adr/0005-worfy-own-state-inventory.md`, `test/unit/auto-approve-switch.test.tsx`, `test/contract/auto-approve-setting.test.ts` | 1 |
| 03 | `src/main/agent/auto-approve/policy.ts`, `src/main/agent/auto-approve/roots.ts`, `test/unit/auto-approve-policy.test.ts`, `test/unit/auto-approve-roots.test.ts` | 2 |
| 09 | `harness/hooks/rules/common.md`, `harness/hooks/guard.mjs`, `harness/hooks/hooks.json`, `harness/hooks/tests/guard-rewrite.test.sh` | 2 |
| 04 | `src/main/vendors/session.ts`, `src/main/vendors/claude/session.ts`, `src/main/vendors/claude/options.ts`, `src/main/agent/session.ts`, `src/shared/agent/events.ts`, `src/shared/autopilot/journal.ts`, `src/main/autopilot/run.ts`, `test/contract/auto-approve-claude.test.ts` | 3 |
| 05 | `src/main/vendors/codex/session.ts`, `src/main/vendors/codex/approvals.ts`, `test/contract/auto-approve-codex.test.ts` | 4 |
| 07 | `src/main/agent/auto-approve/park.ts`, `src/main/agent/permissions.ts`, `src/main/notify.ts`, `test/unit/auto-approve-park.test.ts` | 4 |
| 08 | `src/shared/flight-recorder/from-journal.ts`, `src/shared/flight-recorder/facts.ts`, `src/shared/ipc/runs.ts`, `src/renderer/flight-recorder/DetailPanel.tsx`, `src/main/autopilot/run.ts`, `test/unit/auto-approve-summary.test.ts` | 4 |
| 10 | `docs/features/autopilot.md`, `docs/features/ru/autopilot.md`, `CONTEXT.md`, `docs/adr/<NNNN>-approval-policy.md` | 5 |
| 12 | `electron-builder.yml`, `package.json`, `src/main/program.ts`, `src/main/vendors/codex/launch.ts`, `test/contract/electron-fuses.test.ts` | 1 |
| 11 | `.scratch/worfy-auto-approve/spec.md` | 6 |

Правило плана: Ticket стоит в первой Wave, где закрыты все его блокеры; общий файл у двух Ticket-ов одной Wave —
Ticket с большим номером уходит дальше (`filesOverlap`, `src/shared/workflow/waves.ts:158`).

- **Wave 1 — 01, 02, 06.** Данные, разбор команды и переключатель не зависят друг от друга.
- **Wave 2 — 03, 09.** Политике нужны категории 01 и разбор 02; hook-у — только категории 01.
- **Wave 3 — 04.** Первое подключение к driver-у: нужны политика и режим.
- **Wave 4 — 05, 07, 08.** Все ждут 04; общих файлов нет (`run.ts` из них правит только 08).
- **Wave 5 — 10.** Wave 6 — 11, владелец.

## Не в этом Epic-е

- Sandbox Autopilot-а и отказ от `bypassPermissions` («Безопасность», п. 1).
- Attended Session-ы, в том числе ночная работа владельца в attended Orchestrator-е (Q4).
- Автоответ на AskUserQuestion и вопросы Card-ов.
- Политика, которую владелец правит сам (Q6; рекомендация — позже, по данным Shadow).
- Перевод unattended Codex с `full-access` на другой preset (Q7).
- Повтор хода и resume после Limits — Epic worfy-retry.

## Риски

1. **Гонка «решение → исполнение».** Политика смотрит на файловую систему в момент запроса, команда исполняется позже.
   Запрет symlink-компонентов и запрет удалять сам корень сужают окно; закрыл бы его полностью только sandbox.
2. **Мало данных для Shadow.** Около одного отказа на четыре Run-а: несколько ночей могут не дать ни одного решения.
   Поэтому Ticket 01 ещё и прогоняет политику по прошлым отказам локально (только числа), а длина Shadow считается
   по числу решений, не по ночам (Q2).
3. **Claude Code меняет свои проверки.** Новая форма `decisionReason` или новый вид запроса попадает в «не могу судить»
   → deny-with-hint; само ничего не одобряется.
4. **Пересечение с worfy-retry** по `run.ts`, `journal.ts`, `app-settings.ts`, `store.ts`, `session.css` — очередь,
   раздел «Соседний Epic».
5. **Park держит Wave до утра.** Предел ожидания (Ticket 07) и Q3.

## Соглашения для Ticket-ов этого Epic-а

- Ветка `worfy-auto-approve/<NN>`, worktree `.claude/worktrees/<NN>`. Конец Ticket-а — `pr-green-ci`: PR, зелёный
  `ci-ok`, отметка `review`. Глубина ревью — в Ticket-е; у 02–07 и 09 — `high` (решение о безопасности).
- **Сначала падающий test.** Для каждого правила allow — test, где правило краснеет на цели вне корня; для каждого
  пункта hard deny — test, где запрос не проходит ни в Shadow, ни в On.
- Без токенов: `WORFY_AGENT=fake`, `WORFY_CODEX=fake`; настоящие Claude Code и Codex не запускаются.
- Репозиторий публичный: в fixture-ах и test-ах нет путей домашней папки, имён машин, id учётных записей и команд из
  настоящих transcript-ов — только выдуманные (`/tmp/demo`, `demo-000000a4`).
- Скрипты Node, не bash (ADR-0055); всё работает на Windows (ADR-0054). Тексты в коде — английские (ADR-0074).
- Timeout-ы — через `ms()` (`test/time-scale.ts`). Flaky test — Quarantine со сроком. Low findings не становятся
  Ticket-ами.
- Язык: документы — русские, термины — латиницей из `CONTEXT.md`.

## Вопросы владельцу

Ответы приняты владельцем 2026-11-04 («Да, всё»): везде рекомендация.

1. **Q1. Состояния переключателя.** (а) Три: Off / Shadow / On; (б) два: Off / On, а первые ночи после включения worfy
   сам держит Shadow. **Рекомендую (а):** режим виден и меняется в одном месте, к Shadow можно вернуться после смены
   правил, ничего не переключается без владельца.
2. **Q2. Длина Shadow.** (а) Три ночи; (б) пока не наберётся 10 решений или две недели — что раньше; (в) без срока,
   переключает владелец. **Рекомендую (в) с ориентиром (б):** при одном отказе на четыре Run-а три ночи могут дать ноль
   решений; сводка показывает «Shadow: N decisions so far», переключает владелец.
3. **Q3. Запрос, который правило не разрешает, а hard deny не запрещает.** (а) Всегда deny-with-hint; (б) всегда park;
   (в) deny-with-hint, если агент может переписать сам (не разобрано, цель — переменная), park — если решить может
   только человек (разобрано, цель вне корней, но не в hard deny, например `npm install -g`). **Рекомендую (в) с
   пределом park 60 мин**, потом deny-with-hint и `park-expired`: ночь идёт дальше, а редкое «только человек» не
   теряется.
4. **Q4. Attended Session-ы.** (а) Только unattended (Autopilot); (б) ещё attended Orchestrator, когда владелец сам
   включил это на ночь; (в) все Session-ы. **Рекомендую (а) сейчас, (б) отдельным Ticket-ом после приёмки:** у attended
   Session есть карточка и «Always allow», автоответ рядом с ними — свой UI; сначала данные Shadow.
5. **Q5. Канал уведомления о park.** (а) Уведомление macOS / Windows (`notify.ts`; уже уходит и на Linked machine);
   (б) плюс внешний канал (Telegram и т. п.) — новая интеграция; (в) только утренняя сводка. **Рекомендую (а):** оно
   уже есть для каждого `permission_request`, park новых каналов не требует.
6. **Q6. Кто правит политику.** (а) Только код: правила с test-ами, изменение — PR с ревью high; (б) плюс список
   дополнительных allow-шаблонов, который владелец правит в UI (хранится в данных worfy); (в) файл в Profile или в
   репозитории. **Рекомендую (а):** файл в репозитории меняет любой коммит (в том числе по injection), Profile и данные
   worfy — любой Bash в bypassPermissions; (б) — позже, если Shadow покажет повторяющиеся категории. Hard deny не
   правится ни в каком варианте.
7. **Q7. Codex в Autopilot.** (а) Оставить `full-access`: Codex не спрашивает, политика для него — задел; (б) перевести
   на `auto` (`workspace-write` + `on-request`) и отвечать политикой. **Рекомендую (а):** sandbox `workspace-write`
   без сети (`capabilities.ts:89-91`), и `gh` / `git push` Orchestrator-а сломаются; (б) — отдельное решение с
   проверкой сети.
8. **Q8. AskUserQuestion в Autopilot.** (а) deny-with-hint «запиши вопрос в Ticket»; (б) park; (в) решает Ticket 01 по
   данным, до него — (а). **Рекомендую (в):** вопросы — почти половина отказов, и чаще их лечит правило агента
   (Ticket 09), а не ожидание.

## Готово, когда

- [ ] Таблица категорий отказов Mac и PC с решением по каждой (01); категории «не одобрением» закрыты правилом или
      hook-ом, или записано, почему нет (09).
- [ ] Разбор команды отказывает на каждой конструкции вне грамматики; differential test с `sh` зелёный на Linux,
      macOS и Windows (02).
- [ ] У каждого правила allow и каждого пункта hard deny есть test; hard deny не проходит ни в одном режиме (03).
- [ ] Off ведёт себя ровно как сегодня; Shadow не меняет ответа агенту; On отвечает по политике — для Claude (04) и
      Codex (05).
- [ ] Переключатель Off / Shadow / On у Orchestrator-а рядом с Eco mode, по умолчанию Off, read-only на Linked
      machine (06).
- [ ] Park с уведомлением и пределом ожидания (07); сводка в Run history и строка в чате (08).
- [ ] Страница Feature, термины, ADR (10); приёмка владельца после ночей Shadow (11).
