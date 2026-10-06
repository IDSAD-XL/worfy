# 17 — Subagent-ы workflow-скриптов в дереве; бейджи PR и CI на живых PR

Type: task
Status: claimed — 2026-10-06
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

- [ ] ADR о показе Subagent-ов workflow-скриптов принят.
- [ ] Фикстура `<sessionId>/subagents/workflows/wf_x/agent-*.jsonl` с `journal.jsonl`: агенты появляются в дереве так, как решил ADR. Без каталога `workflows/` дерево такое же, как раньше.
- [ ] Повторное чтение изменившегося транскрипта wf-агента берёт только хвост: test проверяет счётчик прочитанных байт.
- [ ] (вручную) Время первого показа дерева Session с workflow на Auction — в «Итог».
- [ ] (вручную) Во время Wave в Autopilot агенты workflow-скрипта видны на Canvas. Снимок — в «Итог».
- [ ] (вручную) Для каждого открытого PR этого Epic-а бейджи PR и CI на Ticket-е совпадают с `gh pr view`. Расхождения стали Ticket-ами, снимки — в «Итог».
- [ ] Снимки дерева в светлой и тёмной теме сверены с F-SPEC.
- [ ] `~/.claude` только читается: дерево временного `WORFY_CLAUDE_HOME` после test-а не изменилось.

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
