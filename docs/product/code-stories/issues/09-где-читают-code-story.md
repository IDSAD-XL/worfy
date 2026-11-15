# 09 — Где владелец читает Code story и задаёт вопрос

Type: grilling
Status: done 2026-11-15T18:49Z
Blocked by: 08
Source: [map.md](../map.md), Not yet specified

## Question

Где владелец открывает Code story и выделяет строку для вопроса: свой вид worfy (как Run history), Card на Canvas-е
рядом с рамкой Epic-а, файл на GitHub с телефона? Откуда worfy зовёт к чтению?

## Comments

- 2026-11-15: условие владельца из Q13 ([Ticket 03](03-единица-code-story.md), Comments): пока story собирается, человек
  не видит отдельной Session, только progress bar. Прототип для этого вопроса —
  [prototype-code-story-worfy-mcp-live.html](../prototype-code-story-worfy-mcp-live.html).

## Answer

Владелец 2026-11-15, раунд 5: «со всем согласен».

- Q20, невидимо: сборка story по кнопке и ответ на вопрос к строке идут без Session Node на Canvas-е и без своего окна.
  На месте кнопки — progress bar; ответ появляется рядом со строкой в самой story. Так уже работает запрос списка
  MCP-серверов (`worfy-mcp-live` 14, PR #1877). Агент Orchestrator-а, который пишет окончательную story Epic-а, виден
  как обычный его Subagent.
- Q21, где открывается: свой вид на всю основную область окна, как Run history; Esc — назад на Canvas. Входы: «Story»
  на рамке Epic-а и на карточке Ticket-а, «Code story» у PR в виде Pull requests, toast «Story Epic-а готова» с
  «Открыть» — один на Epic. С телефона — файл story на GitHub в режиме Full.

Отклонённые альтернативы: Card на Canvas-е рядом с рамкой Epic-а (Card не читает файлы, story пришлось бы вшивать в
HTML; Card живёт на одной машине); только файл на GitHub (нет вопроса к строке).

Revisit when: Epic о телефоне (направление 2) дойдёт до spec-а.
