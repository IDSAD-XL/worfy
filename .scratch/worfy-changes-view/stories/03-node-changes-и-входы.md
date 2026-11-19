# Code story — worfy-changes-view 03: Node Changes, кнопка Changes на карточке Ticket-а и Open changes в Command palette

Kind: pr · Epic: worfy-changes-view · Ticket: 03 · PR: - · Language: ru

## 1. Что было не так

Ticket 02 дал main каналы `changes.*`, которые читают diff Ticket-а против базы, но в renderer-е их никто не звал:
на Canvas не было ни Node-а, который показывает этот diff, ни входа в него — ни кнопки на карточке Ticket-а, ни строки
в Command palette.

- Требование: [Что происходит](../issues/03-node-changes-и-входы.md#что-происходит)

## 2. У какого Ticket-а есть Changes

Code: `src/renderer/canvas/ticket-card.ts:90-92` · key lines: 91

```ts
export function showsChanges(ticket: { state: TicketState; fromBranch?: string | null | undefined; branch?: string | null | undefined }): boolean {
  return (ticket.fromBranch ?? null) !== null || Boolean(ticket.branch) || ticket.state === 'work'
}
```

- Что делает: решает по самому Ticket-у, показывать ли кнопку Changes на карточке и строку Open changes в palette
  (`hasChangesSubject` в `src/renderer/changes/open.ts` зовёт её) и давать ли карточке вторую строку действий в layout-е
  (`cardHeights` в `src/renderer/canvas/epic-layout.ts`): ветка worktree-а, из которой пришёл статус, строка `Branch:`
  или работа над Ticket-ом.
- Почему здесь: Ticket требует кнопку «на Ticket-е с worktree или веткой» (п. 5) и строку palette для того же Ticket-а
  (п. 6). Функция лежит в `ticket-card.ts`, потому что высоту карточки layout считает до того, как прочитаны worktree-ы:
  кнопка видна ровно там, где есть место для неё (раунд по красному CI run 44595751428; `ticket-card.ts` в списке файлов
  Ticket-а только для чтения, его правку разрешил orchestrator). `state === 'work'` добавлен implementer-ом: у взятого
  Ticket-а ветка уже есть.
- Без него: кнопка была бы у каждого Ticket-а, а у карточки без места для неё строка действий вылезала бы за край.
- Требование: [Что делаем, п. 5 и 6](../issues/03-node-changes-и-входы.md#что-делаем)
- Риски и пробелы test-ов: Ticket, у которого есть только worktree (по snapshot-у проверок) без строки `Branch:` и не в
  работе, кнопки не получает — решено без владельца, записано в «Итог». Окончательный ответ даёт main
  (`changes.scopes`): Ticket, ветка которого исчезла, увидит это в самом Node-е.

## 3. Вторая строка действий карточки

Code: `src/renderer/canvas/epic-frame.css:374-381` · key lines: 376, 377, 379

```css
.w-ticket__actions {
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
  row-gap: 4px;
  max-width: 100%;
  margin-left: auto;
}
```

- Что делает: кнопки действий карточки, которые не помещаются в её ширину, переносятся на вторую строку справа. Место
  для этой строки (`ACTIONS_LINE`, 4 px и кнопка 20 px) layout даёт только карточке, на которой видна Changes
  (`cardHeight` в `src/renderer/canvas/ticket-card.ts`).
- Почему здесь: в CI run 44595751428 строка действий с Changes занимала 285, 270 и 221 px при ширине 218 px, и
  `ticketCardCuts` в `test/e2e/checks-badges.spec.ts` и `test/e2e/pr-follow-ticket.spec.ts` находил кнопку за краем
  карточки. Посылка spec-а «место строки действий карточка уже держит» оказалась неверной; решено без владельца, записано
  в «Итог» Ticket-а.
- Без него: «Changes» на карточке Ticket-а с PR и действием PR follow-up обрезалась бы краем карточки.
- Требование: [Что происходит](../issues/03-node-changes-и-входы.md#что-происходит)
- Риски и пробелы test-ов: unit test-ы `test/unit/ticket-card.test.tsx` проверяют правило CSS, +24 px у карточки в
  работе или со строкой `Branch:` и прежнюю высоту у остальных; что ничего не обрезано в собранном приложении, проверяют
  e2e test-ы `checks-badges` и `pr-follow-ticket` в CI. Карточка с Changes, у которой кнопки помещаются в одну строку,
  несёт 24 px пустого места.

## 4. Где встаёт новый Node

Code: `src/renderer/changes/open.ts:101-105` · key lines: 102, 103

```ts
export function changesPlace(nodes: readonly LayoutNode[], spot: { x: number; y: number } | undefined, anchor: Rect | null, keepOut: readonly Rect[]): { x: number; y: number } {
  const others = [...nodes.filter(onThePlane).map(({ x, y, w, h }) => ({ x, y, w, h })), ...keepOut]
  if (spot !== undefined) return freePlace({ x: spot.x, y: spot.y, ...CHANGES_SIZE }, others)
  return placeNear(others, anchor, CHANGES_SIZE.w, CHANGES_SIZE.h)
}
```

- Что делает: ставит новый Node Changes справа от полосы рамок Epic-ов на высоте Ticket-а (`spot`, как
  `sessionSpot`) — на ближайшее место, которое не накрывает другие Node-ы и полосу (`freePlace`). Без `spot` (рамки не
  нарисованы, palette без карточки на экране) — `placeNear`: справа от карточки или справа от всего Canvas.
- Почему здесь: Ticket называет `placeNear` (п. 5). Отклонение от него записано в отчёте implementer-а: карточка
  стоит внутри рамки Epic-а, и keep-out полосы рамок (`spotKeepOut`, построен под `NODE_GAP` 16) не сходится с отступом
  `placeNear` в 40 px — unit test получал `y = 1000` вместо 320. Так же ставится Session из истории Ticket-а
  (`archive-list.ts`, `showPlace`), и так же main поправил бы место сам (ADR-0038). `placeNear` остался запасным путём.
- Без него: Node встал бы поверх рамки Epic-а или поверх соседней Session.
- Требование: [Что делаем, п. 5](../issues/03-node-changes-и-входы.md#что-делаем)
- Риски и пробелы test-ов: unit test проверяет место (`x 648, y 320`) на одном Layout-е; что Node стоит справа от
  карточки на её высоте и весь в окне в собранном приложении, проверяет e2e test по местам Node-ов на Canvas (transform
  React Flow): карточку вне экрана React Flow не рисует, а после щелчка Canvas центрирован на Node-е.

## 5. В DOM — только окно diff-а

Code: `src/renderer/changes/diff-window.ts:83-107` · key lines: 84, 85, 106

```ts
export function windowOf(heights: readonly number[], top: number, viewport: number, screens = SCREENS_AROUND): DiffWindow {
  const from = top - screens * viewport
  const to = top + viewport + screens * viewport
  let start = heights.length
  let end = heights.length
  let offset = 0
  let before = 0
  for (let index = 0; index < heights.length; index += 1) {
    const height = heights[index]!
    if (start === heights.length && offset + height > from) {
      start = index
      before = offset
    }
    if (offset >= to && start !== heights.length) {
      end = index
      break
    }
    offset += height
  }
  if (start === heights.length) before = offset
  const total = heights.reduce((sum, height) => sum + height, 0)
  let drawn = 0
  for (let index = start; index < end; index += 1) drawn += heights[index]!
  return { start, end, before, after: Math.max(0, total - before - drawn) }
}
```

- Что делает: по высотам блоков (заголовок файла, hunk, заметка о свёрнутом файле) и позиции прокрутки выбирает блоки,
  которые видны или лежат в пределах двух экранов выше и ниже; остальное `DiffPane` заменяет пустым местом `before` и
  `after` той же высоты.
- Почему здесь: Ticket требует «в DOM — только hunk-и на экране и по два экрана вокруг, без новой библиотеки» (п. 4) и
  называет файл `src/renderer/changes/diff-window.ts`. Чистая функция отдельно от компонента — чтобы её можно было
  проверить без DOM.
- Без него: Ticket на 300 файлов и файл на 2 000 строк рисовали бы все строки сразу.
- Требование: [Что делаем, п. 4](../issues/03-node-changes-и-входы.md#что-делаем)
- Риски и пробелы test-ов: высота ещё не нарисованного блока — оценка (`LINE_HEIGHT` на строку); после отрисовки
  `DiffPane` меряет блок `ResizeObserver`-ом и заменяет оценку. В jsdom размеров нет, поэтому unit test проверяет
  `windowOf` на числах и то, что при 301 файле нарисованы не все; настоящую прокрутку проверяет только e2e test.

## 6. Строка Open changes в Command palette

Code: `src/renderer/palette/commands.ts:376-392` · key lines: 378, 382, 389

```ts
  for (const ticket of model.tickets) {
    // Where the card has Changes (changes/open.ts).
    if (!hasChangesSubject(ticket)) continue
    const ref = `${ticket.epic}/${nn(ticket.num)}`
    const subject = { epic: ticket.epic, num: ticket.num }
    // Going to a Changes Node already there changes nothing; a new one is a change of the Layout.
    const there = changesNodeOf(layoutNodes, subject) !== undefined
    commands.push({
      id: `changes:${ref}`,
      group: 'Action',
      title: 'Open changes',
      detail: `${ref} — ${ticket.title}`,
      keys: [`changes ${ref}`, `open changes ${ref}`, `diff ${ref}`],
      readOnly: there ? undefined : hint,
      run: () => openChangesFromPalette(projectId, subject, layoutNodes),
    })
  }
```

- Что делает: для каждого Ticket-а, у которого есть Changes, добавляет в группу Action строку «Open changes» с ключами
  `changes <epic>/<NN>`, `open changes <epic>/<NN>` и `diff <epic>/<NN>`. На экране только для чтения строка неактивна,
  пока Node-а нет: новый Node — изменение Layout-а; переход к Node-у, который уже есть, разрешён.
- Почему здесь: Ticket называет `src/renderer/palette/commands.ts` и группу Action (п. 6); правило `readOnly` — общее
  для строк palette (`:120-130` в Ticket-е).
- Без него: Node Changes открывался бы только с карточки, которую ещё надо найти на Canvas.
- Требование: [Что делаем, п. 6](../issues/03-node-changes-и-входы.md#что-делаем)
- Риски и пробелы test-ов: unit test `test/unit/palette-commands.test.tsx` проверяет строку у Ticket-а с веткой и в
  работе, её отсутствие без них, и то, что на экране только для чтения она неактивна (`changes:e/09` в списке строк,
  которые пишут).

## 7. Palette открывает Node через карточку

Code: `src/renderer/changes/open.ts:191-200` · key lines: 194, 197, 199

```ts
export async function openChangesFromPalette(projectId: string, subject: ChangesSubject, nodes: readonly LayoutNode[]): Promise<string | undefined> {
  const direct = (now: readonly LayoutNode[], place: OpenDeps['place']): Promise<string | undefined> =>
    openChanges({ projectId, nodes: now, apply: (op) => applyRecorded(projectId, op, screenChannel(projectId)), place }, subject)
  if (changesNodeOf(nodes, subject) !== undefined) return direct(nodes, () => ({ x: 0, y: 0 }))
  setView('canvas')
  focusCanvasNode(projectId, ticketNodeId(subject.epic, subject.num), epicNodeId(subject.epic))
  if (await requestOpenChanges(projectId, subject)) return undefined
  const now = currentLayout(projectId)?.nodes ?? nodes
  return direct(now, () => changesPlace(now, undefined, null, []))
}
```

- Что делает: если Node Ticket-а уже есть — переходит к нему. Иначе центрирует Canvas на карточке (или на рамке Epic-а)
  и оставляет запрос; кнопка Changes этой карточки берёт его и ставит Node так же, как по щелчку. Если за 2 s запрос
  никто не взял — ставит Node справа от всего Canvas одним шагом ⌘Z (`applyRecorded`).
- Почему здесь: место у карточки считается по тому, что нарисовал React Flow (полоса рамок, размер карточки), а это
  есть только у кнопки на Canvas. Решение принято implementer-ом; в Ticket-е и spec-е не записано.
- Без него: Node из palette вставал бы в другом месте, чем Node с карточки, или palette импортировала бы код Canvas.
- Требование: [Что делаем, п. 6](../issues/03-node-changes-и-входы.md#что-делаем)
- Риски и пробелы test-ов: unit test проверяет, что palette ведёт к Node-у, который уже есть, и что иначе оставляет
  запрос карточке. Запасной путь через 2 s проверяется только тем, что он есть в коде; отдельного test-а нет.

## 8. Поздний ответ старого чтения отбрасывается

Code: `src/renderer/canvas/nodes/ChangesNode.tsx:117-130` · key lines: 120, 122, 126

```tsx
  useEffect(() => {
    if (!ready || !hasRepos) return
    const of = listFor
    let current = true
    void invoke('changes.list', { projectId, ticket, scope, hideWhitespace }).then((result) => {
      if (!current) return
      setListRead(result.ok ? { of, value: result.value.repos, error: null } : { of, value: null, error: failureReason('changes.list', result.error) })
    })
    return () => {
      current = false
    }
    // `scope` is in `listFor`; the read starts again only when the key does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hasRepos, listFor])
```

- Что делает: когда ключ чтения меняется (scope, Hide whitespace, другой Ticket), cleanup эффекта помечает прежнее
  чтение устаревшим, и его ответ, пришедший позже нового, не пишется в состояние. Так же устроены `changes.scopes` и
  `changes.commits` выше (строки 86-110), а в `DiffPane.tsx:279` ответ `changes.file` сверяется с текущим `readFor`
  (`asked.current.of`).
- Почему здесь: находки 1 и 2 ревью раунда 1 (verdict PR #2043): поздний ответ старого ключа затирал ответ нового;
  ключ состояния переставал совпадать с текущим, и экран оставался на «Reading…» или «Loading…», потому что эффект
  второй раз не запускался.
- Без него: Hide whitespace, включённый и выключенный во время чтения, или смена Ticket-а у Node-а оставляют пустое
  дерево до Refresh, а файлы diff-а — на «Loading…».
- Требование: [Готово, когда](../issues/03-node-changes-и-входы.md#готово-когда)
- Риски и пробелы test-ов: четыре unit test-а в `test/unit/changes-view.test.tsx` (describe «a late answer of a read
  gone by») держат один ответ моста и отпускают его после нового; каждый красный на mutant-е без своей проверки.
  Ответ с ошибкой отбрасывается тем же путём, отдельного test-а на него нет.

## 9. Свой ResizeObserver на каждый `measuredFor`

Code: `src/renderer/changes/DiffPane.tsx:318-345` · key lines: 321, 322, 338

```tsx
  const measure = useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null || typeof ResizeObserver === 'undefined') return
      if (observer.current?.of !== measuredFor) {
        observer.current?.watcher.disconnect()
        const watcher = new ResizeObserver((records) => {
          setMeasured((previous) => {
            const map = new Map(previous.of === measuredFor ? previous.map : [])
            let changed = previous.of !== measuredFor
            for (const record of records) {
              const key = (record.target as HTMLElement).dataset.block
              // The space under a file is its last block's margin: part of the block's room in the window.
              const height = record.target.getBoundingClientRect().height + (Number.parseFloat(getComputedStyle(record.target).marginBottom) || 0)
              if (key === undefined || height === 0 || Math.abs((map.get(key) ?? -1) - height) <= 0.5) continue
              map.set(key, height)
              changed = true
            }
            return changed ? { of: measuredFor, map } : previous
          })
        })
        observer.current = { of: measuredFor, watcher }
      }
      const { watcher } = observer.current
      watcher.observe(element)
      return () => watcher.unobserve(element)
    },
    [measuredFor],
  )
```

- Что делает: observer хранится вместе с ключом `measuredFor`, для которого создан. Первый ref callback нового ключа
  (Wrap, Inline или Side by side, Hide whitespace, Refresh) отключает старый observer и создаёт новый; эффекта, который
  отключал observer после смены ключа, больше нет.
- Почему здесь: находка 3 ревью раунда 1: React 19 подключает ref callback-и нового layout-а в layout-фазе, до эффектов;
  прежний код переиспользовал старый observer через `??=`, а эффект затем отключал его, и блоки больше не измерялись.
- Без него: после Wrap высоты блоков остаются оценками, и щелчок по файлу дерева, `j`/`k` и `n`/`p` прокручивают не туда.
- Требование: [Готово, когда](../issues/03-node-changes-и-входы.md#готово-когда)
- Риски и пробелы test-ов: unit test «a new Wrap measures the blocks on screen again…» со stub-ом `ResizeObserver`
  проверяет, что каждый блок на экране под живым observer-ом и что щелчок по файлу дерева ставит прокрутку по
  сообщённым высотам после Wrap и после Side by side; красный и на прежнем коде, и на mutant-е «observer создаётся
  один раз». Настоящий `ResizeObserver` браузера проверяет только e2e test в CI.

## 10. Номер запроса palette только растёт

Code: `src/renderer/changes/open.ts:152-161` · key lines: 153, 160, 161

```ts
/** The number of the last request: it only grows, so a request's timer never meets a later request of the same number. */
let lastSeq = 0

/**
 * Leaves a request for the card of the Ticket; resolves to true once its button took it, to false when none did in
 * REQUEST_WAIT_MS (the request is then dropped, so a card drawn later does not open the Node unasked).
 */
export function requestOpenChanges(projectId: string, subject: ChangesSubject): Promise<boolean> {
  lastSeq += 1
  const seq = lastSeq
```

- Что делает: номер запроса Open changes берётся из счётчика модуля, а не из запроса, который сейчас лежит в store.
- Почему здесь: находка 4 ревью раунда 1: после взятого запроса номер начинался снова с 1, и таймер первого запроса
  через 2 s удалял запись `settle` второго.
- Без него: второй Open changes из palette в течение 2 s после первого никогда не завершается: ни карточка его не
  возьмёт, ни запасное место не сработает.
- Требование: [Что делаем, п. 6](../issues/03-node-changes-и-входы.md#что-делаем)
- Риски и пробелы test-ов: unit test в `test/unit/palette-commands.test.tsx` на fake timers: второй запрос после
  таймера первого берётся карточкой, а не взятый запрос даёт false ровно через свои 2 s; красный на mutant-е с прежним
  номером.

## 11. Что сознательно не меняли

Gutter «+», popover и лоток комментариев — Ticket 05: у `DiffPane` есть prop `renderGutter`, через который Ticket 05
добавит «+», сам `DiffPane` его не рисует. Chip со счётчиком `+N −M`, Viewed и живое обновление — часть 2. Цвет вида
Node-а в minimap нейтральный (`var(--border-strong)`): по ADR-0077 новый вид получает свой цвет только через новый ADR.
Переводы страниц — Ticket 06. Подсветки синтаксиса нет: строки окрашены только `--ready-*` и `--blocked-*`.

## 12. Как проверено

Сначала test: новые unit test-ы не могли пройти до кода — модулей `src/renderer/changes/*` и
`src/renderer/canvas/actions/Changes.tsx` не было. Затем `node scripts/vitest-electron.mjs test/unit/changes-view.test.tsx`
(17 test-ов), `test/unit/canvas-actions.test.tsx` и `test/unit/palette-commands.test.tsx` — exit 0; `pnpm lint`,
`pnpm typecheck` — exit 0; `node scripts/check-feature-docs.mjs` — exit 0. Полный `pnpm test` и gate fast — с кодом
выхода в отчёте implementer-а. e2e test `test/e2e/changes.spec.ts` локально не запускался: его запускает CI.
Раунд по красному CI run 44595751428: unit test-ы `test/unit/ticket-card.test.tsx`, `test/unit/canvas-actions.test.tsx`,
`test/unit/epic-layout.test.ts` — exit 0, и каждый из четырёх mutant-ов (без `ACTIONS_LINE` в `cardHeight`, без флага
`changes` в `cardHeights`, `flex-wrap: nowrap`, кнопка у каждого Ticket-а) делает их красными; e2e test-ы — в CI.
Раунд по ревью PR #2043: `test/unit/changes-view.test.tsx` и `test/unit/palette-commands.test.tsx` — exit 0; mutant-ы
каждой правки (без проверки `current` у `changes.list`, у `changes.scopes`, у `changes.commits`, без сверки
`asked.current.of` у `changes.file`, observer создаётся один раз, observer создаётся один раз и отключается эффектом,
прежний номер запроса) делают их красными, exit 1. Тем же способом проверены новые test-ы клавиш `n`/`p` и показа
скрытого Node-а из palette. e2e test снимает карточку с кнопкой Changes в обеих темах (`changes-node-card`) в CI.

## Проверить себя

1. Почему новый Node ставится через `freePlace` от `sessionSpot`, а не через `placeNear` от карточки, как сказано в
   Ticket-е?
   - Ответ: карточка стоит внутри рамки Epic-а; keep-out полосы рамок вместе с отступом `placeNear` уводил Node вниз,
     под все рамки. От точки справа от полосы `freePlace` находит ближайшее свободное место на высоте Ticket-а.
   - Lines: `src/renderer/changes/open.ts:103`
2. Почему Open changes из palette не ставит Node сам, а оставляет запрос карточке?
   - Ответ: место рядом с карточкой считается по тому, что нарисовал Canvas; это знает только кнопка на карточке.
     Сам palette ставит Node только когда за 2 s никто не взял запрос.
   - Lines: `src/renderer/changes/open.ts:197`, `src/renderer/changes/open.ts:199`
3. Что стоит в DOM на месте блоков вне окна diff-а, и зачем?
   - Ответ: пустое место `before` и `after` той же суммарной высоты: полоса прокрутки и позиция видимых блоков не
     прыгают, хотя нарисованы только блоки экрана и двух экранов вокруг.
   - Lines: `src/renderer/changes/diff-window.ts:106`

## 13. Что нашёл review и что осталось

> VERIFIED; debt: [low] the card shot (test/e2e/changes.spec.ts:185) shows only the Changes button on its own line — the wrapped second action line is in no shot, because the fixture Tickets have no other action; [low] src/renderer/changes/open.ts:162 — a new request settles the previous pending one with false, so the palette fallback may place the first Ticket's Node at the right of the Canvas although the user already chose another Ticket (round-1 behaviour, implementer's note).
> Round 1 items: all five fixed (verifier re-applied the old code of each as a mutant, the guarding test fails on each: ChangesNode.tsx:86-127 stale list/scopes/commits answers, DiffPane.tsx:277-279 stale changes.file answers, DiffPane.tsx:310-345 the ResizeObserver kept with its measuredFor, open.ts:152-161 the module-level request counter, the card shot changes-node-card in both themes of CI run 44618149442). The correctness reviewer found no defect introduced by the rework (87/87 unit tests, 23/23 under StrictMode).
> Consider: [low] src/renderer/canvas/actions/Changes.tsx:71 — the read-only inactive state of the button still has no unit test; [low] src/renderer/changes/open.ts:54, :73 — `num >= 0` and the epic compare in changesNodeOf are untested.
> Noted: [low] the CI shots show no selected file and no outlined hunk, which the prototype has; binary and Workflow-files groups only in unit tests. Decided without the owner, to confirm: the Node is placed by freePlace from sessionSpot (right of the frames strip at the Ticket's height), not placeNear; the action row wraps and cards with a branch or worktree reserve +24 px for a second line (the spec's premise «ticket-card.ts не меняется» was false: 285/270/221 px against 218 px).
> Dismissed: none.
> Review depth: medium — the ticket's own depth (ticket file); round 2 on the rework diff af405ab26..69553a1d8
> Review tokens: 408310 + 125323 = 533633
> Could not verify: the pixel-level fit of the wrapped second action line on a card with two or more actions (no fixture has one); no local e2e by the brief, so the shots are CI's, not reproduced.

Code: `test/e2e/changes.spec.ts:185-185` · key lines: 185

```ts
    await snapshotThemes(window, 'changes-node-card')
```

Code: `src/renderer/changes/open.ts:162-162` · key lines: 162

```ts
  for (const [, done] of settle) done(false)
```

Code: `src/renderer/canvas/actions/Changes.tsx:71-71` · key lines: 71

```tsx
  const inactive = readOnly !== null && !exists
```

Code: `src/renderer/changes/open.ts:54-54` · key lines: 54

```ts
  return typeof epic === 'string' && epic !== '' && typeof num === 'number' && Number.isInteger(num) && num >= 0 ? { epic, num } : null
```
