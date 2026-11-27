# Code story — worfy-polish 161: Пузырь Assistant-а закрывается целиком

Kind: pr · Epic: worfy-polish · Ticket: 161 · PR: - · Language: ru

## 1. Что было не так

Пузырь Assistant-а у его кнопки в rail показывал один пункт из 56 и строку «56 more in Assistant». × вызывал
`closeCard(item.id)` и добавлял в список закрытых один id; очередь пузыря — все пункты в состоянии `new`, кроме
закрытых, так что за каждым × вставал следующий пункт. Список закрытых жил только в памяти окна: после перезапуска весь
хвост начинался снова с самого старого пункта.

- Требование: [Что происходит](../issues/161-пузырь-assistant-а-закрывается-целиком.md#что-происходит)

## 2. Main помнит, о чём пузырь уже сказал, — столько событий, сколько пузырь показал

Code: `src/main/assistant/window/view.ts:325-341` · key lines: 331, 337, 338, 340

```ts
  /**
   * The user closed the speech card over these items (`assistant.cardClosed`): each counts as told by the card with the
   * count of events the card showed of it — an event that came after the card was drawn keeps the item untold; without a
   * count, as the item is now. Nothing else of the item changes — its state, its duty's counts, the list. Marks of items
   * no longer there go.
   */
  cardClosed(closed: readonly { id: string; events?: number | undefined }[]): void {
    const shown = new Map(closed.map((each) => [each.id, each.events]))
    const items = this.allItems()
    const before = this.load().card?.told ?? {}
    const told: Record<string, { events: number; urgent: boolean }> = {}
    for (const item of items) {
      if (shown.has(item.id)) told[item.id] = { events: shown.get(item.id) ?? item.events, urgent: isUrgentItem(item) }
      else if (before[item.id] !== undefined) told[item.id] = before[item.id]!
    }
    this.save((state) => void (state.card = { told }))
  }
```

- Что делает: по каналу `assistant.cardClosed` записывает в собственный файл раздела `assistant/window.json` для каждого
  названного пункта число событий, которое показал пузырь (новое поле `events` пункта вида), и признак срочности.
  Отметки других пунктов остаются, отметки пунктов, которых больше нет, уходят. Состояние пункта, счётчики обязанности
  и список не трогаются: × — не Dismiss.
- Почему здесь: решение, п. 3, требует, чтобы отметка пережила перезапуск, и называет файл, где ticket 14 хранит
  Snooze-ы; число событий как «что уже сказано» — тот же приём, что у решения о пробуждении
  (`src/main/assistant/wake/planner.ts`, `delivered`). Число от окна, а не из main — решение review, раунд 1.
- Без него: отметка жила бы в памяти окна; с числом из main событие, пришедшее между отрисовкой и ×, считалось бы
  сказанным, хотя его никто не видел.
- Требование: [Решение, п. 1–3, после review](../issues/161-пузырь-assistant-а-закрывается-целиком.md#решение-orchestrator-2026-11-26)
- Риски и пробелы test-ов: канал принимает до 5000 пунктов; хвост длиннее отклоняется, и окно показывает toast
  «Close».

## 3. Вид говорит окну, какой пункт уже сказан и есть ли хвост

Code: `src/main/assistant/window/view.ts:225-226` · key lines: 226

```ts
/** Whether the speech card told of the item as it is now: closed over it, and no event came on it nor did it turn urgent since. */
const cardTold = (told: { events: number; urgent: boolean } | undefined, item: AttentionItem): boolean => told !== undefined && told.events === item.events && told.urgent === isUrgentItem(item)
```

- Что делает: пункт считается сказанным, пока у него то же число событий и та же срочность, что при закрытии. Вид ставит
  такому пункту `cardSeen: true`, а самому виду — `cardBacklog: true`, пока пузырь ни разу не закрывали.
- Почему здесь: решение, п. 2: пузырь снова только о новом пункте, о пункте с новым событием или ставшем срочным.
- Без него: окно не отличило бы старый хвост от пришедшего после закрытия.
- Требование: [Решение, п. 2, 4](../issues/161-пузырь-assistant-а-закрывается-целиком.md#решение-orchestrator-2026-11-26)
- Риски и пробелы test-ов: поля `cardSeen`, `cardBacklog` и `events` необязательные, чтобы старые виды в test-ах и у
  Linked machine читались как прежде; отсутствие `cardBacklog` значит «хвоста нет».

## 4. Очередь пузыря и строка хвоста, без срочного внутри

Code: `src/renderer/assistant/speech.ts:19-36` · key lines: 21, 30, 32, 33

```ts
export function speechQueue(view: AssistantView | null, closed: ReadonlySet<string>, sectionShown: boolean, inWindow: InWindowNotices = 'batched'): WindowItem[] {
  if (view === null || !view.on || sectionShown || inWindow === 'none') return []
  return view.items.filter((item) => item.state === 'new' && item.cardSeen !== true && !closed.has(item.id) && (inWindow === 'batched' || item.urgent))
}

/** What the card shows: the first item of the queue and how many more, or, while the card was never closed, one line of the backlog. */
export type SpeechCard = { kind: 'item'; item: WindowItem; more: number } | { kind: 'backlog'; count: number }

export function speechCard(view: AssistantView | null, queue: readonly WindowItem[]): SpeechCard | null {
  const first = queue[0]
  if (first === undefined) return null
  if (view?.cardBacklog === true && queue.length > 1) {
    // An urgent item is never folded into the line (review round 2): the card tells of the first urgent one.
    const urgent = queue.find((each) => each.urgent)
    return urgent === undefined ? { kind: 'backlog', count: queue.length } : { kind: 'item', item: urgent, more: queue.length - 1 }
  }
  return { kind: 'item', item: first, more: queue.length - 1 }
}
```

- Что делает: очередь пропускает сказанные пункты. Пока пузырь ни разу не закрывали и ждут два пункта и больше, пузырь
  — одна строка «N waiting in Assistant», без пункта и без кнопок. Если среди них есть срочный, пузырь показывает первый
  срочный пункт со строкой «N more in Assistant». Один пункт — не хвост, пузырь говорит о нём.
- Почему здесь: Ticket называет `speech.ts` среди своих файлов; почему один пункт не хвост — выбор этого Ticket-а
  («Решение», п. 4); срочный вне строки — решение review, раунд 1.
- Без него: при первом запуске после обновления пузырь начинал бы с самого старого пункта хвоста; без правила о
  срочном остановленный Run прятался бы за строкой, без пометки Urgent и без Open.
- Требование: [Решение, п. 4, после review](../issues/161-пузырь-assistant-а-закрывается-целиком.md#решение-orchestrator-2026-11-26)
- Риски и пробелы test-ов: новый пользователь, у которого сразу пришли два обычных пункта, тоже увидит строку, а не
  пункт.

## 5. × закрывает всё, что пузырь сказал бы; Escape — только из пузыря

Code: `src/renderer/assistant/AssistantSpeech.tsx:41-49` · key lines: 46, 47

```tsx
/**
 * Whether an Escape belongs to the card: only with the keyboard focus inside the card or on the Assistant's rail button
 * (review round 2). Anywhere else Escape is the Canvas's, Focus mode's or a field's, and Close stays the way to close.
 */
function escapeForCard(event: KeyboardEvent): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented || !(event.target instanceof Element)) return false
  if (event.target.closest(`.w-asst-say, [data-section-tab="${ASSISTANT_SECTION}"]`) === null) return false
  return useAssistant.getState().prepare === null
}
```

- Что делает: × передаёт `closeCard` всю очередь, а не один пункт (`const close = () => closeCard(queue)`). Escape делает
  то же, только когда фокус клавиатуры в пузыре или на кнопке Assistant-а в rail, и не при открытом Prepare. Щелчок мимо
  пузыря, как и раньше, ничего не делает.
- Почему здесь: решение, п. 1 и 5; ограничение по фокусу — решение review, раунд 1: Focus mode и Canvas слушают Escape
  на `window` в той же фазе, и порядок регистрации решал бы, кто его получит.
- Без него: каждый × закрывал бы один пункт — это и есть замечание владельца; без ограничения по фокусу одно нажатие
  Escape и выходило бы из Focus mode, и закрывало бы пузырь.
- Требование: [Решение, п. 1, 5, после review](../issues/161-пузырь-assistant-а-закрывается-целиком.md#решение-orchestrator-2026-11-26)
- Риски и пробелы test-ов: test-ы проверяют фокус на Canvas, в Focus mode, в поле, в пузыре и на кнопке rail в jsdom;
  настоящий порядок обработчиков в Electron не проверен.

## 6. Окно прячет пункты сразу и шлёт их такими, какими показало

Code: `src/renderer/assistant/useAssistant.ts:211-224` · key lines: 217, 219, 220, 221

```ts
/**
 * The speech card stops telling of these items, as it showed them; they stay in the list as they are. Main keeps them as
 * told by the card (`assistant.cardClosed`, worfy-polish 161) with the count of events the card showed, so the card is
 * not shown for them again, after a restart too, until something new comes on one. This window keeps them off the card
 * at once, until main's view does the same.
 */
export function closeCard(items: readonly Pick<WindowItem, 'id' | 'events'>[]): void {
  if (items.length === 0) return
  useAssistant.setState((state) => ({ closed: [...new Set([...state.closed, ...items.map((each) => each.id)])] }))
  const told = items.map((each) => (each.events === undefined ? { id: each.id } : { id: each.id, events: each.events }))
  void invoke('assistant.cardClosed', { items: told }).then((result) => {
    if (!result.ok) refused('Close', result.error)
  })
}
```

- Что делает: пузырь исчезает сразу по щелчку; id остаются в списке окна только до вида main, который делает то же
  (`stillClosed`: пункт сказан, ушёл из `new` или из списка). Каждый вызов — ×, Escape, Open, Prepare, Snooze, like и
  dislike пузыря — просит main запомнить пункты с тем числом событий, которое показал пузырь.
- Почему здесь: решение, п. 6: после действия пузырь идёт к следующему пункту, новому с последнего закрытия; Open и
  Snooze как «увидел» — решение review, раунд 1.
- Без него: прежний список закрытых держал бы пункт скрытым до перезапуска, даже когда на нём новое событие; без
  отметки после Open строка хвоста оставалась бы навсегда.
- Требование: [Решение, п. 6, после review](../issues/161-пузырь-assistant-а-закрывается-целиком.md#решение-orchestrator-2026-11-26)
- Риски и пробелы test-ов: если main отклонит `assistant.cardClosed`, окно прячет пункты до их следующего изменения, но
  после перезапуска они вернутся; test этот отказ не проверяет. Отложенный с пузыря пункт, проснувшись, пузырь не
  покажет: он отмечен; он есть в списке и на значке.

## 7. Что сознательно не меняли

Dismiss, список Waits, число на значке, системные уведомления и то, что считается показанным (`assistant.shown`), —
как в worfy-assistant 14. e2e пузыря нет: `test/e2e/assistant.spec.ts` его не проверяет, править нечего. Русский
перевод `docs/features/ru/assistant.md` не правили: в PR с поведением правится только английская страница.

## 8. Как проверено

Test-ы первого раунда были красными на коде origin/main (16 упали, среди них «один × — пузыря нет»). Test-ы раунда 2
(срочный вне строки, Open и Snooze отмечают, Escape по фокусу, число событий от окна) красные до правки; каждый из
четырёх мутантов этих правок даёт красный test. После правки: test-ы Assistant-а, IPC, Focus mode и клавиш Canvas
(45 файлов, 926 test-ов) — exit 0; `pnpm lint`, `pnpm typecheck` — exit 0; gate fast — зелёный. e2e и Electron
локально не запускали (правило владельца).

## Проверить себя

1. Почему пункт с новым событием снова попадает в пузырь, хотя его id есть в отметке?
   - Ответ: отметка хранит число событий, которое показал пузырь; новое событие меняет `events` пункта, и `cardTold`
     перестаёт совпадать.
   - Строки: `src/main/assistant/window/view.ts:226`
2. Почему окно шлёт в main число событий, а не только id?
   - Ответ: событие могло прийти между отрисовкой пузыря и ×; с числом из main оно считалось бы сказанным, хотя
     пузырь его не показывал.
   - Строки: `src/main/assistant/window/view.ts:337`, `src/renderer/assistant/useAssistant.ts:220`
3. Что увидит пользователь, обновившийся с 56 пунктами, среди которых один остановленный Run?
   - Ответ: не строку хвоста, а этот срочный пункт с пометкой Urgent и «55 more in Assistant»; × отметит все 56.
   - Строки: `src/renderer/assistant/speech.ts:30-33`
