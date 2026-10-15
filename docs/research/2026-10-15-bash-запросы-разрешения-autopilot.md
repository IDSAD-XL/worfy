# Запросы разрешения Bash, которые Autopilot отклонил: какие команды и что поправить

- **Дата:** 2026-10-15
- **Статус:** исследование, не решение. Ticket `worfy-polish` 12 (research: какие команды Bash
  Autopilot отклонил и что поправить). Правки Harness и Profile здесь только предложены: их делают
  по слову владельца.
- **Источники (только чтение):** журналы Autopilot
  `~/Library/Application Support/worfy/autopilot/*.jsonl` (22 файла, 2026-10-06 — 2026-10-15);
  транскрипт Session-а Orchestrator-а `f6ab7045…` и транскрипты его Subagent-ов
  (`~/.claude/projects/<cwd>/f6ab7045…/subagents/agent-*.jsonl` и `*.meta.json`); код worfy на
  `origin/main` `259a56dc`; Harness в `harness/`; Claude Code CLI из Agent SDK `0.3.289` — эта версия
  закреплена в `package.json:28` с 2026-10-05, значит, она работала во всех четырёх случаях. Ни
  Claude Code, ни Autopilot не запускались.
- **Время** — UTC, как в журнале.

## Коротко

- Все четыре запроса пришли **не от Orchestrator-а, а от его фоновых Subagent-ов**:
  `implementer` и `reviewer`. Claude Code передаёт запросы разрешения Subagent-ов в `canUseTool`
  Session-а-родителя. Поэтому в журнале стоит Session Orchestrator-а.
- Причина во всех четырёх случаях одна: **проверка безопасности Claude Code на опасное удаление**.
  Внутри CLI она называется `dangerousRemoval`. Она помечена `bypassImmune`: спрашивает человека
  даже в `bypassPermissions`. Её нельзя разрешить правилом allowlist. Три команды — `rm -rf` с целью,
  которую Claude Code не может вычислить заранее. Четвёртая — `zsh -c` со встроенным script-ом,
  который Claude Code не смог проверить на удаление.
- Отказ worfy верен: без человека такую проверку подтверждать некому. Цена отказа была мала. Каждый
  Subagent за 3–16 секунд переписал команду, и следующий вызов прошёл. Ход Orchestrator-а не
  пострадал: его главный поток отказа не видел, а в первом случае он вообще ждал без хода.
- Allowlist в Profile-е или Harness-е **не поможет**. Помогут правило для агентов в Harness-е и
  причина отказа в ответе модели и в журнале (это worfy, отдельный Ticket).

## Как устроен отказ

1. Session Autopilot запускается без человека (unattended) и всегда в `bypassPermissions`:
   `src/main/agent/session-settings.ts:41-42`, `src/main/agent/options.ts:234`.
2. Для такого Session-а `canUseTool` — это `unattendedCanUseTool`: `src/main/agent/session.ts:306-308`.
   Он отказывает сразу и никого не ждёт: `src/main/agent/permissions.ts:59-64`. Модель получает
   один и тот же текст `UNATTENDED_DENIED_MESSAGE` (`src/main/agent/permissions.ts:34-35`). Причины
   в нём нет.
3. Отказ становится событием `refused_dialog` (`src/main/agent/session.ts:321-323`,
   `src/shared/agent/events.ts:77`). Autopilot пишет его в журнал как `refused-dialog`, и в поле
   `what` попадают только вид диалога и имя инструмента: `src/main/autopilot/run.ts:745-746`,
   `src/shared/autopilot/journal.ts:222`. Команды и причины в журнале нет.
4. `unattendedCanUseTool` не читает третий аргумент `canUseTool`. А SDK там передаёт
   `decisionReason` («почему спросили») и `agentID` («какой Subagent спросил»):
   `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:213-299`. Их нет и в типе worfy
   `PermissionRequestOptions` (`src/main/agent/permissions.ts:38-48`).

Как команды нашлись. Время отказа в журнале совпало с вызовом Bash в транскрипте Subagent-а. Ответ
на этот вызов — ровно текст `UNATTENDED_DENIED_MESSAGE`, и пришёл он через 46–63 мс после вызова. Так
быстро отвечает только worfy, человек так не успевает. Других результатов с этим текстом в
транскриптах нет: 4 Bash и 2 `AskUserQuestion`, как и в журнале.

Почему Claude Code спросил, хотя режим `bypassPermissions`. В CLI есть таблица проверок
безопасности. У каждой есть флаг `bypassImmune` — «спрашивать и в `bypassPermissions`». Он стоит у
`dangerousRemoval`, `isolatePeerMachines`, `restrictedMode` и `outsideReadsBlocked`. У
`dangerousRemoval` в ответе стоят `classifierApprovable: false` и текст «This requires explicit
approval and cannot be auto-allowed by permission rules». Это прочитано из строк бинарника CLI
`claude-agent-sdk-darwin-arm64@0.3.289`, не из документации.

Harness здесь ни при чём. Его PreToolUse guard (`harness/hooks/guard.mjs:32`) умеет только
`deny`, а не `ask`. Отказ guard-а приходит с его собственным текстом, а не с текстом Autopilot.

## Четыре случая

Команды сокращены до того, что важно для отказа. Личные пути заменены на `<…>`.

### 1. 2026-10-06 13:17:35 — Epic `worfy-daily`, `impl-10` (implementer Ticket-а 10)

- **Команда:** `cd <repo>/.claude/worktrees/10 && … && mkdir -p /tmp/worfy-wave6/impl-10/trace && cd
  /tmp/worfy-wave6/impl-10/trace && rm -rf * && unzip -oq <…>/app-trace-*.zip && …`
  — разобрать trace упавшего e2e test-а.
- **Почему спросили:** `rm -rf *` после `cd`. Текст проверки в CLI: «This command changes
  directories before the removal, so the relative glob target cannot be statically resolved».
- **Что было дальше:** через 16 с тот же Subagent распаковал архив в новую папку через `unzip -d`
  без `rm`, и вызов прошёл.
- **Что поправить:** (а) — другая команда: новая папка вместо чистки старой. (в) — отказ верен.

### 2. 2026-10-06 18:18:35 — Epic `worfy-daily`, `verify-11-r2` (reviewer, второй круг проверки Ticket-а 11)

- **Команда:** `set -e; W=<repo>/.claude/worktrees/11; R=/tmp/worfy-wave7/verify-11-r2; for d in shot
  mut; do rm -rf $R/$d; mkdir -p $R/$d; git -C $W archive HEAD | tar -x -C $R/$d; …; done; cd
  $R/shot && perl -0pi -e '…' …` — две копии дерева для скриншотов и для mutant-а.
- **Почему спросили:** цель `rm -rf` — переменные `$R/$d`. Проверка: «The target … is a shell
  variable expansion: when … is unset or empty it becomes `/`, `/*` or a top-level path».
- **Что было дальше:** через 3 с та же раскладка без `rm -rf` (`mkdir -p` и `ln -sfn`) прошла.
- **Что поправить:** (а) и (в), как в случае 1.

### 3. 2026-10-08 06:20:55 — Epic `worfy-harness`, `impl-22` (implementer Ticket-а 22, `worfy:implementer`)

- **Команда:** `M=$(mktemp -d /tmp/worfy-harness-w10/impl-22/mut3.XXXX); for mut in early notemp;
  do rm -rf "$M/$mut"; mkdir "$M/$mut"; cp -R <…>/harness "$M/$mut/"; python3 - … <<'PYEOF' … PYEOF;
  …; done` — mutation check двух правок на копиях Harness.
- **Почему спросили:** цель `rm -rf` — `"$M/$mut"`, переменная из command substitution. Это та же
  проверка на возможно пустую переменную в пути. Для переменной, заданной в самой команде, у неё есть
  отдельный текст: «This command sets $… from `…`».
- **Важно:** правило «удалять только по литеральному пути» уже было в prompt-е агента. Оно
  появилось в коммите `b8893fc7` 2026-10-06 18:19 UTC, через минуту после случая 2, а с 2026-10-07
  живёт в `harness/agents/implementer.md:63-67` и `harness/agents/reviewer.md:122-125`. В
  установленном plugin-е оно есть: `~/.claude/worfy-harness/plugin/agents/implementer.md:63`. Агент
  его нарушил: удалять было нечего, `mktemp -d` и так дал новую папку.
- **Что было дальше:** через 6 с `mktemp -d` на каждый mutant без `rm` — прошло.
- **Что поправить:** (а) — правило уже есть, но одного текста мало (см. «Предложения», пункт 2).
  (в) — отказ верен.

### 4. 2026-10-14 01:23:40 — Epic `worfy-terminal-ai`, `impl-tai-03` (implementer Ticket-а 03, `worfy:implementer`)

- **Команда:** `cd /tmp/worfy-tai-w2/impl-03 && zsh -f -c '<многострочный script: zmodload zsh/net/socket
  zsh/system, setopt extendedglob, autoload -Uz +X add-zle-hook-widget, флаги параметров ${(b)…},
  ${(g::)…}>'; echo "EXIT=$?"` — проверка модулей и флагов zsh. `rm` в команде нет.
- **Почему спросили (вывод, запуском не проверен):** у `dangerousRemoval` есть ветка для `sh/bash/zsh
  -c`. Claude Code разбирает встроенный script. Если разобрать не удалось, он спрашивает с текстом
  «This command passes a shell -c script that runs rm, and Claude Code could not check the script for
  dangerous removals». В том же CLI `zmodload`, `setopt`, `autoload`, `sysopen`, `zf_rm` и другие
  встроенные команды zsh стоят в одном списке с `rm`/`rmdir` — «может удалить или обойти проверку»
  («Zsh builtin '…' can bypass security checks»). Из флагов `bypassImmune` к этой команде подходит
  только `dangerousRemoval`, у трёх других флагов другой повод. Ещё одно подтверждение: через 6 с тот
  же script, записанный в файл и запущенный как `zsh -f <file>`, прошёл без запроса.
- **Что поправить:** (а) — script в файл, затем `zsh -f <file>`. Этого правила в Harness нет. (в) —
  отказ верен.

### Вопрос 4: писать ли саму команду в `refused-dialog`

Сырую команду — нет. В команде бывают токены и личные пути (в этой Session есть вызовы с
`GH_TOKEN=$(gh auth token …)`), а журнал хранится долго. Лучше писать два поля, которые SDK уже даёт:

- `decisionReason` — причину запроса от Claude Code, обрезанную примерно до 200 символов, с домашней
  папкой, заменённой на `~`. Она и отвечает на вопрос «почему»: на этом разборе причину пришлось
  восстанавливать по бинарнику CLI.
- `agentID` и имя Subagent-а — кто спросил. Тогда не нужно сопоставлять время с 365 транскриптами
  Subagent-ов.

Это правка worfy (`src/`), отдельный Ticket (пункт 1 ниже).

## Предложения

| # | Правка | Где | Кто решает |
| --- | --- | --- | --- |
| 1 | `unattendedCanUseTool` читает `options.decisionReason` и `options.agentID`. Причина добавляется к ответу модели: «refused because: <reason>; rewrite the command so this check does not fire». `refused-dialog` в журнале получает поля `agent` и `reason` (обрезанные, без домашней папки), но не саму команду | worfy: `src/main/agent/permissions.ts`, `src/main/agent/session.ts`, `src/shared/agent/events.ts`, `src/main/autopilot/run.ts`, `src/shared/autopilot/journal.ts` | Autopilot может сделать сам, новый Ticket. Схема журнала только расширяется, старые строки читаются как прежде |
| 2 | Расширить правило «Delete only by a literal path» в `harness/agents/implementer.md:63-67` и `harness/agents/reviewer.md:122-125`: (а) никаких `$VAR` в цели `rm`, даже если папка из `mktemp -d`; (б) многострочный script для `sh/bash/zsh -c` — записать в файл в своей папке и запустить файл. Лучше вынести это в `harness/hooks/rules/common.md`: его получает каждый Subagent, а не только `implementer` и `reviewer` | Harness | **владелец** |
| 3 | (по желанию, после 2) Правило в PreToolUse guard: `harness/hooks/guard.mjs` отказывает с понятным текстом на `rm` с glob после `cd`, на `rm` с переменной в цели и на `-c` со script-ом из нескольких строк. Тогда агент узнаёт, что переписать, ещё до запроса Claude Code. Цена: в Session-е с человеком guard откажет там, где человек мог бы подтвердить | Harness | **владелец** |
| — | Allowlist (`permissions.allow`) в Profile-е worfy или Harness | Profile, Harness | Не предлагается: Claude Code сам пишет, что эту проверку «cannot be auto-allowed by permission rules» |

Пункт 1 полезен и без пунктов 2 и 3. Пункт 2 убирает случаи 3 и 4, пункт 3 делает правило
механическим. Правило из случая 3 было только текстом, и агент его нарушил.

## Чего этот разбор не установил

- Точный текст запроса Claude Code в каждом случае не записан нигде: `decisionReason` worfy не
  сохраняет, debug-логов Claude Code на машине нет. Причины 1–3 следуют из формы команды и текстов
  проверок в CLI. Причина 4 — вывод из устройства проверки и из того, что тот же script из файла
  прошёл без запроса.
- Тексты проверок прочитаны из бинарника CLI `0.3.289`. В другой версии Claude Code они могут быть
  иными.
- Разобраны только Session-ы Autopilot (по журналу). В Session-ах с человеком те же команды
  показали бы человеку диалог; сколько их было, не считалось.
