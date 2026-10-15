# 25 — Окно Subagent-а: стрелка «назад» к родительской Session; в палитре — «Go to Orchestrator»

Type: task
Status: claimed — 2026-10-15
Branch: worfy-polish/25
Blocked by: —
Source: слово владельца 2026-10-15 (через Orchestrator-а): «Из окна Session Orchestrator-а можно
перейти в окно subagent-а, а вернуться обратно непонятно. Нужно: в окне subagent-а — стрелка „назад“ к
родительской Session (Orchestrator-у); в быстрое меню — пункт „Go to Orchestrator“».

## Что происходит

**Как открывается Subagent.** Это тот же Session view, другой режим, не вкладка и не отдельное окно.
Состояние навигации — одна запись `opened` (`src/renderer/session/navigation.ts:8-24`): `nodeId`
Session-а, `projectId` и `external: { sessionId, agentId }`. Истории переходов нет: `openSession`
(`:31-33`) просто заменяет запись.

- Из rail Session view: строка Subagent-а → `openSession({ nodeId, projectId, external: { sessionId,
  agentId } })` (`src/renderer/session/rail/SubagentsRail.tsx:100-103`). `nodeId` — Узел Session-а,
  которую показывал view.
- С Canvas: двойной клик по Узлу Subagent-а → то же, `nodeId` — Узел его Session-а
  (`src/renderer/canvas/nodes/SubagentNode.tsx:74`).
- Окно Subagent-а — `ExternalSessionPanel` с `agentId` (`src/renderer/session/ExternalSessionPanel.tsx:43-110`).
  В шапке — «Subagent <имя>», статус и строка `<тип> · <модель> · of <Session>` (`:58-62`, `:71-76`).
  «of <Session>» — просто текст, не ссылка. Rail не рисуется (`:106`).
- Вернуться можно только через Canvas или переключатель Canvas / Session в toolbar: он снова
  показывает ту же запись `opened`, то есть тот же Subagent.

**Orchestrator в палитре.** В группе `Go to` у Orchestrator-а уже есть строка: заголовок — имя
Session-а, `detail` — «Orchestrator»; выбор центрирует его Узел на Canvas
(`src/renderer/palette/commands.ts:289-301`). Открыть его Session view из палитры нельзя. Session view
без `opened` сам показывает Orchestrator активного Project-а и запускает его, если он не запущен
(`orchestrator.open`, `src/renderer/session/SessionView.tsx:39-53`; «Starting the Orchestrator…»,
`:244-250`).

## Что делаем

1. **Сначала красный unit test** (новый `test/unit/session-back.test.tsx`): окно Subagent-а, открытое
   из rail Orchestrator-а, имеет кнопку «Back to <Session>»; клик открывает Session view этого
   Orchestrator-а. На main кнопки нет — красный.
2. **Куда ведёт стрелка — рекомендация:** к родителю Subagent-а, а не по истории переходов.
   - Subagent первого уровня → его Session: живая Session worfy (Orchestrator или Узел Session) —
     `openSession({ nodeId, projectId })`; Session вне worfy или сохранённая без процесса — та же
     запись с `external: { sessionId }`.
   - Вложенный Subagent (`parentAgentId` не пуст) → окно родительского Subagent-а.
   - Открыт с Canvas — правило то же: родитель, а не Canvas.
   **Альтернатива:** история переходов (стек в `navigation.ts`): «назад» возвращает туда, откуда
   пришли, в том числе на Canvas; родитель — отдельной ссылкой «of <Session>». Владелец 2026-10-15 выбрал рекомендацию.
3. **Вид.** Кнопка-стрелка слева от заголовка в шапке окна Subagent-а, подпись в подсказке и
   `aria-label`: «Back to <имя Session-а>»; текст «of <Session>» тоже становится ссылкой.
   Клавиша — ⌘[ (Ctrl+[ на Windows), если она свободна в окне; проверить и записать.
4. **«Go to Orchestrator» в палитре.** Предложение по соседним строкам `Go to`: группа `Go to`,
   заголовок `Orchestrator`, `detail` — `Session view`, ключи поиска `orchestrator`, `go to
   orchestrator`. Выбор открывает Session view Orchestrator-а активного Project-а (новая функция
   `openOrchestrator()` в `navigation.ts`: `view: 'session'`, `opened: null`). Строка Узла
   Orchestrator-а (центрирует Canvas) остаётся.
5. **Если Orchestrator-а нет или он не запущен — рекомендация:** строка есть всегда, когда есть
   Project, и делает то же, что переключатель Session: Session view запускает Orchestrator
   («Starting the Orchestrator…»). **Альтернатива:** строка неактивна с причиной «Orchestrator is
   not running». Без Project-а строки нет (как у всех `Go to`). Владелец 2026-10-15 выбрал рекомендацию.
6. **Снимки** окна Subagent-а с кнопкой (из rail и с Canvas) и палитры со строкой — светлая и тёмная
   тема, `.scratch/worfy-polish/evidence/25-*.png`.

## Готово, когда

- [x] Test пункта 1 красный на main и зелёный с правкой; test-ы на вложенный Subagent и Session вне
      worfy.
- [x] Unit test палитры: строка «Orchestrator» в `Go to` есть при Project-е, выбор вызывает
      `openOrchestrator()`; без Project-а строки нет.
- [x] e2e: Orchestrator → Subagent из rail → «назад» → Session view Orchestrator-а (новый spec).
- [x] Снимки в светлой и тёмной теме — ссылки в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- Unit — `test/unit/session-back.test.tsx` (новый), `test/unit/palette-commands.test.tsx`.
- e2e — `test/e2e/session-back.spec.ts` (новый), fake agent; отдельный файл, чтобы не пересекаться с
  Ticket-ом 21 по `subagent-tree.spec.ts`.

## Где в коде

- `src/renderer/session/navigation.ts`
- `src/renderer/session/ExternalSessionPanel.tsx`
- `src/renderer/palette/commands.ts`
- `test/unit/session-back.test.tsx`
- `test/unit/palette-commands.test.tsx`
- `test/e2e/session-back.spec.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/renderer/session/SessionView.tsx`, `src/renderer/session/rail/SubagentsRail.tsx`,
`src/renderer/canvas/nodes/SubagentNode.tsx`, `src/renderer/palette/CommandPalette.tsx`,
`src/shared/transcript/subagents.ts`, `test/e2e/subagent-tree.spec.ts`.

## Вне скоупа

- Общая история «назад / вперёд» для всех видов — только если владелец выберет альтернативу пункта 2.
- Список Subagent-ов в rail — Ticket 21; текст строк палитры — Ticket 16.

## Итог

Сделано в ветке `worfy-polish/25`.

**Стрелка «назад» в окне Subagent-а** (`src/renderer/session/ExternalSessionPanel.tsx`, `navigation.ts`).
- Кнопка-стрелка слева от заголовка, `aria-label` «Back to <имя>», подсказка «Back to <имя> (⌘[)» (Ctrl+[ вне macOS).
- Ведёт к родителю, а не по истории (выбор владельца в пункте 2): вложенный Subagent → окно родительского Subagent-а
  («Back to Subagent impl-09»); Subagent первого уровня → его Session. Session открывается живой, если worfy сейчас
  запускает её на этом Узле (view Orchestrator-а с этим `sessionId` и не `closed`, или запущенный Узел Session по
  `sessionId`/`sdkSessionId`), иначе — только чтение из транскрипта (`external: { sessionId }`). Чистые функции —
  `subagentParent` и `subagentSession` в `navigation.ts`.
- «of <Session>» в строке под заголовком — ссылка (цвет `--accent`, подчёркнута); всегда ведёт к Session, у вложенного тоже.
- Клавиша ⌘[ свободна: в меню приложения (`src/main/menu.ts`: роли editMenu, windowMenu, viewMenu, Settings ⌘,,
  Toggle Sidebar ⌘B, масштаб ⌥⌘0/=/-) и в обработчиках клавиш renderer-а `[` не занят; в окне Subagent-а нет поля
  ввода. Слушатель стоит только пока показан Session view (панель остаётся смонтированной под Canvas). Клавиша
  ловится и по месту (`code: BracketLeft`) — для раскладок, где там другая буква. Решено без владельца, подтвердить.
- Подпись берёт имя Session-а, как велит пункт 3, а не слово «Orchestrator»: у Orchestrator-а это его имя из
  транскрипта (ai-title или первый prompt). Решено без владельца, подтвердить.

**«Go to Orchestrator» в палитре** (`src/renderer/palette/commands.ts`): строка `go-to:orchestrator` в группе `Go to`,
заголовок `Orchestrator`, `detail` — `Session view`, ключи `orchestrator`, `go to orchestrator`; есть всегда, когда
есть Project (выбор владельца в пункте 5), без Project-а её нет. Выбор вызывает `openOrchestrator(projectId)`: сразу
`view: 'session'`, `opened: null` (Session view показывает Orchestrator Project-а), и вызов `orchestrator.open`.
Session view сам вызывает его только при монтировании и смене Project-а, поэтому без этого вызова Orchestrator,
который не стартовал или закрылся, оставался бы лежать (ревью, круг 1). main на `orchestrator.open` при живой или
стартующей Session ничего не меняет: второй вызов во время запуска ждёт тот же запуск (contract test
`test/contract/orchestrator.test.ts` «concurrent and later opens keep the Node and the Session»); закрытый или
не стартовавший запускает снова (там же, «a closed Orchestrator is started again…», «…the next open tries again»).
Отказ main — причина в строке палитры. Строка Узла Orchestrator-а (центрирует Canvas) осталась.

**Test-ы.**
- `test/unit/session-back.test.tsx` (новый): был красным на main (9 из 10 test-ов: нет кнопки, нет функций), зелёный
  с правкой. Покрывает: Orchestrator из rail → назад → его Session view; вложенный → родитель; ссылка «of» вложенного →
  Session; Session вне worfy → только чтение; запущенный Узел Session → живой, остановленный → только чтение; ⌘[ в Session
  view и не над Canvas, Ctrl+[ на macOS не срабатывает; у окна Session-а стрелки нет; `openOrchestrator`.
- `test/unit/palette-commands.test.tsx`: строка есть при Project-е (с Узлом Orchestrator-а и без), находится первой
  по «orchestrator» и «go to orchestrator», выбор даёт `{ view: 'session', opened: null }`; без Project-а строки нет.
- `test/e2e/session-back.spec.ts` (новый, fake agent): Orchestrator → impl-09 из rail → стрелка → Session view
  Orchestrator-а; scout → стрелка → impl-09 → ссылка «of» → Orchestrator; Canvas → impl-09 → ⌘[ → Orchestrator;
  палитра «go to orchestrator» из окна scout → Orchestrator.
- Session view с Orchestrator-ом в `error` → строка палитры → второй вызов `orchestrator.open` (`session-back.test.tsx`);
  окно Subagent-а закрытого Orchestrator-а → «назад» ведёт в транскрипт только для чтения.
- Mutation testing: `subagentParent` без ветки родителя — 3 test-а красные; «Orchestrator никогда не живой» — 2;
  `openOrchestrator` без вызова `orchestrator.open` — 3; без проверки `!== 'closed'` — 1.

**Снимки** (светлая и тёмная тема):
- окно Subagent-а, открытое из rail: [светлая](../evidence/25-subagent-from-rail-light.png), [тёмная](../evidence/25-subagent-from-rail-dark.png);
- окно Subagent-а, открытое с Canvas: [светлая](../evidence/25-subagent-from-canvas-light.png), [тёмная](../evidence/25-subagent-from-canvas-dark.png);
- палитра со строкой: [светлая](../evidence/25-palette-go-to-orchestrator-light.png), [тёмная](../evidence/25-palette-go-to-orchestrator-dark.png).
