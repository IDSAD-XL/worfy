# worfy-daily: worfy каждый день и Autopilot

Status: draft
Source: [roadmap.md](../../docs/roadmap.md), E2; [CONTEXT.md](../../CONTEXT.md); ADR
[0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md),
[0005](../../docs/adr/0005-worfy-own-state-inventory.md),
[0017](../../docs/adr/0017-english-canonical-terms.md)–[0021](../../docs/adr/0021-mcp-servers-allowlist-in-profile.md);
дизайн [F-SPEC.md](../../docs/design/F-SPEC.md); итог проектирования 2026-10-06; HANDOFF worfy-mvp, раздел «Риски и долги».
Ticket-ы: Epic `worfy-daily`, нумерация с `01`. Шапка — тот же простой диалект, что у worfy-mvp
(`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`, `ticket` и
вычисление Wave в worfy (`src/shared/workflow/waves.ts`).

## Цель

Владелец работает из worfy каждый день, а Wave-ы Epic-а идут в Autopilot — без человека. В этом
режиме worfy не даёт Mac уснуть на время Wave, ждёт сброса Limits и продолжает с того же места.
Любая точка, где понадобился человек, считается дефектом.

Epic готов, когда выполнены четыре условия:

1. Минимум две Wave-ы подряд прошли через worfy без человека. Доказательство — журнал прогона без
   событий `human-input` за эти Wave-ы и записи HANDOFF.
2. Каждое вмешательство человека стало Ticket-ом этого Epic-а. Вмешательство записано в журнал
   прогона событием `human-input`: его пишет worfy (действие пользователя в Session прогона) или
   агент-наблюдатель (касание вне worfy, например системный диалог). Такой Ticket получает
   следующий свободный номер, в `Source` — ссылка на эту запись журнала. Номер 21 занят
   нестабильными e2e, 22–28 — дефектами ручных проверок worfy-mvp 2026-10-06 ночью, 29 — дефектом
   первого настоящего прогона Autopilot 2026-10-06.
3. Хотя бы один настоящий упор в Limits в Autopilot на стабильной копии прошёл без человека: прогон
   продолжился сам после сброса. Доказательство — выдержка из журнала (`limits-hit`,
   `waiting-until`, `resumed`) и запись HANDOFF о паузе. Ticket 05 этого проверить не может: Wave-ы
   Autopilot начинаются только после него.
4. Владелец неделю работает из worfy.

## Как устроено

**Что остаётся как было.** worfy по-прежнему только показывает workflow и запускает его теми же
инструментами ([ADR-0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md)). Статус
Ticket-а worfy сам не пишет. В репозиторий Project и в `~/.claude` worfy не пишет
([ADR-0005](../../docs/adr/0005-worfy-own-state-inventory.md)).

**Новый модуль `src/main/autopilot/`.** Он ведёт прогон Autopilot над одним Epic-ом:

- Запускает Wave той же командой, что и кнопка «Run wave», — по шаблону действий Project
  (`src/shared/actions/render-template.ts`). Следующую Wave берёт из вычисления готовой Wave.
- Держит keep-awake (`powerSaveBlocker`) от старта прогона до его остановки.
- При отказе по Limits ждёт времени сброса. Потом шлёт Orchestrator сообщение «продолжай с того
  места».
- Каждое событие пишет в журнал прогона: `<dataRoot>/autopilot/<run>.jsonl`.

Запись о паузе в HANDOFF делает сам Orchestrator по тексту этого сообщения. worfy в репозиторий не
пишет.

Как понять, что Wave закончилась, решает ADR Ticket-а 04.

**Session без человека.** Autopilot запускает Session-ы с признаком «без человека». У такой Session:

- режим всегда `bypassPermissions`, сменить его нельзя;
- `canUseTool` не ждёт ответа в UI;
- запрос Card к Session не открывает диалог.

Диалог «Allow» из итога проектирования — это запрос разрешения с кнопками Allow / Always allow /
Deny (`src/renderer/session/PermissionCard.tsx`, Ticket 21 worfy-mvp). Её закрывает Ticket 02:
`canUseTool` больше не доходит до `PermissionGate`. Системные «Allow» macOS (уведомления, права на
папки, Keychain) worfy не видит. Их ловят ручные проверки Ticket-ов 03 и 04 (риск 5).

Subagent-ы и Subagent-ы workflow-скриптов наследуют режим своей Session (Ticket 02).

**Стабильная копия.** Autopilot над самим worfy идёт только на копии `.app` вне репозитория
(например `~/Applications/worfy-stable.app`). Агенты в это время пересобирают и тестируют dev-версию
в своих worktree. Копия обновляется по порядку из README (Ticket 03).

**Profile в worfy.** worfy впервые читает Profile — пока через `~/.claude/bin/profile`. Plugin
Harness и Profile из двух частей появятся только в E3. Из Profile берётся список MCP-серверов для
Session-ов, которые запускает worfy. По умолчанию в нём `qmd` и `worfy-canvas`
([ADR-0021](../../docs/adr/0021-mcp-servers-allowlist-in-profile.md)).

**Кто ведёт Wave-ы:**

- Wave-ы 1–3 (тема A и Ticket 21) ведёт Orchestrator из CLI.
- После Wave 3 стабильная копия обновляется.
- Первый прогон Autopilot 2026-10-06 на Ticket-ах 06–09 остановился через 85 секунд с `no-progress` и
  убил четыре фоновых implementer-а (Ticket 29). Autopilot стоит, пока Ticket 29 не влит. Wave 4 —
  только Ticket 29, её тоже ведёт Orchestrator из CLI; после неё копия обновляется снова.
- С Wave 5 Wave-ы ведёт Orchestrator worfy в Autopilot.
- Внешний агент наблюдает за Autopilot через computer use: снимки экрана, счёт касаний человека.
  Каждое касание вне worfy он дописывает в журнал прогона событием `human-input` (Ticket 01).
  У Session, запущенной через SDK, нет computer use для Claude desktop, поэтому наблюдатель —
  отдельная Session.
- Тестовые сборки внутри worfy проверяются Playwright `_electron`, а не computer use.

## Этапы

Темы идут по порядку A → B → C → D → E → F. Номера Ticket-ов идут в том же порядке, кроме 22–29:
22–28 — тема C, 29 — тема A, но их завели позже. Порядок держат рёбра `Blocked by` (раздел «Волны»). Исключение —
Ticket 21 (тема E): он идёт в Wave 1, см. пункт 5.

1. **A — Autopilot** — 01–05 и 29.
   - 01: журнал прогона.
   - 02: Session без человека.
   - 03: стабильная копия.
   - 04: Autopilot на Epic — цикл Wave-ов, keep-awake, остановка.
   - 05: ожидание сброса Limits и продолжение.
   - 29: Autopilot ждёт background task-и Orchestrator-а, Stop их не убивает. Дефект первого
     настоящего прогона Autopilot 2026-10-06: прогон кончил Wave с концом хода Orchestrator-а, пока
     фоновые implementer-ы ещё работали, остановился с `no-progress`, а перезапуск Orchestrator-а
     убил implementer-ов. Тема B ждёт его: 06–09 блокированы 29.
   - Итог этапа: Autopilot проводит Wave-ы на стабильной копии, ни одного диалога.
2. **B — устойчивость и цена** — 06–09.
   - 06: MCP-серверы по списку Profile. Сейчас Session получает 634 tools, и на haiku падает
     «Prompt too long».
   - 07: модель — без haiku, минимум sonnet. Orchestrator по умолчанию на модели пользователя.
   - 08: зависшие running Subagent-ы (13 из 109 на Auction).
   - 09: задержка `workflow.changed` и двойное чтение истории, с замером на настоящем Auction.
3. **C — UI-баги** — 10–16 и 22–28.
   - 10: рамки Epic поверх Node-ов.
   - 11: обрезанные заголовки и chip-ы.
   - 12: закреплённый Node под миникартой и toolbar выделения над ним.
   - 13: Terminal — масштаб и focus mode.
   - 14: время у строк транскрипта.
   - 15: текст окна ошибки запуска.
   - 16: `ELECTRON_RENDERER_URL` только в dev-сборке.
   - 22: Session view и Node после Resume показывают прошлые ходы.
   - 23: настройки Session Node-а сохраняются; Default — модель и effort пользователя.
   - 24: свои Session-ы worfy — один Node до первого хода, подписи в sidebar и Session view.
   - 25: slash-меню без дублей, выводы hook-ов без ложной ошибки.
   - 26: toolbar — подписи Limits, длинное имя Project-а, статус окна после моста status line.
   - 27: блок состояния Orchestrator-а помещается в Node.
   - 28: размещение Node-ов Subagent-ов и Session из «Ship ticket».
   - Ticket-ы 22–28 — дефекты ручных проверок worfy-mvp 2026-10-06 ночью, которые мешают работать
     из worfy каждый день. Источник — HANDOFF, «Риски и долги». Тему D они не держат: общих файлов
     с Ticket-ом 17 у них нет.
4. **D — наблюдаемость** — 17. Subagent-ы workflow-скриптов в дереве. Бейджи PR и CI сверяются на
   живых PR этого Epic-а.
5. **E и F — качество и процесс** — 18–21.
   - 18: helper снимков в двух темах (тема F).
   - 19: test-ы, зависящие от порядка файлов, и временные файлы test-ов в `src/`.
   - 20: непокрытые мутанты worfy-mvp.
   - 21: нестабильные e2e (тема E). Решением владельца 2026-10-06 вынесен из 18 и идёт в Wave 1 без
     блокеров. CI на main красный примерно в 9 из последних 39 прогонов из-за нестабильных e2e, и в
     это упирался бы каждый PR тем A–D.

Правило ревью UI для темы F вносит сам workflow проектирования, отдельным изменением skill. Ticket-а
под него нет. Ревьюер UI-Ticket-а снимает тестовую сборку `page.screenshot()` в обеих темах и
сверяет снимки с F-SPEC.

## Не в этом Epic-е

**E3 — Harness как часть worfy** ([roadmap](../../docs/roadmap.md)):

- plugin Claude Code в `harness/`;
- обобщение общих файлов;
- установка, обновление и перенос разрозненных файлов `~/.claude`;
- первый запуск — проверка Claude Code, git, gh, node;
- подключение Project с черновиком Profile;
- Profile из двух частей и `GH_TOKEN` на Project;
- Project над несколькими репозиториями.

В E2 Profile читается только через нынешний `~/.claude/bin/profile`. Новые поля Profile владелец
вносит в свой Profile вручную.

**E4:** подпись Developer ID и нотаризация.

**Прочее вне Epic-а:**

- Запись worfy в репозиторий Project или в `~/.claude`, в том числе HANDOFF: его пишет Orchestrator.
- Смена `settingSources` Session ([ADR-0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md)).
- Показ журнала прогона в UI. В E2 видна только строка состояния прогона.
- Долги worfy-mvp, которых нет в темах A–F. Например, regexp имён Subagent-ов или файлы продолженной
  Session у исходного `sessionId`.
- Всё, что было вне worfy-mvp: Dock, remote, другие провайдеры, несколько окон.

## Риски и открытые технические вопросы

1. **Когда Wave закончена.** Сейчас конец Wave — не событие. Launcher только опрашивает закрытые
   Session (`src/main/actions/launch.ts:154-186`). Статус Ticket-ов ставит сам агент. Решение
   принимает ADR Ticket-а 04 до кода. Признак ADR-0024 — ход кончился, Ticket-ов Wave в работе
   нет — не сработал в первом настоящем прогоне: Orchestrator кончил ход, пока фоновые
   implementer-ы ещё не взяли Ticket-ы. Дополнение — ADR-0029 Ticket-а 29.
2. **Session в `error` блокирует очередь** до «Send queued» (`src/main/agent/session.ts:10-11`).
   Autopilot должен это распознать и остановиться с причиной (Ticket 04).
3. **Как SDK сообщает об упоре в Limits.** Это может быть `rate_limit_event` со статусом `rejected`,
   `result` с ошибкой или и то, и другое. Ещё неизвестно, в каких единицах приходит `resetsAt`.
   Формат события уже менялся: несовпадение формата молча даёт `[]`
   (`src/shared/agent/limits.ts:4-8`). Отвечает первый шаг Ticket-а 05.
4. **Keep-awake и закрытая крышка.** `prevent-app-suspension` не держит Mac бодрым при закрытой
   крышке. Выбор записывает ADR Ticket-а 04.
5. **Диалоги ОС вне Electron.** Из кода не видны запросы на уведомления, Keychain и права на папки.
   Ad-hoc подпись меняется с каждой сборкой, и macOS может спросить права заново. Проверяется вживую
   через computer use (Ticket-ы 03 и 04). Порядок обновления копии учитывает это.
6. **Одна папка данных у копии и dev-версии** (`src/main/storage/paths.ts:10-13`). Одновременный
   запуск портит `limits.json` и `bindings.json`. Решение принимает ADR Ticket-а 03.
7. **Смена режима разрешений посреди прогона** (`src/main/agent/options.ts:77`) дала бы невидимый
   диалог. Решение принимает Ticket 02.
8. **Ограничить MCP-серверы, сохранив `settingSources` пользователя.** Способ в SDK не проверен.
   Заменить `mcpServers` целиком нельзя: пропадёт нужный `qmd`. Отвечает первый шаг Ticket-а 06.
9. **Ложный `done` у живого Subagent-а** хуже зависшего `running` (Ticket 08).
10. **Кто знает размер рамок Epic.** Сейчас его знает только renderer, а размещение делает main
    (Ticket 10). Перенос кода из `src/renderer` в main нарушил бы границу пакетов.
11. **Нестабильные e2e до Ticket-а 21** дают красный CI в PR Wave 1. Поэтому Ticket 21 стоит в
    Wave 1: к Wave-ам Autopilot (с Wave 5) e2e должны быть стабильны. Если красный CI из-за e2e
    вернётся в Autopilot, это вмешательство: оно записывается в журнал событием `human-input`.
    Повторное — сразу Ticket.
12. **Объём Subagent-ов workflow-скриптов**: 1303 транскрипта, 2,52 GB. Нужны дочитывание хвоста и
    предел глубины обхода (Ticket 17).
13. **Profile у других пользователей.** Скрипта `profile` может не быть. Нужен мягкий отказ со
    списком по умолчанию (Ticket 06). Насовсем вопрос закроет E3.
14. **Общий на деле файл в Wave 1.** `test/e2e/helpers.ts` и `playwright.config.ts` есть только в
    «Где в коде» Ticket-а 21. Но `test/e2e/packaged.spec.ts` Ticket-а 03 запускает приложение через
    `launchApp` из `helpers.ts`. Ticket 03 передаёт путь к `.app` через env, а `launchApp` уже
    принимает `executablePath`, так что править `helpers.ts` ему не нужно. Если всё же понадобится,
    Ticket 03 правит его только после merge Ticket-а 21, не параллельно. PR Ticket-а 21 лучше слить
    в Wave 1 первым: остальные PR Wave 1 после rebase проходят CI уже на стабильных e2e.

## Соглашения для Ticket-ов этого Epic-а

- **Ветки и worktree** — только по номеру Ticket-а: ветка `worfy-daily/<NN>`, worktree
  `.claude/worktrees/<NN>`. Файлы Ticket-ов сохраняют русские slug-и в именах.
- **ADR.** Новые решения идут с `docs/adr/0022-…`, по одному решению на файл. Номер резервирует
  `ship-ticket` при старте Ticket-а, поэтому номера идут в порядке взятия. Принятые ADR правятся
  только в терминах, без изменения смысла
  ([ADR-0017](../../docs/adr/0017-english-canonical-terms.md)). Решение, которое Ticket называет
  «ADR», принимается до кода.
- **Gate.** Проверка — `bash ~/.claude/hooks/gate.sh fast </dev/null; echo $?`: `lint`, `typecheck`
  и `test` в корне. `full` добавляет `test:e2e`. Зелёный только код 0 вместе со строкой
  `[gate] зелено`.
- **Сначала падающий test.** Каждый Ticket начинается с test-а, который падает без изменения. В
  «Итог» записывается, как он падал.
- **Виды test-ов** — как в worfy-mvp:
  - unit — vitest над `src/shared/`;
  - contract — vitest на границе;
  - e2e — Playwright `_electron` с `WORFY_DATA_DIR` и `WORFY_CLAUDE_HOME` во временной папке и
    `WORFY_AGENT=fake`.
- **Только чтение чужих файлов.** worfy не пишет в репозиторий Project и в `~/.claude`. Ticket,
  который читает эти места, проверяет это test-ом: дерево до и после совпадает. Замеры на настоящем
  Auction (`/Users/alexey/Work/Auction`) — тоже только чтение.
- **Ручные пункты.** Помечаются «(вручную)». Рядом сразу написано, как проверить: e2e, снимок или
  команда. Итог ручной проверки идёт в «Итог» Ticket-а.
- **Снимки UI.** UI-Ticket снимает тестовую сборку `page.screenshot()` в светлой и тёмной теме
  (`window.emulateMedia({ colorScheme })`). Снимки сверяются с F-SPEC и макетами
  `docs/design/F-*.dc.html`. После Ticket-а 18 для этого есть helper `test/e2e/snapshots.ts`.
- **Autopilot над worfy — только на стабильной копии** (Ticket 03), никогда на dev-сборке из
  worktree. Ticket 04 это применяет: в непакованной сборке Autopilot на Project самого worfy
  отклоняется.
- **Названия действий в UI** — по-английски, как в [BRIEF.md](../../docs/design/BRIEF.md): «Run
  wave», «Autopilot», «Stop autopilot».

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план: номера Wave-ов посчитаны заранее по `Blocked by` и спискам файлов. Wave,
которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md, термин Wave). Номер в
таблице её не задаёт, поэтому порядок тем держат рёбра `Blocked by`. Все Ticket-ы
открыты. Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

Часть рёбер `Blocked by` держит порядок тем, а не зависимость кода:

- Ticket-ы 06–09 блокированы 05 и 29, потому что их ведёт Orchestrator worfy в Autopilot: без 05 он
  не переждёт Limits, без 29 кончит Wave, пока фоновые implementer-ы ещё работают.
- Ticket-ы 10, 12–15 и 22–28 блокированы 06–09: тема C идёт после B.
- Ticket 17 блокирован 11, 12, 13, 14 и 16 (15 — через 16): тема D идёт после Ticket-ов 10–16
  темы C. Ticket-ы 22–28 тема D не ждёт: общих файлов с Ticket-ом 17 у них нет.
- Ticket-ы 18–20 блокированы 17: темы E и F идут после D.
- У Ticket-а 21 (нестабильные e2e, тема E) блокеров нет: решением владельца 2026-10-06 он идёт в
  Wave 1 вместе с темой A.
- У Ticket-а 29 (тема A) блокеров нет: он идёт в Wave 4, до темы B.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `src/shared/autopilot/journal.ts`, `src/main/autopilot/journal.ts`, `test/unit/autopilot-journal.test.ts`, `test/contract/autopilot-journal.test.ts` | 1 |
| 02 | `src/main/agent/options.ts`, `src/main/agent/permissions.ts`, `src/main/agent/session-settings.ts`, `src/main/ipc/card-api.ts`, `test/unit/agent-options.test.ts`, `test/contract/permissions.test.ts`, `test/contract/card-api.test.ts` | 1 |
| 03 | `scripts/install-stable.sh`, `package.json`, `src/main/storage/paths.ts`, `src/main/index.ts`, `README.md`, `test/unit/paths.test.ts`, `test/e2e/packaged.spec.ts` | 1 |
| 21 | `test/e2e/helpers.ts`, `playwright.config.ts`, `test/e2e/palette-find.spec.ts`, `test/e2e/subagent-tree.spec.ts`, `test/e2e/canvas-layout.spec.ts`, `test/e2e/binding.spec.ts`, `test/e2e/new-session.spec.ts`, `test/e2e/epic-frame.spec.ts` | 1 |
| 04 | `src/shared/autopilot/cycle.ts`, `src/main/autopilot/run.ts`, `src/main/autopilot/power.ts`, `src/shared/ipc/autopilot.ts`, `src/main/ipc/autopilot.ts`, `src/renderer/canvas/actions/AutopilotAction.tsx`, `src/main/actions/launch.ts`, `test/fixtures/agent-scripts/autopilot-waves.jsonl`, `test/unit/autopilot-cycle.test.ts`, `test/unit/autopilot-power.test.ts`, `test/contract/autopilot.test.ts`, `test/e2e/autopilot.spec.ts` | 2 |
| 05 | `src/shared/autopilot/resume-at.ts`, `src/main/autopilot/limits-wait.ts`, `src/main/autopilot/run.ts`, `src/main/agent/limits.ts`, `src/renderer/canvas/actions/AutopilotAction.tsx`, `test/fixtures/agent-scripts/autopilot-limits.jsonl`, `test/unit/autopilot-resume-at.test.ts`, `test/contract/autopilot-limits.test.ts` | 3 |
| 29 | `docs/adr/0029-autopilot-waits-for-background-tasks.md`, `src/shared/agent/events.ts`, `src/shared/agent/background-tasks.ts`, `src/main/agent/session.ts`, `src/shared/autopilot/cycle.ts`, `src/main/autopilot/run.ts`, `src/main/agent/orchestrator.ts`, `src/shared/autopilot/journal.ts`, `src/shared/ipc/autopilot.ts`, `src/renderer/canvas/actions/AutopilotAction.tsx`, `src/main/agent/fake-query.ts`, `test/fixtures/sdk-messages/`, `test/fixtures/agent-scripts/autopilot-background.jsonl`, `test/unit/background-tasks.test.ts`, `test/unit/autopilot-cycle.test.ts`, `test/contract/autopilot-background.test.ts`, `test/contract/agent-events.test.ts`, `test/e2e/autopilot.spec.ts` | 4 |
| 06 | `src/main/workflow/profile.ts`, `src/main/agent/options.ts`, `src/main/agent/app-registry.ts`, `test/contract/workflow-profile.test.ts`, `test/unit/agent-options.test.ts` | 5 |
| 07 | `src/main/agent/session.ts`, `src/main/claude-home/user-model.ts`, `src/shared/agent/settings.ts`, `src/renderer/session/composer/Pickers.tsx`, `src/main/agent/fake-query.ts`, `test/contract/agent-controls.test.ts`, `test/e2e/session-controls.spec.ts` | 5 |
| 08 | `src/shared/transcript/subagents.ts`, `src/main/claude-home/subagents.ts`, `src/renderer/canvas/sources/subagents.ts`, `test/unit/subagents.test.ts`, `test/contract/claude-home-subagents.test.ts`, `test/fixtures/claude-home/` | 5 |
| 09 | `src/main/workflow/watch.ts`, `src/renderer/claude-home/useClaudeHome.ts`, `test/contract/workflow-reader.test.ts`, `test/unit/claude-home-titles.test.tsx` | 5 |
| 10 | `src/shared/layout/derived.ts`, `src/main/layout/place.ts`, `src/renderer/canvas/epic-layout.ts`, `src/renderer/canvas/sources/epics.ts`, `src/renderer/canvas/sources/subagents.ts`, `test/unit/epic-layout.test.ts`, `test/unit/epic-canvas.test.tsx`, `test/unit/subagent-nodes.test.tsx`, `test/e2e/new-session.spec.ts`, `test/e2e/epic-frame.spec.ts`, `test/e2e/subagent-tree.spec.ts`, `docs/adr/0032-epic-frames-avoid-nodes.md` | 6 |
| 12 | `src/renderer/canvas/pinning.ts`, `src/renderer/canvas/overlays/SelectionToolbar.tsx`, `src/renderer/canvas/overlays/FocusEntry.tsx`, `src/renderer/canvas/overlays/MiniMapOverlay.tsx`, `src/renderer/canvas/node-chrome.css`, `test/unit/pinning.test.tsx`, `test/e2e/pin-tags.spec.ts` | 6 |
| 13 | `src/renderer/canvas/nodes/TerminalNode.tsx`, `src/renderer/focus/FocusMode.tsx`, `test/e2e/terminal.spec.ts`, `test/e2e/focus.spec.ts` | 6 |
| 14 | `src/renderer/session/fold.ts`, `src/renderer/session/Transcript.tsx`, `src/renderer/session/session.css`, `src/shared/agent/events.ts`, `test/unit/session-view.test.tsx`, `test/e2e/session-view.spec.ts` | 6 |
| 15 | `src/main/startup-failure.ts`, `src/main/index.ts`, `src/main/window.ts`, `test/contract/startup-failure.test.ts`, `test/e2e/window.spec.ts` | 6 |
| 22 | `src/renderer/session/SessionView.tsx`, `src/renderer/session/store.ts`, `src/renderer/canvas/nodes/SessionNode.tsx`, `test/unit/session-log-resume.test.ts`, `test/e2e/session-resume.spec.ts` | 6 |
| 26 | `src/renderer/limits/LimitBar.tsx`, `src/renderer/shell/Toolbar.tsx`, `src/renderer/shell/shell.css`, `src/shared/agent/limits.ts`, `test/unit/limits.test.ts`, `test/e2e/limits.spec.ts`, `test/e2e/toolbar.spec.ts` | 6 |
| 11 | `src/renderer/canvas/epic-layout.ts`, `src/renderer/canvas/epic-frame.css`, `src/renderer/canvas/nodes/EpicFrameNode.tsx`, `src/renderer/canvas/nodes/TicketNode.tsx`, `src/renderer/canvas/badges/ChecksBadges.tsx`, `src/renderer/canvas/badges/checks-badges.css`, `src/renderer/shell/sidebar/EpicsSection.tsx`, `test/unit/epic-layout.test.ts`, `test/e2e/epic-frame.spec.ts`, `test/e2e/checks-badges.spec.ts` | 7 |
| 16 | `src/main/window.ts`, `src/main/ipc/index.ts`, `src/main/index.ts`, `test/unit/renderer-entry.test.ts`, `test/contract/actions.test.ts`, `test/e2e/packaged.spec.ts` | 7 |
| 23 | `src/main/agent/node-sessions.ts`, `src/main/agent/app-node-sessions.ts`, `src/main/agent/session.ts`, `src/main/claude-home/user-model.ts`, `test/contract/node-sessions.test.ts`, `test/contract/agent-controls.test.ts` | 7 |
| 25 | `src/main/agent/commands.ts`, `src/shared/transcript/parse.ts`, `src/renderer/session/Transcript.tsx`, `test/unit/slash-commands.test.ts`, `test/contract/transcript-parse.test.ts`, `test/unit/transcript-hooks.test.tsx` | 7 |
| 27 | `src/renderer/canvas/nodes/OrchestratorNode.tsx`, `src/shared/ipc/orchestrator.ts`, `src/main/agent/orchestrator.ts`, `test/unit/orchestrator-node.test.tsx`, `test/e2e/orchestrator.spec.ts` | 7 |
| 17 | `src/main/claude-home/subagents.ts`, `src/shared/transcript/subagents.ts`, `src/main/claude-home/tail.ts`, `test/contract/claude-home-subagents.test.ts`, `test/unit/subagents.test.ts`, `test/e2e/subagent-tree.spec.ts`, `test/fixtures/claude-home/` | 8 |
| 24 | `src/main/agent/session.ts`, `src/main/agent/fake-query.ts`, `src/main/agent/options.ts`, `src/main/claude-home/registry.ts`, `src/renderer/claude-home/session-nodes.ts`, `src/renderer/shell/sidebar/SessionsSection.tsx`, `src/renderer/session/SessionView.tsx`, `test/unit/session-nodes.test.tsx`, `test/unit/agent-options.test.ts`, `test/contract/agent-session.test.ts`, `test/e2e/own-sessions.spec.ts` | 8 |
| 28 | `src/renderer/canvas/sources/subagents.ts`, `src/renderer/canvas/actions/TicketActions.tsx`, `src/shared/ipc/actions.ts`, `src/main/ipc/actions.ts`, `src/main/actions/launch.ts`, `src/main/agent/node-sessions.ts`, `src/main/layout/place.ts`, `test/unit/subagent-nodes.test.tsx`, `test/unit/layout-place.test.ts`, `test/contract/node-sessions.test.ts`, `test/e2e/ship-ticket.spec.ts` | 8 |
| 18 | `test/e2e/snapshots.ts`, `test/e2e/snapshots.spec.ts` | 9 |
| 19 | `test/unit/canvas.test.tsx`, `test/unit/shell-discovery.test.tsx`, `test/unit/session-rail-discovery.test.tsx`, `test/unit/focus-mode.test.tsx`, `vitest.config.ts`, `.gitignore`, `eslint.config.js`, `.github/workflows/ci.yml` | 9 |
| 20 | `test/unit/canvas-actions.test.tsx`, `test/unit/gate-state.test.ts`, `test/contract/github-prs.test.ts`, `test/unit/claude-home-titles.test.tsx`, `test/unit/session-nodes-overlay.test.tsx`, `test/unit/message-input-slash.test.tsx`, `test/unit/history.test.ts`, `test/unit/session-view.test.tsx`, `test/e2e/pin-tags.spec.ts`, `test/contract/canvas-tools.test.ts`, `test/contract/card-protocol.test.ts`, `test/contract/workflow-reader.test.ts` | 9 |

Общие файлы есть только у Ticket-ов разных Wave-ов:

- `src/main/agent/options.ts` и `test/unit/agent-options.test.ts`: 02 → 06 → 24.
- `src/main/index.ts`: 03 → 15 → 16.
- `test/e2e/packaged.spec.ts`: 03 → 16.
- `src/main/autopilot/run.ts` и `src/renderer/canvas/actions/AutopilotAction.tsx`: 04 → 05 → 29.
- `src/shared/autopilot/cycle.ts`, `src/shared/ipc/autopilot.ts`, `test/unit/autopilot-cycle.test.ts`,
  `test/e2e/autopilot.spec.ts`: 04 → 29.
- `src/shared/autopilot/journal.ts`: 01 → 29.
- Дерево Subagent-ов — `src/shared/transcript/subagents.ts`, `src/main/claude-home/subagents.ts`,
  `test/unit/subagents.test.ts`, `test/contract/claude-home-subagents.test.ts`,
  `test/fixtures/claude-home/`: 08 → 17.
- `src/renderer/canvas/epic-layout.ts` и `test/unit/epic-layout.test.ts`: 10 → 11.
- `test/e2e/epic-frame.spec.ts`: 21 → 10 → 11.
- `test/e2e/new-session.spec.ts`: 21 → 10.
- `test/e2e/subagent-tree.spec.ts`: 21 → 10 → 17.
- `src/main/window.ts`: 15 → 16.
- `test/contract/workflow-reader.test.ts` и `test/unit/claude-home-titles.test.tsx`: 09 → 20.
- `test/e2e/pin-tags.spec.ts`: 12 → 20.
- `test/unit/session-view.test.tsx`: 14 → 20.
- `src/main/actions/launch.ts`: 04 → 28.
- `src/main/agent/session.ts`: 29 → 07 → 23 → 24.
- `src/main/claude-home/user-model.ts` и `test/contract/agent-controls.test.ts`: 07 → 23.
- `src/main/agent/fake-query.ts`: 29 → 07 → 24.
- `src/renderer/canvas/sources/subagents.ts` и `test/unit/subagent-nodes.test.tsx`: 08 → 10 → 28.
- `src/main/agent/node-sessions.ts`: 23 → 28.
- `src/main/agent/orchestrator.ts`: 29 → 27.
- `src/shared/agent/events.ts`: 29 → 14.
- `src/main/layout/place.ts`: 10 → 28.
- `src/renderer/session/Transcript.tsx`: 14 → 25.
- `src/renderer/session/SessionView.tsx`: 22 → 24.
- `test/contract/node-sessions.test.ts`: 23 → 28.

Ticket 16 стоит после 15 по блокеру: окно ошибки запуска из 15 нужно для невалидного URL. Ticket 20
стоит после 09, 10, 12 и 14: они меняют код, на который указывают места мутантов. По той же
причине он стоит и после 22: тот меняет `src/renderer/session/store.ts`, где место мутанта `:81`.

Ticket-ы 22–28 стоят после Ticket-ов, с которыми у них общие файлы:

- 23 — после 10: оба меняют `src/main/agent/node-sessions.ts`.
- 24 — после 22 (`src/renderer/session/SessionView.tsx`) и 23 (`src/main/agent/session.ts`).
- 25 — после 14: оба меняют `src/renderer/session/Transcript.tsx`.
- 27 — после 10: вариант (а) меняет размер Node-а Orchestrator-а в `src/main/agent/orchestrator.ts`.
- 28 — после 10 и 23: общие `src/main/agent/node-sessions.ts`, `src/main/layout/place.ts` и их
  test-ы; место Ticket-а для «Ship ticket» зависит от ADR Ticket-а 10.

Внутри одной Wave общих файлов нет. Всего Wave-ов в плане — 9. Wave-ы 1–4 содержат только тему A и, в Wave 1, Ticket 21.

Строка Ticket-а 10 перечисляет файлы всех вариантов его ADR. После ADR строка сокращается до
выбранного варианта. Пересечений с другими Ticket-ами Wave 6 нет ни при одном варианте. Строки
Ticket-ов 24, 27 и 28 тоже перечисляют файлы всех вариантов; пересечений внутри их Wave-ов нет ни при
одном.
