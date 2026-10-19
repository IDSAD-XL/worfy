# worfy-pipeline: на каком Stage каждый Ticket и кого он ждёт — доска Pipeline, stepper на Card, отметки агентов

Status: по решению владельца 2026-10-17 (grilling о Pipeline); разбиение на Ticket-ы, «Готово, когда»
и «Соглашения» — предложение этого docs-PR, первый черновик
Source: решение владельца 2026-10-17, grilling о Pipeline; разбор кода и Harness по main `9ea609d8`.
[CONTEXT.md](../../CONTEXT.md) — термины, раздел «Workflow» (Stage, Pipeline); ADR
[0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md),
[0005](../../docs/adr/0005-worfy-own-state-inventory.md),
[0056](../../docs/adr/0056-windows-checks-and-two-sessions.md),
[0065](../../docs/adr/0065-one-gate-full-per-wave-merge-set.md),
[0067](../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md) (этот PR); Epic
[worfy-throughput](../worfy-throughput/spec.md) — формат и соглашения.
Ticket-ы: Epic `worfy-pipeline`, 8 Ticket-ов, нумерация с `01`. Шапка — тот же диалект, что у
worfy-throughput (`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`,
`ticket` и вычисление Wave в worfy (`src/shared/workflow/waves.ts`). После Ticket-а 01 шапка всех
Ticket-ов — новый формат (ниже, «Решения владельца», пункт 6).

## Откуда

Сегодня worfy показывает у Ticket-а слово статуса из его файла. Card Ticket-а на Canvas пишет
`open`, `claimed`, `blocked` или `done` (`src/renderer/canvas/nodes/TicketNode.tsx:31-45`, `:112`),
рядом — бейджи PR, CI и вердикта (`src/renderer/canvas/badges/ChecksBadges.tsx`). Чтобы понять, где
работа, человек открывает Ticket, PR, журнал Autopilot и отчёт Session на Windows-ПК.

Что мешает показать Stage прямо сейчас:

- **Статус — текст в свободной форме.** Строка `Status:` несёт слово, дату, причину блокировки и
  ссылку на PR в одной строке: `done — 2026-10-16, [PR #384](…)`, `blocked — research: ведёт …;
  Autopilot не берёт`. `epic-status` (bash и awk) берёт последнюю строку `Status:` в файле
  (`harness/bin/epic-status:19-20`) и классифицирует слово (`:93-111`). Причину блокировки worfy
  вырезает из той же строки регулярным выражением (`src/renderer/canvas/epic-layout.ts:477-485`).
  `scripts/critical-path.mjs:284` разбирает ту же строку ради даты и номера PR.
- **Вердикт ревью — текст комментария.** worfy ищет `VERIFIED` или `REJECTED` в первой строке
  комментариев PR (`src/main/github/prs.ts:164-176`). С `local-green` вердикт — пустой commit
  `gate: VERIFIED`, в Silent mode — строка в конце файла Ticket-а (`harness/skills/epic-wave/SKILL.md:328-352`).
  Ни один вердикт не привязан к коммиту.
- **Вердикт Windows — правило в тексте.** Какие PR ждут gate full на Windows-ПК, говорит ADR-0056,
  пункт 2 (`docs/adr/0056-windows-checks-and-two-sessions.md:37-42`); skill `epic-wave` отсылает к
  правилам Project-а (`harness/skills/epic-wave/SKILL.md:578-583`), а `rules.md` Profile-а worfy —
  к ADR. worfy этого шага не видит вовсе.
- **CI считает любой commit status.** `ciOf` (`src/main/github/prs.ts:142-160`) краснит CI по
  любому commit status с `FAILURE` или `ERROR`. Commit status `review: failure` покажется красным CI.
  `gh pr checks` в skills (`harness/skills/epic-wave/SKILL.md:265`, `harness/skills/ship-ticket/SKILL.md:441`)
  ведёт себя так же.
- **Gate full под замком не виден.** Замок e2e — пустая папка `/tmp/worfy-e2e.lock`
  (`workflow.e2e_lock` Profile-а, `harness/profiles/README.md:154`). По ней не понять, чей gate
  идёт и ждёт ли PR своей очереди.

Что уже есть и годится:

- worfy следит за файлами Ticket-ов и ветками (`src/main/workflow/watch.ts:1-12`) и опрашивает PR
  раз в 60 s (`src/main/github/prs.ts:3-10`). Живое обновление доски не требует нового наблюдателя.
- Уведомления macOS и Windows уже идут через `Notifier` (`src/main/notify.ts:136`).
- Секции боковой панели подхватываются по имени файла (`src/renderer/shell/Sidebar.tsx:3-8`), вид
  окна — `ShellView` (`src/renderer/shell/Toolbar.tsx:11`).

## Цель

Одним взглядом видно, на каком Stage каждый Ticket и кого он ждёт; застрявшие Ticket-ы выделены.
Метрики времени — вне этого Epic-а (`worfy-throughput` 05).

Epic готов, когда:

1. Шапка каждого Ticket-а — один факт на строку: `Status: <слово> <время>`, `Blocked reason:`,
   `Waits:`; пишет её только `bin/ticket`; все Ticket-ы worfy переведены `bin/ticket migrate`, и
   читается только новый формат (Ticket 01).
2. Ревью агентом и Check «windows» — отметки, привязанные к SHA: commit status в Full mode,
   локальный JSON в Silent mode; пишет их только `bin/ticket mark`; CI в worfy и в Harness их не
   считает; gate full пишет номер PR в замок e2e; `pnpm install:stable` ставит commit status
   `deploy`; Profile знает поле `workflow.pipeline` (Ticket 02).
3. worfy вычисляет Stage каждого Ticket-а по Pipeline его Project-а из Status, ветки, PR, check-ов,
   отметок, `reviewDecision`, Deployment-ов и замка e2e; текст комментариев PR для этого не читается
   (Ticket 03).
4. Вкладка Pipeline рядом с Canvas и Session — доска активного Project-а; секция Pipeline боковой
   панели — Ticket-ы в работе по всем Project-ам (Ticket 04).
5. Card Ticket-а показывает stepper вместо слова статуса (Ticket 05).
6. Застрявший Ticket выделен на доске и на Card; переход в `Waits: owner` даёт уведомление
   (Ticket 06).
7. `epic-wave` и `ship-ticket` ждут отметок по `workflow.pipeline`, а не по правилу в тексте;
   правило ADR-0056 о Windows — Check «windows» в Pipeline worfy (Ticket 07).

## Решения владельца

2026-10-17, grilling о Pipeline. Все пункты подтверждены; заново не решаются.

1. **Цель.** Одним взглядом: на каком Stage каждый Ticket и кого он ждёт; застрявшие выделены.
   Метрики времени — `worfy-throughput` 05.
2. **Интерфейс в worfy.** Третья вкладка **Pipeline** рядом с Canvas и Session — доска активного
   Project-а: колонки — Stage его Pipeline, карточки — Ticket-ы; Done свёрнут в счётчик, открытые
   и не начатые — в Queued. Секция боковой панели **Pipeline** (по желанию пользователя, как прочие
   секции) по всем Project-ам: Ticket-ы в работе с чипом Stage и «кого ждёт», клик открывает доску.
   На Card Ticket-а stepper заменяет слово статуса; бейджи PR, CI и вердикта остаются как подробности.
   Обновление живое.
3. **Stage вычисляется, не хранится** (ADR-0002, ADR-0005). Статус ≠ Stage. `blocked` — пометка с
   причиной на любом Stage, не Stage.
4. **Pipeline — у каждого Project-а в Profile, поле `workflow.pipeline`.** Без поля — Queued,
   Implementing, CI, Agent review, Gate & merge, Closing, Done. Собирается из фиксированного
   каталога видов Stage с предикатами в коде; Profile включает, упорядочивает, переименовывает;
   выражений и скриптов нет. Каталог: Queued (Status `open`) · Implementing (`claimed`, PR нет;
   пометка «rework» после проваленного ревью) · CI (check-и PR идут или красные) · Agent review
   (отметка агента `review`) · Human review (`reviewDecision` GitHub от людей) · Check «<name>»
   (отметка агента с именем из Profile-а, у worfy — `windows`, вместо жёсткого правила ADR-0056) ·
   Gate & merge (мержит агент) · Awaiting merge (всё зелёное, мержит человек) · Deploy (отметка на
   merge-коммите: GitHub Deployment окружения из Profile-а или commit status `deploy` от скрипта
   деплоя; у worfy его ставит `pnpm install:stable`) · Closing (влит, Status не `done`) · Done.
   Примеры. Atakama (Silent mode): Queued → Implementing → Agent review → CI → Human review →
   Awaiting merge → Done — ревью агентом локально, до PR, потому что открытый PR передаёт работу
   людям. worfy: Queued → Implementing → CI → Agent review → Check «windows» → Gate & merge →
   Deploy → Closing → Done.
5. **Отметки агентов** (`review`, Check): один интерфейс, два хранилища по режиму. Full mode —
   GitHub commit status на head-коммите PR (`review: success|failure|pending`), нейтральные имена
   context. Silent mode — локальный JSON в `~/.claude/worfy-harness/runs/<project>/marks/`, один
   файл на Ticket; пишет только `bin/ticket mark <epic> <NN> <kind> <verdict> --sha <sha>`; не
   коммитится и на GitHub не попадает. Обе привязаны к SHA: новый коммит делает отметку устаревшей,
   и Ticket возвращается назад. Предел: в Silent mode отметки видны на одной Machine, пока их не
   читает `worfy-link`. worfy больше не разбирает текст комментариев PR ради вердикта; комментарии
   остаются для людей. Метки PR (labels) для Stage не используются.
6. **Шапка Ticket-а — один факт на строку, детерминированно, разбор минимальный.** `Status: <слово>
   <дата>` и только; `Blocked reason: …` — своя строка; `Waits: owner | team | agent | <имя Machine>`
   (team — другие люди, например ревьюеры Atakama). Пишет только `bin/ticket` (новые флаги, например
   `block --waits`). Однократная миграция всех Ticket-ов — `bin/ticket migrate`, один PR на Project
   (Silent mode — в его Workflow folder); после неё читается только новый формат.
7. **Порог «застрял»** — у каждого Stage в Pipeline. По умолчанию 2 h для Stage агентов
   (Implementing, Agent review, CI, Gate & merge) и 24 h для Stage людей (Human review, Awaiting
   merge, любой Stage с `Waits: owner` или `team`). Время с входа в Stage — из структурированных
   данных: дата Status, время отметки, время события GitHub; текст не разбирается.
8. **Уведомление macOS**, когда Ticket входит в `Waits: owner` (например «worfy-link 16 ждёт тебя:
   приёмка»), — через существующие уведомления (`src/main/notify.ts`). Прочие переходы — только на
   доске.
9. **«Gate full идёт» и «ждёт gate»** различаются: `wave-gate` и скрипт мержа Orchestrator-а пишут
   номер PR в замок e2e (`/tmp/worfy-e2e.lock`, `workflow.e2e_lock` Profile-а).
10. **Pipeline правится в `profile.json`** руками или через `bin/profile`; редактор в Settings —
    поздний Ticket (08).
11. **Порядок:** ADR и словарь (этот PR) → шапка и `bin/ticket migrate` (01) → отметки в Harness (02)
    → вычисление Stage в main (03) → доска и секция (04) → stepper (05) → «застрял» и уведомление
    (06) → `epic-wave` и `ship-ticket` по `workflow.pipeline` (07). Epic идёт под Autopilot после
    `worfy-link`. Правки Harness и Profile-а, перечисленные здесь, идут по этому слову владельца.
12. **ADR-0067** записывает два трудно обратимых решения: Pipeline в Profile из фиксированного
    каталога; отметки агентов — commit status (Full mode) и локальный JSON (Silent mode), привязанные
    к SHA, вместо разбора комментариев PR.

Решено без владельца, подтверждено владельцем 2026-10-17 («все норм»):

- **Время в Status — с минутами, UTC.** Порог 2 h не проверить по одной дате. `bin/ticket` пишет
  `Status: claimed 2026-10-17T09:41Z`; у перенесённых Ticket-ов остаётся дата без времени, она
  читается как 00:00 UTC.
- **Ссылка на PR — своя строка `PR: #<N>`.** «Один факт на строку» выносит её из `Status: done …`.
  В Silent mode строки `PR:` нет, как нет и `--pr` у `ticket done`.
- **Миграция не угадывает `Waits:`.** Причина блокировки переносится в `Blocked reason:` как есть;
  `Waits:` у перенесённых `blocked` Ticket-ов `migrate` не пишет, а печатает их список. Orchestrator
  ставит `Waits:` командой `ticket block --waits` в том же PR миграции.
- **«Кого ждёт» без строки `Waits:`** — по виду Stage: Human review и Awaiting merge — `team`,
  остальные — `agent`. Строка `Waits:` главнее.
- **Вердикт `skipped`.** Check «windows» нужен не каждому PR, а только платформенному (ADR-0056,
  пункт 2). Для остальных Orchestrator ставит `bin/ticket mark … check/windows skipped`: в Full mode
  это commit status `success` с описанием `skipped`, Stage пройден, stepper показывает его
  пропущенным. Какой PR платформенный, решает по-прежнему ADR-0056.
- **Имена context отметок:** `review`, `check/<name>`, `deploy`. Проверка CI в worfy (`ciOf`) и в
  Harness исключает их по этому списку.
- **Поле Pipeline в Profile-е** — массив `{ "kind", "name"?, "label"?, "stuck_after"?, "environment"? }`;
  виды — `queued`, `implementing`, `ci`, `agent-review`, `human-review`, `check`, `gate-merge`,
  `awaiting-merge`, `deploy`, `closing`, `done`. `bin/profile` проверяет его (Ticket 02): `queued`
  первым, `done` последним, каждый вид не больше раза, кроме `check` с разными `name`; `gate-merge`
  и `awaiting-merge` вместе нельзя. Нарушение — exit 1 с причиной, как у прочих полей.
- **`bin/profile` только читает** (`harness/bin/profile:25`). Команды записи Pipeline этот Epic не
  добавляет: правка — в `profile.json` руками, проверка — `bin/profile --field workflow.pipeline`.
- **Deploy пройден,** когда merge-коммит Ticket-а — предок коммита с отметкой деплоя
  (`git merge-base --is-ancestor`): `pnpm install:stable` отмечает только коммит, который поставил.
  В Silent mode — только GitHub Deployment окружения из Profile-а: commit status `deploy` пишет лишь
  Full mode.
- **Необратимые факты засчитывают Stage до них.** PR влит — Stage до мержа пройдены, даже без
  отметок (PR влит человеком мимо Pipeline). Status `done` — Done.
- **Пороги по умолчанию** — только у Stage, перечисленных в пункте 7. У Queued, Check, Deploy и
  Closing порога нет, пока Profile его не задаст (`stuck_after`).
- **Уведомление — только о переходе, который worfy увидел сам.** На старте worfy не уведомляет о
  Ticket-ах, которые уже стояли в `Waits: owner`. Одно уведомление на пару (Ticket, время Status).
- **Замок e2e хранит владельца** в файле `holder.json` внутри папки замка: `{ "prs": [...], "what":
  "gate-full" | "e2e", "pid", "since" }`. Пустой или нечитаемый файл — «gate идёт, PR неизвестен».
- **Бейдж вердикта на Card — из отметки `review`** (Ticket 05); `verdictOf` удаляется. Журнал узкого
  круга Autopilot (`narrow-round`, `src/main/autopilot/run.ts:67-68`) по-прежнему читает комментарии:
  это журнал прогона, не Stage. Harness считает круги ревью по комментариям и строкам, как раньше.
- **Stage считается в main отдельным доменом IPC `pipeline`**, а не полем модели `workflow`: ему
  нужны PR, отметки и замок, которых у `epic-status` нет.
- **Редактор Pipeline в Settings — Ticket 08**, последним. Инструмент записи поля (у `bin/profile`
  команды записи нет) — слово владельца до claim.

2026-10-20, grilling о Ticket-ах 08–10 (Q1–Q16). Все пункты приняты; подробности — в «Что делаем» Ticket-ов.

- **08, редактор Pipeline.** Q1: правила Pipeline — общий модуль `harness/lib/`, его берут `bin/profile` и
  `bin/profile-set`. Q2: форма проверяет каждое поле до записи теми же правилами; причина exit 1 скрипта —
  запасной показ. Q3: смена Pipeline не блокируется; строка под `Save` — Stage Ticket-ов посчитаются заново;
  удаление Check с отметками — подтверждение с числом Ticket-ов. Q4: `Reset to default` — `bin/profile-set`
  удаляет поле, с подтверждением (дополняет ADR-0073, ADR не правится). Q5: правит только эта Machine, канал
  записи `write` (ADR-0066); Project Linked machine — только чтение и строка, где править. Q6: compare-and-write
  по отпечатку прочитанного Pipeline; не совпал — «Pipeline изменился, перечитайте» и `Reload`. Q7: сбой
  commit-а в git папки Harness запись не отменяет — предупреждение с причиной. Q8: без `bin/profile-set` —
  «Harness слишком старый для редактора Pipeline» и кнопка `Update Harness`.
- **09, уведомление без опроса.** Q9: нет модели workflow — повтор с удваивающейся паузой, уведомлений нет;
  первая модель — исходный снимок. Q10: без `Blocked reason` текст — «`<Epic> <NN> — <title>`». Q11: ключ —
  (Epic, NN, слово Status, причина), когда `statusAt` нет или в нём только дата. Изменения или модель целиком
  из `workflowHub` — выбор implementer-а.
- **10, Linked machine.** Q12: своё сообщение связи, только Machine, объявившим его при связи
  ([ADR-0079](../../docs/adr/0079-link-machines-announce-accepted-messages.md)). Q13: клик — вкладка Pipeline
  Project-а на той Machine, если окно Linked machine её показывает, иначе окно worfy с Project-ом. Q14:
  уведомляет Machine Project-а; получатель бросает заметку о Project-е, открытом у себя; ключ — (Project, Epic,
  NN, ключ Q11). Q15: `Waits: owner` — все Machine владельца с доступом от Read only; `Waits: <Machine>` —
  только она; `team`, `agent` — никому. Q16: в сообщении имя и id Project-а, не `projectRoot`.

## Не в этом Epic-е

- **Метрики времени** (сколько Ticket стоит на Stage в среднем, критический путь) — `worfy-throughput` 05.
- **Отметки Silent mode на Linked machine** — `worfy-link`: пока отметки видны на одной Machine.
- **Свои виды Stage, выражения и скрипты в Profile-е** — отвергнуто ADR-0067.
- **Перенос старых вердиктов `VERIFIED` в отметки.** Ticket-ы, влитые до Epic-а, уже Done.
- **Уведомления о прочих переходах** (CI покраснел, ревью провалено) — только доска (пункт 8).
- **Метки PR (labels) как источник Stage** — отвергнуто ADR-0067.

## Риски

- **Миграция 297 файлов одним PR.** Ошибка разбора тихо испортит статус. `migrate` идёт сначала с
  `-n` (печатает diff), отказывается на строке, которую не понял, и не трогает файл, где уже новый
  формат. После миграции `epic-status --json` до и после сравнивается по полю `state` каждого
  Ticket-а — расхождений ноль (Ticket 01).
- **Новый формат и открытые PR.** PR, открытые во время миграции, несут старую строку `Status:` в
  своих файлах Ticket-ов. Миграция идёт между Wave-ами, когда открытых PR с файлами Ticket-ов нет;
  `epic-status` на старой строке даёт `state: none` с причиной, а не догадку.
- **Commit status виден людям.** В Full mode `review` и `check/windows` видны в списке check-ов PR.
  Имена нейтральные. Для Silent mode это и есть причина локального JSON.
- **Отметки и `gh pr checks`.** Пока skills не фильтруют отметки, `review: pending` выглядит как
  идущий CI, а `review: failure` — как красный. Фильтр входит в тот же Ticket 02, что и запись
  отметок.
- **Лимит GitHub API.** Deployment-ы и время событий — лишние вызовы `gh`. Они идут в том же цикле
  60 s и только для Ticket-ов, чей Stage от них зависит (Ticket 03).
- **Общие файлы с `worfy-throughput`.** `harness/bin/wave-gate` и `harness/skills/epic-wave/SKILL.md`
  правят и его открытые Ticket-ы (06, 07). Перед Wave — проверка открытых PR (ADR-0056, пункт 5).
- **Profile вне репозитория.** `profile.json` и `rules.md` Profile-а worfy лежат в
  `~/.claude/worfy-harness/projects/worfy/`. Их правку PR не показывает: она — шаг Orchestrator-а
  после мержа, diff — в «Итог» Ticket-а.

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-throughput](../worfy-throughput/spec.md), раздел «Соглашения для Ticket-ов этого
Epic-а»: сначала падающий test, только чтение чужих файлов, ручные пункты «(вручную)», Autopilot над
worfy — только на Stable copy, без `gh auth switch`, мерж в main — по очереди или набором
`wave-gate` (ADR-0065). Отличия:

- **Кто ведёт.** Epic идёт под Autopilot после `worfy-link`: `/worfy:epic-wave tickets 01 of epic
  worfy-pipeline` и дальше по Wave-ам. Миграцию (Ticket 01, шаг на настоящих Ticket-ах) и правку
  `profile.json` и `rules.md` Profile-а worfy делает Orchestrator после мержа.
- **Платформенные PR** (ADR-0056, пункт 2). 01 и 02 меняют скрипты Harness (`bin/ticket`,
  `epic-status`, `bin/profile`, `wave-gate`) и `scripts/install-stable.mjs` с ветками по платформе —
  перед мержем вердикт Windows. 03–06 и 08 меняют код worfy без веток по платформе, 07 — только текст
  skills: не платформенные.
- **Конец Ticket-а** — `pr-green-ci`: PR, зелёный CI на Linux, gate full — шаг Orchestrator-а перед
  merge, мерж — Orchestrator.
- **Когда правка Harness действует.** Живой Harness — копия, которую несёт сборка worfy
  (`src/main/harness/bundled.ts:1-5`). Правка `harness/` действует после `pnpm install:stable` и
  обновления Harness из Stable copy. Отметки начинают писаться после этого.
- **Ветки** — `worfy-pipeline/<NN>`; worktree — `.claude/worktrees/<NN>`, если путь занят деревом
  другого Epic-а — `.claude/worktrees/pl-<NN>`.
- **ADR.** ADR-0067 — этот PR. Ticket-ам новый ADR не нужен. Принятые ADR не правятся.
- **Скрипты Harness — на Node** (`#!/usr/bin/env node`), как `harness/bin/ticket` (ADR-0055).
  `epic-status` — bash и awk; Ticket 01 правит его разбор, не переписывает язык.
- **Без платных прогонов.** Test-ы Harness — shell test-ы `harness/bin/tests/*.test.sh` на временном
  репозитории, `gh` — stub. Ни одного запроса к настоящему GitHub из test-ов.
- **«Готово, когда»**: implementer гоняет e2e только своих spec-ов; строка про gate full — «gate full —
  шаг Orchestrator-а перед merge».
- **Язык.** Документы — русские, термины — латиницей, из `CONTEXT.md`; текст Harness, коммитов, код и
  надписи интерфейса — английские.

## Порядок

ADR-0067 и словарь (Stage, Pipeline в `CONTEXT.md`) — этот PR. Первым — 01: без новой шапки Stage
читал бы причину и «кого ждёт» из текста. 02 — после 01: оба правят `harness/bin/ticket`. 03 — после
01 и 02: читает новые поля шапки и отметки. 04 и 05 — параллельно после 03. 06 — после 04 и 05:
выделяет застрявших на доске и на Card. 07 — после 02, параллельно с 03: ему нужны отметки и поле
Pipeline, а не код worfy. 08 — последним.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `harness/bin/ticket`, `harness/bin/epic-status`, `harness/bin/TICKETS.md`, `harness/bin/tests/ticket-header.test.sh`, `src/shared/workflow/types.ts`, `src/renderer/canvas/epic-layout.ts`, `src/renderer/canvas/nodes/TicketNode.tsx`, `scripts/critical-path.mjs`, `test/unit/critical-path.test.ts`, `test/unit/epic-layout.test.ts`, `test/contract/workflow-reader.test.ts` | 1 |
| 02 | `harness/bin/ticket`, `harness/bin/tests/ticket-mark.test.sh`, `harness/bin/profile`, `harness/bin/tests/profile.test.sh`, `harness/profiles/draft.schema.json`, `harness/profiles/README.md`, `harness/bin/wave-gate`, `harness/bin/tests/wave-gate.test.sh`, `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/agents/implementer.md`, `src/main/github/prs.ts`, `test/contract/github-prs.test.ts`, `scripts/install-stable.mjs`, `test/unit/install-stable-functions.test.ts` | 2 |
| 03 | `src/shared/workflow/pipeline.ts`, `src/main/workflow/stages.ts`, `src/main/workflow/marks.ts`, `src/main/workflow/profile.ts`, `src/main/github/prs.ts`, `src/main/github/deployments.ts`, `src/shared/ipc/pipeline.ts`, `src/main/ipc/pipeline.ts`, `src/renderer/pipeline/usePipeline.ts`, `test/unit/pipeline.test.ts`, `test/contract/workflow-stages.test.ts`, `test/contract/github-prs.test.ts` | 3 |
| 04 | `src/renderer/shell/Toolbar.tsx`, `src/renderer/shell/AppShell.tsx`, `src/renderer/main.tsx`, `src/renderer/pipeline/PipelineBoard.tsx`, `src/renderer/pipeline/pipeline.css`, `src/renderer/shell/sidebar/PipelineSection.tsx`, `test/unit/pipeline-board.test.tsx`, `test/e2e/pipeline.spec.ts` | 4 |
| 05 | `src/renderer/pipeline/Stepper.tsx`, `src/renderer/canvas/nodes/TicketNode.tsx`, `src/renderer/canvas/badges/ChecksBadges.tsx`, `src/shared/ipc/checks.ts`, `src/main/github/prs.ts`, `test/unit/ticket-stepper.test.tsx`, `test/unit/checks-badges.test.tsx`, `test/contract/github-prs.test.ts`, `test/e2e/checks-badges.spec.ts` | 4 |
| 06 | `src/shared/workflow/pipeline.ts`, `src/renderer/pipeline/PipelineBoard.tsx`, `src/renderer/pipeline/Stepper.tsx`, `src/renderer/shell/sidebar/PipelineSection.tsx`, `src/main/workflow/waits-notify.ts`, `src/main/notify.ts`, `test/unit/pipeline.test.ts`, `test/unit/notify.test.ts`, `test/unit/pipeline-board.test.tsx`, `test/unit/ticket-stepper.test.tsx` | 5 |
| 07 | `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/bin/tests/epic-wave-ship-ticket.test.sh` | 3 |
| 08 | `src/renderer/settings/PipelineSection.tsx`, `src/renderer/settings/sections.ts`, `test/unit/settings-pipeline.test.tsx` | 6 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01.** Блокеров нет.
- **Wave 2 — 02.** Блокеров нет, но общий с 01 файл `harness/bin/ticket`.
- **Wave 3 — 03 и 07.** 03: `Blocked by: 01, 02`; 07: `Blocked by: 02`. Общих файлов нет.
- **Wave 4 — 04 и 05.** Оба `Blocked by: 03`. Общих файлов нет.
- **Wave 5 — 06.** `Blocked by: 04, 05`.
- **Wave 6 — 08.** `Blocked by: 03, 06`.

Пересечения проверены правилом `filesOverlap` (`src/shared/workflow/waves.ts:158`). Правка
`profile.json` и `rules.md` Profile-а worfy в таблицу не входит: файлы вне репозитория. Если
исполнителю нужен файл вне своего списка, он дописывает его в «Где в коде» при claim.
