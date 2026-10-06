# 27 — Блок состояния Orchestrator-а помещается в Node

Type: task
Status: blocked — blocked by 06, 07, 08, 09, 10
Blocked by: 06, 07, 08, 09, 10
Source: [spec.md](../spec.md), тема C; ручная проверка 2026-10-06, ночь — Ticket 33 worfy-mvp (`.scratch/worfy-mvp/issues/33-session-view-транскрипт-и-ввод.md:182`); HANDOFF, «Риски и долги»

## Что делаем

Блок состояния — четыре строки «— Этап / Сейчас / Дальше / Жду», которыми Orchestrator
заканчивает ход. Node Orchestrator-а показывает последний такой блок. В Node-е стандартного размера
360×200 (`ORCHESTRATOR_WIDTH` и `ORCHESTRATOR_HEIGHT`, `src/shared/ipc/orchestrator.ts:21-22`) блок
не помещается. Это `pre` с `overflow: auto` (`src/renderer/canvas/nodes/OrchestratorNode.tsx:50-55`):
scrollHeight 169 при clientHeight 148. Строка «— Жду:» — то, что Orchestrator ждёт от владельца, —
видна только после прокрутки внутри Node-а.

Правка — по F-SPEC, выбор в «Итог»:

- (а) Node выше. Размер задаётся только при создании Node-а (`src/main/agent/orchestrator.ts:373`),
  а уже сохранённый Node возвращается как есть (`:369`). Поэтому у Node-ов, сохранённых в Layout с
  высотой 200, размер нужно поменять отдельно;
- (б) каждая строка блока — одна строка с многоточием, полный текст — в `title` и в Session view;
- (в) мельче шрифт и отступы, если F-SPEC это допускает.

## Готово, когда

- [ ] Блок из четырёх строк по 90 символов на Node-е Orchestrator-а: строка «— Жду:» видна без прокрутки, у блока `scrollHeight ≤ clientHeight`. e2e с fake-агентом, который отвечает таким блоком.
- [ ] Если выбран вариант (а): Node Orchestrator-а, сохранённый в Layout с высотой 200, после перезапуска тоже показывает блок целиком. e2e с таким `layout.json` во временном `WORFY_DATA_DIR`.
- [ ] Снимки Node-а Orchestrator-а в светлой и тёмной теме сверены с F-SPEC.

## Тесты

- `test/e2e/orchestrator.spec.ts` — блок состояния на Node-е без прокрутки.
- `test/unit/orchestrator-node.test.tsx` — разметка блока: многоточие и `title`, если выбран вариант (б).
- Сначала падающий test: e2e находит у блока `scrollHeight > clientHeight`.

## Где в коде

Список покрывает все варианты. После выбора лишнее убирается.

- `src/renderer/canvas/nodes/OrchestratorNode.tsx`
- `src/shared/ipc/orchestrator.ts` (только вариант (а))
- `src/main/agent/orchestrator.ts` (только вариант (а))
- `test/unit/orchestrator-node.test.tsx`
- `test/e2e/orchestrator.spec.ts`
