# 17 — Subagent-ы workflow-скриптов в дереве; бейджи PR и CI на живых PR

Type: task
Status: done — 2026-10-06, [PR #73](https://github.com/IDSAD-XL/worfy/pull/73)
Blocked by: 08, 11, 12, 13, 14, 16
Source: [spec.md](../spec.md), тема D, риск 12; Ticket 09 worfy-mvp (`.scratch/worfy-mvp/issues/09-формат-транскриптов-и-реестра.md:137`); Ticket 15 worfy-mvp (`.scratch/worfy-mvp/issues/15-дерево-subagent-ов.md:134`); Ticket 17 worfy-mvp (бейджи)

## Что делаем

**Subagent-ы workflow-скриптов.** Без них Autopilot на Canvas не виден: Wave идёт через
workflow-скрипт, а его агенты в дерево Subagent-ов не попадают.

- Они лежат в `<sessionId>/subagents/workflows/wf_*/`.
- `SubagentReader.files(folder)` (`src/main/claude-home/subagents.ts:101`) читает один уровень
  каталога и берёт только файлы с именем `agent-….(jsonl|meta.json)` (`:18`). Каталог `workflows/`
  пропускается (комментарий `:9`).
- Ticket 15 worfy-mvp назвал только `subagents/agent-<id>.*`.
- Ticket 09 worfy-mvp нашёл:
  - `wf_*` лежат глубже, рядом с ними `journal.jsonl` с записями `{type: started, key, agentId}`;
  - 1303 из 4204 транскриптов Subagent-ов — workflow-агенты, 2,52 GB всего;
  - у wf-агентов, по его выводу, нет `meta.toolUseId` и `parentAgentId`. Это нужно проверить на
    файлах.

**Первый шаг — разбор настоящих `wf_*`, только чтение.** Что лежит в `journal.jsonl` и `meta`. Как
связать агента с вызовом workflow-скрипта в транскрипте Session. Итог — в «Итог».

**Решение до кода — ADR (номер с 0022): как показывать.** Например: вложить агентов под вызов
workflow-скрипта или показать плоской группой.

**Обход `wf_*/`.** С пределом глубины и дочитыванием хвоста файла (`src/main/claude-home/tail.ts`).
2,52 GB целиком не читаются.

**Бейджи PR и CI** (Ticket 17 worfy-mvp) проверяются на живых PR этого Epic-а. Во время Wave с
открытыми PR сравнить бейджи на Ticket-ах с `gh pr view <N> --json state,statusCheckRollup`. Каждое
расхождение — новый Ticket этого Epic-а.

## Готово, когда

- [x] ADR о показе Subagent-ов workflow-скриптов принят.
- [x] Фикстура `<sessionId>/subagents/workflows/wf_x/agent-*.jsonl` с `journal.jsonl`: агенты появляются в дереве так, как решил ADR. Без каталога `workflows/` дерево такое же, как раньше.
- [x] Повторное чтение изменившегося транскрипта wf-агента берёт только хвост: test проверяет счётчик прочитанных байт.
- [x] (вручную) Время первого показа дерева Session с workflow на Auction — в «Итог».
- [ ] (вручную) Во время Wave в Autopilot агенты workflow-скрипта видны на Canvas. Снимок — в «Итог».
- [ ] (вручную) Для каждого открытого PR этого Epic-а бейджи PR и CI на Ticket-е совпадают с `gh pr view`. Расхождения стали Ticket-ами, снимки — в «Итог».
- [x] Снимки дерева в светлой и тёмной теме сверены с F-SPEC.
- [x] `~/.claude` только читается: дерево временного `WORFY_CLAUDE_HOME` после test-а не изменилось.

## Тесты

- `test/contract/claude-home-subagents.test.ts` — фикстура `wf_*`; счётчик прочитанных байт.
- `test/unit/subagents.test.ts` — связка wf-агента с вызовом workflow-скрипта.
- `test/e2e/subagent-tree.spec.ts` — агенты workflow-скрипта видны в дереве.
- Сначала падающий test: с фикстурой `wf_x` агентов workflow-скрипта в дереве нет.

## Где в коде

- `src/main/claude-home/subagents.ts`
- `src/shared/transcript/subagents.ts`
- `src/main/claude-home/tail.ts`
- `test/contract/claude-home-subagents.test.ts`
- `test/unit/subagents.test.ts`
- `test/e2e/subagent-tree.spec.ts`
- `test/fixtures/claude-home/`

## Итог

**Разбор настоящих `wf_*`** (`~/.claude/projects` на 2026-10-07, только чтение; 104 каталога запусков в 10 Session-ах; вызовы `Workflow` — в транскриптах 13 Session-ов):
- Каталог запуска `<sessionId>/subagents/workflows/<runId>/` держит `agent-<id>.jsonl`, `agent-<id>.meta.json` и `journal.jsonl`; глубже каталогов нет.
- `meta.json` — `{"agentType":"workflow-subagent","spawnDepth":1}` (118 файлов); в новых версиях ещё `description` (метка `impl:03`), `workflowPhase`, `requestShape`; `agentType` бывает и обычным (`Explore` — 24, `atakama-researcher` — 6). **`toolUseId` и `parentAgentId` нет ни у одного** — вывод Ticket-а 09 worfy-mvp подтвердился.
- `journal.jsonl`: `started` (`agentId`, `key`; в новых — `label`, `phase`), `result` (`agentId`, `result` — объект или текст), `failed` (`agentId`), `launched` без агента. По всем журналам: 1908 `started`, 1854 `result`, 20 `failed`, 83 `launched`.
- Связь с Session: вызов `Workflow` (входы `script` или `scriptPath`, `args`, `resumeFromRunId`). Его результат — текст «Workflow launched in background. Task ID: … Summary: … Transcript dir: …/subagents/workflows/<runId> … Run ID: <runId>» и `toolUseResult` с `runId`, `taskId`, `workflowName` (115 из 115 результатов). Конец — task-notification с `tool-use-id` вызова, из очереди и `user`-записью.
- `resumeFromRunId` пишет в тот же `<runId>` (оба найденных случая).
- Агент кончает вызовом `StructuredOutput`, а не `end_turn`: по транскрипту агента конец не виден, нужен журнал.
- `<sessionId>/workflows/wf_*.json` — итог запуска с метками всех агентов; до 870 KB из-за текста скрипта; не читается (ADR-0035).

**Решение** — [ADR-0035](../../../docs/adr/0035-workflow-script-subagents-in-tree.md): запуск — одна запись дерева типа `workflow` под Session, агенты — её дети; связь по `Run ID:`; статус агента — по журналу, оборванный кончившимся запуском или закрытой Session — `error`; чтение ровно `subagents/workflows/wf_*/`, не больше 200 запусков, с курсора.

**Код.** `src/shared/transcript/subagents.ts` — сигнал `workflow`, `SubagentFile.workflow`, `readWorkflowJournal`, `workflowAgentFile`, запись запуска в `buildSubagentTree`. `src/main/claude-home/subagents.ts` — обход каталогов запусков, дочитывание журналов, `bytesRead`, поиск транскрипта агента запуска. `src/main/claude-home/tail.ts` — `TailChunk.bytesRead`. Renderer не менялся: запись запуска рисует тот же `SubagentNode`.

**Тесты.**
- `test/unit/subagents.test.ts` — разбор журнала; связка агентов с вызовом `Workflow`; running → done/error; обрыв кончившимся запуском и закрытой Session; имя из `script`, `scriptPath` и `runId`; запуск без вызова; возобновлённый запуск; вызов Bash с `Run ID:` запуском не считается.
- `test/contract/claude-home-subagents.test.ts` — фикстура 1212 через IPC; транскрипт агента запуска; повторное чтение выросшего транскрипта на 400 KB стоит дописанной строки и байта на файл (`bytesRead`); журнал кончает агентов; Claude home не меняется; каталог глубже `wf_*/` и не `wf_*` не читается.
- `test/unit/tail.test.ts` — вне следа, но test файла из следа: `bytesRead` в ответе `readNewLines`.
- `test/e2e/subagent-tree.spec.ts` — запуск и агенты на Canvas, журнал и task-notification их кончают; дерево временного `WORFY_CLAUDE_HOME` не меняется (`expectUntouched`).
- Сначала падающие: unit — 7 красных, contract — 6 красных до кода. e2e писался после кода; красный на старом коде — по рассуждению (агентов запуска старый reader не отдавал).
- Без каталога `workflows/` дерево прежнее: прежние test-ы деревьев Session 5555, 7777, 9999 не менялись и зелёные.

**Фикстура** — `test/fixtures/claude-home/projects/-Users-test-projects-workflow/` (Session 1212), состав — в `test/fixtures/claude-home/README.md`.

**Время первого показа на Auction** (вручную, только чтение, `SubagentReader.session` + `buildSubagentTree` под Node вне приложения): самая большая Session с workflow-скриптами (`auction-deepening-4`, 29 каталогов запусков, 633 агента запусков и 39 обычных, 628 MB) — 995 мс первое чтение, 27 мс и 702 байта повторное. Session `moderation` (6 запусков, 109 файлов, 55 MB) — 117 мс, повторное 5 мс и 116 байт. Байты повторного чтения — только транскрипты и журналы с курсора: кроме них каждый опрос заново читает все `meta.json` (`readMeta`, `src/main/claude-home/subagents.ts:251`) — на `auction-deepening-4` около 672 маленьких файлов каждые 2 с, пока бежит Subagent (`POLL_MS`, `src/renderer/claude-home/subagents.ts:23`). В окне приложения на этих Session не мерилось: прямой запуск worfy на настоящем `~/.claude` запрещён брифом.

**Снимки дерева** (e2e на фикстуре, fake-агент): [светлая](../evidence/17-workflow-tree-light.png), [тёмная](../evidence/17-workflow-tree-dark.png). Сверено с F-SPEC (строка 6: дерево с линиями, monospace для имён и моделей, компактные чипы статуса, рамки 1px): запись запуска — тот же `SubagentNode`, расхождений нет.

Не проверено: «Во время Wave в Autopilot агенты workflow-скрипта видны на Canvas». Настоящую Wave Autopilot-а вести нельзя (fake-агент, запись в `~/.claude` запрещена); вместо неё — снимок e2e выше на фикстуре того же формата.

**Бейджи PR и CI** (вручную, 2026-10-07): открытый PR эпика один — [PR #73](https://github.com/IDSAD-XL/worfy/pull/73) этого Ticket-а (предполёт волны: «PR открыто: 0» до него). launchApp с Project = worktree тикета, `epic-status` из `~/.claude/bin` по ссылке во временном Claude home.
- gh с `GH_TOKEN` аккаунта IDSAD-XL: на Ticket-е 17 — `PR #73`, `OPEN`, `CI running`; `gh pr view 73 --json state,statusCheckRollup` — `OPEN`, `check` `IN_PROGRESS`, `full-macos` `SKIPPED`. Совпадает. Снимки: [светлая](../evidence/17-badges-pr73-light.png), [тёмная](../evidence/17-badges-pr73-dark.png), [Ticket 17 крупно](../evidence/17-badge-ticket17-light.png).
- gh так, как его запускает приложение без `WORFY_GH` (из login shell, глобальный аккаунт gh — Oleksii-O-Atakama): на Ticket-е 17 — «gh unavailable» вместо PR #73; `gh pr list` из login shell отвечает «Could not resolve to a Repository with the name 'IDSAD-XL/worfy'». [Снимок](../evidence/17-badges-login-shell-gh-light.png).

Не проверено: «Для каждого открытого PR этого Epic-а бейджи PR и CI на Ticket-е совпадают с `gh pr view`». Совпадение есть только с gh от `GH_TOKEN` аккаунта IDSAD-XL, которого приложение не берёт. Так, как приложение зовёт gh у владельца (`src/main/ipc/checks.ts:35-38`, окружение login shell, глобальный аккаунт), бейджи — «gh unavailable»: расхождение найдено, но Ticket-ом не стало — решает владелец (кандидат ниже). Проверить заново на живых PR после исправления аккаунта.

Кандидаты в Ticket-ы (не заведены — по брифу волны):
- Бейджи PR и CI worfy пусты («gh unavailable») у владельца: приложение зовёт gh от глобального аккаунта, которому репозиторий IDSAD-XL/worfy не виден. Код — `src/main/ipc/checks.ts:35-38`. Нужен аккаунт gh на Project (например, `github.account` Profile-а → `GH_TOKEN=$(gh auth token -u …)` для этого Project-а). Это уже запланировано на этап E3: `spec.md:171`, раздел «Не в этом Epic-е», и ADR-0020, раздел «Последствия». Владельцу решить, оставить на E3 или поднять в `worfy-daily`.
