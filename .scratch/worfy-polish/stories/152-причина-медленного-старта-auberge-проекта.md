# Code story — worfy-polish 152: причина медленного старта Auberge-размерного Project-а: замер и починка до конца карантина 2026-12-09

Kind: pr · Epic: worfy-polish · Ticket: 152 · PR: - · Language: ru

## 1. Что было не так

macOS e2e test старта Project-а из 42 Epic-ов и 682 Ticket-ов (`N`) был в карантине: на медленных машинах runner-а
`N` выходил за потолок 7300 ms. Замер на runner-е (CPU profile, Long Animation Frames, временно в ветке) показал, что
треть `N` — два полных повторных рендера всех карточек Canvas-а (831 и 1080 ms из 5511 ms): ответы, пришедшие после
первого кадра (имена Stage-ей Pipeline-а, репозитории Project-а, ответ ELK с теми же местами), давали новые объекты
Node-ов при той же раскладке. Один commit или смена образа runner-а, после которых старт стал медленнее, в 108 job-ах
main не найдены: разброс `N` (1814–7534 ms) — между машинами runner-а. Предел `min(7300, max(3000, 6 × R))` в 52 из 108
job-ов упирался в потолок, то есть решала скорость машины, а не замеренная база `R`.

- Требование: [Что происходит](../issues/152-причина-медленного-старта-auberge-проекта.md#что-происходит)

## 2. Та же раскладка — те же объекты Node-ов

Code: `src/renderer/canvas/sources/epics.ts:588-595` · key lines: 591, 592

```ts
      // New inputs that lay the frame out as before — the Pipeline's Stage names or the Project's repositories coming
      // after the first frame, an answer of ELK with the places already shown — keep the Epic's Node objects, so React
      // Flow draws none of its cards again (worfy-polish ticket 152: each such answer drew every card on screen anew).
      if (entry !== undefined && sameFrame(entry, inputs, sameTickets) && entry.reserve === reserve && sameLayout(entry.layout, epicLayout)) {
        entry = { ...entry, inputs, request }
        cache.set(key, entry)
        return { epic, saved, entry }
      }
```

- Что делает: когда новые входы Epic-а (новые `cards`, новый ответ ELK) дают ту же раскладку рамки — те же Ticket-ы,
  сохранённое, свёрнутость, `reserve` и `layout`, — запись кэша получает новые входы, но прежние объекты Node-ов.
  React Flow сравнивает Node-ы по ссылке и не рисует карточки заново.
- Почему здесь: замер назвал `buildEpicNodes` источником новых объектов; Ticket велит чинить то, что назвал замер
  («Где в коде»: `src/renderer/canvas/`).
- Без него: каждый поздний ответ рисует все 682 карточки заново, на runner-е это 0.8–1.1 s на ответ.
- Требование: [Что строить, п. 3](../issues/152-причина-медленного-старта-auberge-проекта.md#что-строить)
- Риски и пробелы test-ов: раскладка сравнивается через `JSON.stringify` — это стоит одного прохода по данным рамки
  на ответ; данные Node-ов, не зависящие от раскладки и `cards`, должны оставаться в `sameFrame`, иначе карточка
  покажет старое. Test-ы — шаг 6.

## 3. Слоты карточки не рисуются с карточкой

Code: `src/renderer/canvas/nodes/TicketNode.tsx:159-159` · key lines: 159

```tsx
  const subject = useMemo<SlotSubject>(() => ({ kind: 'ticket', projectId, root, ticket }), [projectId, root, ticket])
```

- Что делает: `subject` слотов (badges и actions Ticket-а) — один объект, пока тот же Ticket; слоты вынесены в
  `memo`-компонент `TicketSlots` (`TicketNode.tsx:127`) и рисуются, только когда меняется `subject` или фокус.
- Почему здесь: замер показал рендер слотов в каждом рендере карточки; причина новой ссылки — литерал объекта в
  рендере.
- Без него: Stepper карточки получает Stage Pipeline-а — и вместе с ним рисуются все badges и actions.
- Требование: [Что строить, п. 3](../issues/152-причина-медленного-старта-auberge-проекта.md#что-строить)
- Риски и пробелы test-ов: слот, который читает что-то помимо `subject` из props карточки, теперь не увидит его
  смены; сейчас слоты читают свои store-ы сами (комментарий над `TicketSlots`).

## 4. Ветки в работе — один раз на список Ticket-ов

Code: `src/renderer/canvas/badges/use-checks.ts:165-176` · key lines: 168, 171, 176

```ts
export function branchesInWork(tickets: readonly Ticket[]): readonly string[] {
  // Every card's Open PR asks with the same list of the workflow model: one read per list, not one per card
  // (worfy-polish ticket 152: 682 Tickets on 155 cards cost 187 ms of the start on the macOS runner).
  const known = branchesOfList.get(tickets)
  if (known !== undefined) return known
  const found = readBranchesInWork(tickets)
  branchesOfList.set(tickets, found)
  return found
}

/** The answers of branchesInWork, by the list of Tickets they were read from; a list nobody holds goes with it. */
const branchesOfList = new WeakMap<readonly Ticket[], readonly string[]>()
```

- Что делает: `branchesInWork` запоминает ответ по самому массиву Ticket-ов (`WeakMap`); все карточки спрашивают с
  одним массивом модели workflow и получают один ответ.
- Почему здесь: замер — 187 ms на 682 Ticket-ах, по проходу на каждую карточку.
- Без него: стоимость растёт как число карточек × число Ticket-ов.
- Требование: [Что строить, п. 3](../issues/152-причина-медленного-старта-auberge-проекта.md#что-строить)
- Риски и пробелы test-ов: ответ теперь общий и `readonly`; вызывающий, который изменит массив, испортит его всем.
  Сейчас вызывающие только читают и копируют (`[...]` в `fetchChecks`).

## 5. Запись раскладки ждёт и `settled`

Code: `src/renderer/canvas/arrangement-record.ts:255-257` · key lines: 257

```ts
  // The build of this render set the state; an answer of ELK that leaves every frame where it was keeps the Nodes
  // (sources/epics.ts) and settles the frames all the same, so the state's own `settled` runs the effect too.
  const settled = arrangements.get(projectId)?.settled
```

- Что делает: эффект записи первого открытия запускается и тогда, когда рамки улеглись (`settled`), а Node-ы те же;
  `settled` добавлен в deps эффекта (`arrangement-record.ts:294`).
- Почему здесь: шаг 2 оставляет Node-ы прежними при ответе ELK с теми же местами, а эффект знал только смену `nodes`.
- Без него: запись первого открытия не пишется — CI push-а 4 был красным на
  `test/unit/epic-arrangement-record.test.tsx` и `test/e2e/arrange-by-epic.spec.ts:138`.
- Требование: [Итог, Починка](../issues/152-причина-медленного-старта-auberge-проекта.md#починка) — последствие шага 2, найдено CI.
- Риски и пробелы test-ов: другие эффекты, которые ждут смены `nodes` после ответа ELK, проверены только
  test-ами Canvas-а, отдельного поиска таких эффектов не было.

## 6. Test: новая `cards` при той же раскладке — тот же массив Node-ов

Code: `test/unit/epic-node-memo.test.tsx:178-186` · key lines: 183, 185

```tsx
  it('a new card context that changes no height keeps every Node object: React Flow draws nothing again', () => {
    const tickets = [ticket(1), ticket(2, { blockedNums: [1] }), ticket(3, { state: 'done', statusRaw: 'done' })]
    const projectId = 'memo-0000000b'
    // The same workflow model: only the context of the cards is new, as when main answers checks.repos.
    const read = model(tickets)
    const first = buildEpicNodes(projectId, '/repo', read, emptyLayout, {}, [], {}, undefined)
    const known = buildEpicNodes(projectId, '/repo', read, emptyLayout, {}, [], {}, { severalRepos: false, repoNames: ['repo'], reviewChips: {}, sideEffects: {} })
    expect(known).toBe(first)
  })
```

- Что делает: строит Node-ы дважды на одной модели, второй раз с контекстом карточек, как после `checks.repos`, и
  ждёт тот же массив. Соседний test (`epic-node-memo.test.tsx:166-176`) ждёт, что Pipeline и репозитории рисуют
  Stepper, но не слоты.
- Почему здесь: Ticket требует test на найденную причину, сначала красный.
- Без него: новый объект Node-а при той же раскладке ничем, кроме времени на runner-е, не виден.
- Требование: [Test-ы](../issues/152-причина-медленного-старта-auberge-проекта.md#test-ы)
- Риски и пробелы test-ов: на коде main — exit 1 (3 failed: слоты нарисованы 3 раза вместо 1, новый Node, новый
  массив), с починкой — exit 0.

## 7. Предел от замеренной базы: 5 × R

Code: `test/e2e/start-budget.ts:15-19` · key lines: 19

```ts
 * 2338 against 930 ms (2.51). 5 is above that 95th percentile, so the start before the fix would
 * have passed in 103 of the 108 jobs, and 5 × R reaches the ceiling only from R = 1460 ms: R, not
 * the ceiling, sets the budget in 83 of the 108 jobs (6 × R, the ratio before, did in 56).
 */
export const START_RATIO = 5
```

- Что делает: `START_RATIO` 6 → 5; формула та же, потолок 7300 ms и `START_MS` 3000 те же. 5 выше 95-го процентиля
  `N / R` (4.63) по 108 job-ам, потолок решает только при `R` ≥ 1460 ms — в 25 из 108 job-ов вместо 52.
- Почему здесь: Ticket (п. 4) требует предел от базы, замеренной на том же runner-е, с потолком 7300 ms сверху;
  `test/e2e/start-budget.ts` назван в «Где в коде».
- Без него: на половине машин предел — потолок, и test судит машину, а не старт.
- Требование: [Что строить, п. 4](../issues/152-причина-медленного-старта-auberge-проекта.md#что-строить)
- Риски и пробелы test-ов: после починки на runner-е — одна выборка (`N / R` 2.51); если `N / R` на медленной машине
  окажется выше 5, test покраснеет раньше потолка. `test/unit/e2e-start-budget.test.ts` проверяет 5, переход на
  потолок на 1460 ms и эту выборку.

## 8. Что сознательно не меняли

Вне файлов Ticket-а, хотя замер их видит: `pipeline.get` в main ждёт 11 вызовов `gh pr list` подряд (961–1342 ms,
`src/main/github/prs.ts`), `useLayoutEffect` без deps в `src/renderer/session/composer/Pickers.tsx` (137 ms),
замер переполнения Stepper-а (247 ms), около 125 IPC-вызовов от каждой рамки Epic-а. Временный профиль старта
(`src/main/start-profile.ts`, marks, minify off) из ветки удалён. Карантин снят: файл
`test/quarantine/epic-frame-auberge-start-macos-ci.json` удалён, test объявлен через `test(...)`.

## 9. Как проверено

`node scripts/vitest-electron.mjs test/unit/epic-node-memo.test.tsx test/unit/checks-badges.test.tsx` на коде main —
exit 1, с починкой — exit 0. `pnpm lint && pnpm typecheck && pnpm test`, gate fast — коды выхода в PR. Локально e2e и
Electron не запускали (правило владельца); e2e без карантина проверяет job `macos-e2e` на head PR.

## Проверить себя

1. Почему ответ ELK с теми же местами больше не запускал запись первого открытия, и что это исправило?
   - Ответ: шаг 2 оставляет те же объекты Node-ов, а эффект зависел только от `nodes`; теперь в его deps и `settled`
     состояния раскладки.
   - Строки: `src/renderer/canvas/arrangement-record.ts:255-257`
2. Почему запись кэша при той же раскладке всё же заменяется новой, а не остаётся старой целиком?
   - Ответ: в ней новые `inputs` и `request`: следующее сравнение `same` и проверка `settled` должны видеть
     последний ответ ELK и `cards`, иначе каждый следующий рендер считал бы входы новыми.
   - Строки: `src/renderer/canvas/sources/epics.ts:591-593`
3. Почему отношение 5, а не медиана `N / R` с запасом?
   - Ответ: 5 выше 95-го процентиля `N / R` кода до починки, так что предел держит почти все машины и без выигрыша
     починки, а потолок решает только при `R` от 1460 ms.
   - Строки: `test/e2e/start-budget.ts:15-19`
