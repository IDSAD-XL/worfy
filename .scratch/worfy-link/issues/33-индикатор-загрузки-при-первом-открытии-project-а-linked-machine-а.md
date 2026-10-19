# 33 — Индикатор загрузки при первом открытии Project-а Linked machine-а

Type: task
Status: open
Blocked by: —
Source: отзыв владельца 2026-10-19 после ручной проверки связи Mac и Windows-ПК ([Ticket 16](16-приёмка-epic-а-worfy-link.md),
«Итог»): при первом открытии Project-а Mac-а с Windows Canvas 15–20 с тормозил при сдвиге. Слова
владельца: 15–20 с — приемлемо. Цель — видимый ход загрузки и сдвиг Canvas без зависаний. Код
перечитан по main `9fa28aed`; причины ниже выведены из кода, профилем не проверены.

## Что происходит

- Окно на Linked machine-е зовёт main через `routedBridge` (`src/renderer/ipc.ts:139`). Каждый вызов
  канала Project-а — отдельный `linked.invoke` по связи (`machineBridge`, `ipc.ts:122-126`). Вызовы
  не собираются в пакет.
- Canvas ничего не рисует, пока не пришли ответы `layout.get` и камеры: `ProjectCanvas` возвращает
  `null` (`src/renderer/canvas/Canvas.tsx:594-603`). Индикатора нет — пустое место.
- Что грузится при первом открытии:
  - `workflow.open` (`src/renderer/workflow/useWorkflow.ts:84`) отдаёт модель целиком: все Epic-и и
    Ticket-ы. Каждая следующая дельта проходит `applyWorkflowDelta` (`useWorkflow.ts:30-45`) и даёт
    новую модель.
  - `claudeHome.sessions` (`src/renderer/claude-home/useClaudeHome.ts:113`) отдаёт всю историю Session
    Project-а.
  - Transcript-ы читаются кусками по 1 МБ: `CHUNK_BYTES` (`useClaudeHome.ts:34`), до 1000 кусков на
    файл (`:263-264`). У Node Session — свой цикл чтения (`src/renderer/canvas/nodes/SessionNode.tsx:177`,
    `usePastAnswer` на `:207`).
  - ELK раскладывает Epic-и в Web Worker (`src/renderer/canvas/elk/client.ts:49`). Каждый ответ —
    отдельный `useElkAnswers.setState` (`client.ts:98`).
  - На каждое такое обновление `useEpicNodes` заново строит Node-ы всех Epic-ов: `buildEpicNodes` в
    `useMemo` зависит от `answers` (`src/renderer/canvas/sources/epics.ts:529-533`).
- Самая вероятная причина зависаний сдвига: N Epic-ов дают N отдельных обновлений хранилища, и каждое
  перестраивает все Node-ы Epic-ов в главном потоке окна. Добавляются дельты workflow, которые
  приходят в это же время. Это вывод из чтения кода, замера нет.
- e2e уже поднимает две связанные копии worfy на одном Mac: `launchLinkedPair`
  (`test/e2e/helpers.ts:665`), сценарии `test/e2e/linked-*.spec.ts`.

## Что делаем

1. **Замер.** Профиль первого открытия Project-а Linked machine-а:
   - две копии worfy на одном Mac через `launchLinkedPair`;
   - у копии B — Project со многими Epic-ами и Ticket-ами (от 20 Epic-ов и 300 Ticket-ов, fixture) и
     историей Session;
   - копия A открывает его Canvas и во время загрузки двигает Canvas.

   Снять:
   - Performance profile renderer-а A (Chrome DevTools Protocol через Playwright, `Tracing` или
     `Profiler`);
   - время каждого вызова по связи (`linked.invoke`, по каналу);
   - число обновлений `useElkAnswers` и `useWorkflowStore`;
   - длинные задачи главного потока (> 50 мс) во время сдвига.

   В «Итог» — таблица: шаг, время, доля главного потока. Названы настоящие тяжёлые шаги. Если
   главная причина — не ответы ELK, пункт 3 идёт по профилю, а не по этому списку.
2. **Индикатор хода загрузки** поверх Canvas, пока загрузка не кончилась. Строка вида «Loading
   workflow… · Laying out Epics 7/20 · Reading Sessions history», с известными итогами:
   - workflow загружен — ответ `workflow.open`;
   - Epic-и разложены N из M — по открытым запросам ELK в `client.ts` (`latest` и ответы);
   - история Session загружена — ответ `claudeHome.sessions`.

   До ответа `layout.get` и камеры на месте пустого Canvas — та же строка, а не пустота. Когда всё
   загружено, строка исчезает. Индикатор — у любого окна, не только на Linked machine-е: на своей
   Machine он мелькнёт коротко или не появится вовсе (порог показа — например 300 мс, в «Итог»).
   - Хранилище toast-ов `worfy-ui` 16 используется, только если оно уже влито. Иначе — свой overlay
     Canvas (`src/renderer/canvas/overlays/LoadingProgress.tsx`, новый; overlay-и собирает glob
     `src/renderer/canvas/extensions.ts:84`).
   - Доступность: `role="status"`, `aria-live="polite"`; число Epic-ов не объявляется на каждый шаг —
     только начало и конец.
3. **Дешёвые правки по профилю.** Например: ответы ELK собираются и пишутся одним `setState` на кадр
   (`requestAnimationFrame`), а не по одному на Epic. Каждая правка — с замером до и после в «Итог».
   Правка, которой профиль не подтвердил, не делается.

4. **`claudeHome.subagents` больше предела связи** (заметка 2026-10-20). В log-е Stable `e61cb1fe`
   2026-10-19, с Windows-ПК на связи, дважды: «[link] the answer to claudeHome.subagents is 18390446
   bytes, more than the 16777216 a link connection carries; Machine 83a67a58… gets an error instead».
   Предел — `LINK_MAX_PAYLOAD` = 16 МБ (`src/main/link/messages.ts:29`), строка log-а —
   `src/main/link/connection.ts:106`. Канал `claudeHome.subagents` (`src/shared/ipc/claude-home.ts:126`,
   обработчик `src/main/ipc/claude-home.ts:191`) отдаёт сигналы всех Subagent-ов Session одним ответом,
   без предела размера. У Session с большим деревом Subagent-ов Linked machine получает ошибку вместо
   дерева. Правка: ответ по страницам или с пределом размера (сигналы урезаны, флаг «есть ещё»), чтобы
   один ответ не выходил за предел связи. Если эта правка больше остального Ticket-а — вынести в
   отдельный Ticket `worfy-link`, а здесь оставить ссылку.

**Не входит:** ускорить загрузку до меньше 15–20 с — владелец это время принял. Сжатие или пакеты
вызовов по связи — только если профиль покажет, что время уходит туда, и отдельным Ticket-ом.

## Готово, когда

- [ ] «Итог» — профиль первого открытия: тяжёлые шаги по времени, число обновлений хранилищ, длинные
      задачи во время сдвига; файл профиля приложен (или путь к нему в evidence).
- [ ] Индикатор виден с первого кадра открытия Project-а Linked machine-а до конца загрузки; счётчик
      Epic-ов растёт до M/M; после конца строки нет (e2e на `launchLinkedPair`).
- [ ] До ответа `layout.get` на месте Canvas — строка загрузки, а не пустота (unit или e2e).
- [ ] На своей Machine с маленьким Project-ом индикатор не мигает (порог показа; unit с fake timers).
- [ ] Каждая правка пункта 3: замер до и после на той же fixture; во время сдвига в загрузке нет
      длинных задач главного потока больше порога из «Итог» (например 100 мс) — или «Итог» говорит,
      какие остались и почему.
- [ ] Если ответы ELK собираются по кадру — unit `test/unit/elk-client.test.tsx`: M ответов за кадр
      дают одно обновление `useElkAnswers`; мутант «по одному на ответ» — красный.
- [ ] Пункт 4: contract test — Session с деревом Subagent-ов, чей ответ `claudeHome.subagents` больше
      `LINK_MAX_PAYLOAD`, по связи даёт дерево (по страницам или урезанное с флагом), а не ошибку; мутант
      «весь ответ одним куском» — красный.
- [ ] Снимки индикатора в светлой и тёмной теме; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0;
      gate full — exit 0 и строка `[gate] зелено (full)` (оркестратор перед merge).

## Тесты

- e2e `test/e2e/linked-opening.spec.ts` (новый): две копии, Project с fixture многих Epic-ов,
  индикатор от начала до конца; замер длинных задач во время сдвига — в отчёт, не в проверку, если он
  нестабилен на CI-нагрузке (решение — в «Итог»).
- Unit `test/unit/loading-progress.test.tsx` (новый): итоги из хранилищ, порог показа, конец.
- Unit `test/unit/elk-client.test.tsx` — если меняется запись ответов ELK.
- Сначала падающий: e2e, где индикатор ждут до ответа `layout.get`, — красный на main (`null`).

## Где в коде

- `src/renderer/canvas/Canvas.tsx`
- `src/renderer/canvas/overlays/LoadingProgress.tsx` (новый)
- `src/renderer/canvas/elk/client.ts`
- `src/renderer/canvas/sources/epics.ts`
- `src/renderer/workflow/useWorkflow.ts`
- `src/renderer/claude-home/useClaudeHome.ts`
- `src/main/ipc/claude-home.ts` (`:191`, `claudeHome.subagents`), `src/shared/ipc/claude-home.ts` (`:126`) — пункт 4
- `test/fixtures/` — fixture Project-а со многими Epic-ами (новая)
- `test/unit/loading-progress.test.tsx` (новый)
- `test/unit/elk-client.test.tsx`
- `test/e2e/linked-opening.spec.ts` (новый)

Только читать: `test/e2e/helpers.ts` (`launchLinkedPair`), `src/renderer/ipc.ts`.

## Итог

Заполняется при закрытии.
