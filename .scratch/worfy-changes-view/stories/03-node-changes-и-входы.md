# Code story — worfy-changes-view 03: Node Changes, кнопка Changes на карточке Ticket-а и Open changes в Command palette

Kind: pr · Epic: worfy-changes-view · Ticket: 03 · PR: - · Language: ru

## 1. Что было не так

Ticket 02 дал main каналы `changes.*`, которые читают diff Ticket-а против базы, но в renderer-е их никто не звал:
на Canvas не было ни Node-а, который показывает этот diff, ни входа в него — ни кнопки на карточке Ticket-а, ни строки
в Command palette.

- Требование: [Что происходит](../issues/03-node-changes-и-входы.md#что-происходит)

## 2. У какого Ticket-а есть Changes

Code: `src/renderer/changes/open.ts:81-83` · key lines: 82

```ts
export function hasChangesSubject(ticket: Pick<Ticket, 'state' | 'fromBranch' | 'branch'>, worktree: boolean): boolean {
  return worktree || ticket.fromBranch !== null || Boolean(ticket.branch) || ticket.state === 'work'
}
```

- Что делает: решает, показывать ли кнопку Changes на карточке и строку Open changes в palette: у Ticket-а есть
  worktree (по snapshot-у проверок карточки), ветка worktree-а, из которой пришёл его статус, строка `Branch:` или он в
  работе.
- Почему здесь: Ticket требует кнопку «на Ticket-е с worktree или веткой» (п. 5) и строку palette для того же Ticket-а
  (п. 6); одна функция в `src/renderer/changes/open.ts` даёт обоим одно правило. Файл `open.ts` в списке файлов Ticket-а
  нет: palette не может импортировать registry Node-ов, а `.tsx` файла действия держит только компоненты (правило lint
  `react-refresh/only-export-components`). `state === 'work'` добавлен implementer-ом: у взятого Ticket-а ветка уже есть,
  даже когда worktree-а ещё не видно в snapshot-е.
- Без него: кнопка была бы у каждого Ticket-а, и у Ticket-а без ветки Node показывал бы пустой экран.
- Требование: [Что делаем, п. 5 и 6](../issues/03-node-changes-и-входы.md#что-делаем)
- Риски и пробелы test-ов: palette не читает snapshot проверок и передаёт `worktree = false`: Ticket, у которого есть
  только worktree без строки `Branch:` и не в работе, получит кнопку, но не строку palette. Окончательный ответ даёт main
  (`changes.scopes`): Ticket, ветка которого исчезла, увидит это в самом Node-е.

## 3. Где встаёт новый Node

Code: `src/renderer/changes/open.ts:102-106` · key lines: 103, 104

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
  карточки на её высоте в собранном приложении, проверяет e2e test, который локально не запускался.

## 4. В DOM — только окно diff-а

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

## 5. Строка Open changes в Command palette

Code: `src/renderer/palette/commands.ts:376-392` · key lines: 378, 382, 389

```ts
  for (const ticket of model.tickets) {
    // Where the card has Changes, except a worktree the palette does not read (changes/open.ts).
    if (!hasChangesSubject(ticket, false)) continue
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

## 6. Palette открывает Node через карточку

Code: `src/renderer/changes/open.ts:189-198` · key lines: 192, 195, 197

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

## 7. Что сознательно не меняли

Gutter «+», popover и лоток комментариев — Ticket 05: у `DiffPane` есть prop `renderGutter`, через который Ticket 05
добавит «+», сам `DiffPane` его не рисует. Chip со счётчиком `+N −M`, Viewed и живое обновление — часть 2. Цвет вида
Node-а в minimap нейтральный (`var(--border-strong)`): по ADR-0077 новый вид получает свой цвет только через новый ADR.
Переводы страниц — Ticket 06. Подсветки синтаксиса нет: строки окрашены только `--ready-*` и `--blocked-*`.

## 8. Как проверено

Сначала test: новые unit test-ы не могли пройти до кода — модулей `src/renderer/changes/*` и
`src/renderer/canvas/actions/Changes.tsx` не было. Затем `node scripts/vitest-electron.mjs test/unit/changes-view.test.tsx`
(17 test-ов), `test/unit/canvas-actions.test.tsx` и `test/unit/palette-commands.test.tsx` — exit 0; `pnpm lint`,
`pnpm typecheck` — exit 0; `node scripts/check-feature-docs.mjs` — exit 0. Полный `pnpm test` и gate fast — с кодом
выхода в отчёте implementer-а. e2e test `test/e2e/changes.spec.ts` локально не запускался: его запускает gate full в CI.

## Проверить себя

1. Почему новый Node ставится через `freePlace` от `sessionSpot`, а не через `placeNear` от карточки, как сказано в
   Ticket-е?
   - Ответ: карточка стоит внутри рамки Epic-а; keep-out полосы рамок вместе с отступом `placeNear` уводил Node вниз,
     под все рамки. От точки справа от полосы `freePlace` находит ближайшее свободное место на высоте Ticket-а.
   - Lines: `src/renderer/changes/open.ts:104`
2. Почему Open changes из palette не ставит Node сам, а оставляет запрос карточке?
   - Ответ: место рядом с карточкой считается по тому, что нарисовал Canvas; это знает только кнопка на карточке.
     Сам palette ставит Node только когда за 2 s никто не взял запрос.
   - Lines: `src/renderer/changes/open.ts:195`, `src/renderer/changes/open.ts:197`
3. Что стоит в DOM на месте блоков вне окна diff-а, и зачем?
   - Ответ: пустое место `before` и `after` той же суммарной высоты: полоса прокрутки и позиция видимых блоков не
     прыгают, хотя нарисованы только блоки экрана и двух экранов вокруг.
   - Lines: `src/renderer/changes/diff-window.ts:106`
