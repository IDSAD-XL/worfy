# 27 — Блок состояния Orchestrator-а помещается в Node

Type: task
Status: done — 2026-10-06, [PR #60](https://github.com/IDSAD-XL/worfy/pull/60)
Blocked by: 06, 07, 08, 09, 10, 30
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

- [x] Блок из четырёх строк по 90 символов на Node-е Orchestrator-а: строка «— Жду:» видна без прокрутки, у блока `scrollHeight ≤ clientHeight`. e2e с fake-агентом, который отвечает таким блоком.
- [x] ~~Если выбран вариант (а): Node Orchestrator-а, сохранённый в Layout с высотой 200, после перезапуска тоже показывает блок целиком. e2e с таким `layout.json` во временном `WORFY_DATA_DIR`.~~
  Не применимо: выбран вариант (б), размер Node-а не менялся (см. «Итог»).
- [x] Снимки Node-а Orchestrator-а в светлой и тёмной теме сверены с F-SPEC.

## Тесты

- `test/e2e/orchestrator.spec.ts` — блок состояния на Node-е без прокрутки.
- `test/unit/orchestrator-node.test.tsx` — разметка блока: многоточие и `title`, если выбран вариант (б).
- Сначала падающий test: e2e находит у блока `scrollHeight > clientHeight`.

## Где в коде

Выбран вариант (б): файлы варианта (а) — `src/shared/ipc/orchestrator.ts` и `src/main/agent/orchestrator.ts` — убраны из списка.

- `src/renderer/canvas/nodes/OrchestratorNode.tsx`
- `test/unit/orchestrator-node.test.tsx`
- `test/e2e/orchestrator.spec.ts`

## Итог

### Выбор варианта — решено без владельца, подтвердить

Выбран вариант (б): каждая строка блока — одна строка Node-а, длинная строка обрезается
многоточием (`white-space: pre`, `overflow: hidden`, `text-overflow: ellipsis`). Полный текст
строки — в `title` её строки и в Session view. Размер Node-а остался 360×200.

Почему не (а) и не (в):

- (а) Node выше помещает блок, только пока строки короткие. Четыре строки по 90 символов при
  шрифте 12 px переносятся на две строки каждая (в Node входит около 46 знаков), это восемь строк;
  строки длиннее снова потребуют прокрутки. Ещё (а) меняет высоту Node-ов, уже сохранённых в
  Layout, и сдвигает колонку рамок Epic-ов (ADR-0032: полоса колонки считается по Node-ам на
  плоскости).
- (в) Мельче шрифт: F-SPEC отводит 11 px подписям (captions), а meta — 12 px. При 11 px в строку
  Node-а входит около 50 знаков: строки по 90 символов всё равно переносятся на две, и восемь строк
  помещаются только при межстрочном интервале меньше нынешних 17 px, впритык. Строки длиннее
  снова потребуют прокрутки. Расчёт, не измерено.

Цена (б): на Node-е по умолчанию видно около 46 первых знаков каждой строки. Чтобы прочитать
строку целиком, нужно навести на неё курсор, расширить Node (resize) или открыть Session view.
Текст в DOM остался дословным: копирование блока даёт четыре строки как написано.

### Воспроизведение до правки

Новый e2e в `test/e2e/orchestrator.spec.ts` («a status block of four 90-character lines fits the
Orchestrator Node…») на коде `origin/main` e08017b был красным: у блока `scrollHeight` 186 при
`clientHeight` 148. Fake-агент отвечает блоком из четырёх строк по 90 символов; скрипт fake-агента
test пишет сам во временный каталог (`WORFY_AGENT_SCRIPTS`).

### После правки

Тот же e2e зелёный: `scrollHeight ≤ clientHeight`, текст «— Жду:» лежит внутри блока и Node-а,
у каждой из четырёх строк `title` — вся строка. Unit test в `test/unit/orchestrator-node.test.tsx`
проверяет разметку: строка на строку, многоточие, `title`, дословный `textContent` блока.

Снимки Node-а с этим блоком (сделаны тем же e2e), сверены с F-SPEC — поверхность Node-а,
моноширинный шрифт для данных, 12 px:
[светлая](../evidence/27-orchestrator-long-block-light.png),
[тёмная](../evidence/27-orchestrator-long-block-dark.png). Все четыре строки видны, каждая
заканчивается многоточием, строка «— Жду:» — последняя, без прокрутки.

### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (проверка M8 второго круга ручных проверок). Stable copy из 5060858
(pid 74430, CDP 9351) после прогона Autopilot `2026-10-07T00-32-09-524Z-66ddaf` (кончился
`run-stopped` в 04:38:34Z). Node Orchestrator-а был за краем Canvas — сдвинут прокруткой.

- Контроль: кнопка «Transcript» у Subagent-а impl-09 переключила Session view на него, потом возврат
  на Canvas. Значит, до щелчка Session view не показывал Orchestrator.
- Один двойной щелчок мышью ОС (CGEvent) по заголовку «Orchestrator» (`elementFromPoint` подтвердил
  цель) открыл Session view «Orchestrator · CanvasForAI · idle», Canvas скрыт.
- Последний ответ Orchestrator-а (04:38:33Z) уже кончался блоком состояния из 4 строк, поэтому новый
  ход не отправлялся.
- На Node-е 4 строки блока: `textContent` и `title` дословно равны тексту ответа в транскрипте
  `f6ab7045-416c-471a-a78d-433567aefa5a.jsonl`. В Session view тот же текст, `6df9791` отрисован как code.
- Блок на Node-е: `scrollHeight` 148 = `clientHeight` 148, `scrollTop` 0, строка «— Жду:» в видимой
  области. Три длинные строки обрезаны «…» (вариант (б) Ticket-а 27 `worfy-daily`), полный текст —
  в `title`.
- Попутно: пунктирный Edge Binding идёт поверх текста Node-а Orchestrator-а, и без выделения тоже.
  Не разбиралось.
- Вердикт: проверено.
- Снимки: Session view — [33-orchestrator-session-view.png](../../worfy-mvp/evidence/33-orchestrator-session-view.png), блок
  на Node-е — [33-orchestrator-node-block.png](../../worfy-mvp/evidence/33-orchestrator-node-block.png). Остальное — в
  scratchpad Session Orchestrator-а: `M8-before-dblclick.png`, `M8-node-window.png`, `M8-block.json`.
