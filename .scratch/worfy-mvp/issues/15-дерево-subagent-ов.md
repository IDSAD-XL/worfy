# 15 — Дерево Subagent-ов у Сессии: тип, модель, статус, итог; сделанные сворачиваются

Type: task
Status: blocked — blocked by 14
Blocked by: 14
Source: [CONTEXT.md](../../../CONTEXT.md), термин «Subagent»; [BRIEF.md](../../../docs/design/BRIEF.md), Screen 1 пункт 2 и Screen 2 «Subagent tree»; «Итог» тикета 09

## Что делаем

- `src/shared/transcript/subagents.ts` — чистая функция: по событиям Сессии и файлам
  `subagents/agent-<id>.meta.json` строит дерево Subagent-ов. Узел дерева: `agentId`, имя,
  `subagent_type`, модель, описание, статус (`running`, `done`, `error`), время старта и
  длительность, первая строка итога (у reviewer-а это `VERIFIED` или `REJECTED`). Вложенные
  Subagent-ы — дети своего родителя (`spawnDepth`). Связь запуска с файлом — через `tool_use` id и
  `toolUseResult.agentId`, завершение фонового — через task-notification.
- Работает для обоих источников: живой Сессии worfy (события `subagent` из 07 плюс те же файлы) и
  внешней Сессии.
- На Холсте Узлы Subagent-ов стоят справа от своей Сессии, рёбра дерева
  (`edges/subagents.ts`). Сделанные сворачиваются в строку «N done» под родителем; раскрываются
  щелчком. Щелчок по Subagent-у открывает его транскрипт в Session view, только для чтения.
- Правая панель Session view: `rail/SubagentsRail.tsx` — то же дерево списком со статусами.
- Положение Узлов Subagent-ов автоматическое; ручной сдвиг сохраняется, как у Тикетов.

## Готово, когда

- [ ] Fixture с тремя Subagent-ами, один вложенный, один фоновый: дерево совпадает с ожиданием (тип, модель, статус, итог).
- [ ] Subagent, ещё работающий, показан `running` с идущим временем; после task-notification — `done` и сворачивается.
- [ ] Reviewer с итогом `REJECTED` показан с этим словом на Узле.
- [ ] Щелчок открывает транскрипт Subagent-а только для чтения.
- [ ] Узел Subagent-а появляется на Холсте ≤ 500 мс после события `subagent` (fake-агент; e2e мерит от записи события до появления Узла).
- [ ] Сессия Auction с 20+ Subagent-ами: дерево построено и показано ≤ 1 с после открытия Сессии (число в «Итог»).

## Тесты

- `test/unit/subagents.test.ts` — построение дерева по fixtures 09 и по событиям fake-агента (новый).
- `test/e2e/subagent-tree.spec.ts` — Узлы, сворачивание, переход в транскрипт (новый).
- Сначала падающий test: `subagents.test.ts` на вложенного Subagent-а.

## Где в коде

- `src/shared/transcript/subagents.ts`
- `src/renderer/canvas/nodes/SubagentNode.tsx`
- `src/renderer/canvas/edges/subagents.ts`
- `src/renderer/session/rail/SubagentsRail.tsx`
