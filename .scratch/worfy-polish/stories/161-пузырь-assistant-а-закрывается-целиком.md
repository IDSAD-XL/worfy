# Code story — worfy-polish 161: Пузырь Assistant-а закрывается целиком

Kind: pr · Epic: worfy-polish · Ticket: 161 · PR: - · Language: ru

## 1. Что было не так

Пузырь Assistant-а у его кнопки в rail показывал один пункт из 56 и строку «56 more in Assistant». × вызывал
`closeCard(item.id)` и добавлял в список закрытых один id; очередь пузыря — все пункты в состоянии `new`, кроме
закрытых, так что за каждым × вставал следующий пункт. Список закрытых жил только в памяти окна: после перезапуска весь
хвост начинался снова с самого старого пункта.

- Требование: [Что происходит](../issues/161-пузырь-assistant-а-закрывается-целиком.md#что-происходит)

## 2. Main помнит, о чём пузырь уже сказал

Code: `src/main/assistant/window/view.ts:325-339` · key lines: 329, 335, 336, 338

```ts
  /**
   * The user closed the speech card over these items (`assistant.cardClosed`): each counts as told by the card as it is
   * now. Nothing else of the item changes — its state, its duty's counts, the list. Marks of items no longer there go.
   */
  cardClosed(itemIds: readonly string[]): void {
    const ids = new Set(itemIds)
    const items = this.allItems()
    const before = this.load().card?.told ?? {}
    const told: Record<string, { events: number; urgent: boolean }> = {}
    for (const item of items) {
      if (ids.has(item.id)) told[item.id] = { events: item.events, urgent: isUrgentItem(item) }
      else if (before[item.id] !== undefined) told[item.id] = before[item.id]!
    }
    this.save((state) => void (state.card = { told }))
  }
```

- Что делает: по каналу `assistant.cardClosed` записывает в собственный файл раздела `assistant/window.json` для каждого
  названного пункта число его событий и признак срочности на момент закрытия. Отметки других пунктов остаются, отметки
  пунктов, которых больше нет, уходят. Состояние пункта, счётчики обязанности и список не трогаются: × — не Dismiss.
- Почему здесь: решение, п. 3, требует, чтобы отметка пережила перезапуск, и называет файл, где ticket 14 хранит
  Snooze-ы; число событий как «что уже сказано» — тот же приём, что у решения о пробуждении
  (`src/main/assistant/wake/planner.ts`, `delivered`).
- Без него: отметка жила бы в памяти окна, и после перезапуска или обновления хвост приходил бы снова.
- Требование: [Решение, п. 1–3](../issues/161-пузырь-assistant-а-закрывается-целиком.md#решение-orchestrator-2026-11-26)
- Риски и пробелы test-ов: канал принимает до 5000 id; хвост длиннее отклоняется, и окно показывает toast «Close». Новое
  событие с более ранним временем всё равно меняет `events`, и пузырь скажет о пункте снова — так и задумано.

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
- Риски и пробелы test-ов: оба поля необязательные, чтобы старые виды в test-ах и у Linked machine читались как прежде;
  отсутствие `cardBacklog` значит «хвоста нет».

## 4. Очередь пузыря и строка хвоста

Code: `src/renderer/assistant/speech.ts:18-31` · key lines: 20, 29

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
  if (view?.cardBacklog === true && queue.length > 1) return { kind: 'backlog', count: queue.length }
  return { kind: 'item', item: first, more: queue.length - 1 }
}
```

- Что делает: очередь пропускает сказанные пункты. Пока пузырь ни разу не закрывали и ждут два пункта и больше, пузырь
  — одна строка «N waiting in Assistant», без пункта и без кнопок; один пункт — не хвост, пузырь говорит о нём.
  Строка хвоста ничего не считает показанным, а значок под ней показывает, сколько всего ждёт.
- Почему здесь: Ticket называет `speech.ts` среди своих файлов; почему один пункт не считается хвостом — выбор этого
  Ticket-а, записан в «Решении», п. 4.
- Без него: при первом запуске после обновления пузырь начинал бы с самого старого пункта хвоста.
- Требование: [Решение, п. 4](../issues/161-пузырь-assistant-а-закрывается-целиком.md#решение-orchestrator-2026-11-26)
- Риски и пробелы test-ов: новый пользователь, у которого сразу пришли два пункта, тоже увидит строку, а не пункт.

## 5. × и Escape закрывают всё, что пузырь сказал бы

Code: `src/renderer/assistant/AssistantSpeech.tsx:71-84` · key lines: 73, 74, 78

```tsx
  // Close (and Escape) closes the card as a whole: every item it would tell of now counts as told by it (worfy-polish
  // 161). The items stay in the list, in their state; the card speaks again only of what comes after.
  const ids = queue.map((each) => each.id).join('\n')
  const close = useCallback(() => closeCard(ids === '' ? [] : ids.split('\n'), true), [ids])
  useEffect(() => {
    if (card === null) return
    const onKey = (event: KeyboardEvent) => {
      if (!escapeForCard(event)) return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card === null, close]) // eslint-disable-line react-hooks/exhaustive-deps -- the card is a fresh object each render
```

- Что делает: × передаёт `closeCard` id всей очереди, а не одного пункта; Escape делает то же, пока пузырь виден.
  `escapeForCard` не берёт Escape из поля ввода, Terminal-а, открытого меню или слоя, из открытого Prepare и Escape,
  который уже обработал кто-то другой. Щелчок мимо пузыря, как и раньше, ничего не делает.
- Почему здесь: решение, п. 1 и 5.
- Без него: каждый × закрывал бы один пункт — это и есть замечание владельца.
- Требование: [Решение, п. 1, 5](../issues/161-пузырь-assistant-а-закрывается-целиком.md#решение-orchestrator-2026-11-26)
- Риски и пробелы test-ов: Escape в Terminal-е пузырь не закрывает намеренно — там Escape нужен агенту; test
  проверяет только поле ввода.

## 6. Окно прячет пункт сразу, пока main не ответил

Code: `src/renderer/assistant/useAssistant.ts:211-223` · key lines: 218, 220

```ts
/**
 * The speech card stops telling of these items; they stay in the list as they are. `told`: main keeps them as told by the
 * card (`assistant.cardClosed`, worfy-polish 161), so the card is not shown for them again, after a restart too, until
 * something new comes on one. Without it the click itself takes the item off the card (Open, Snooze): a snoozed item that wakes tells again.
 */
export function closeCard(itemIds: readonly string[], told: boolean): void {
  if (itemIds.length === 0) return
  useAssistant.setState((state) => ({ closed: [...new Set([...state.closed, ...itemIds])] }))
  if (!told) return
  void invoke('assistant.cardClosed', { itemIds: [...itemIds] }).then((result) => {
    if (!result.ok) refused('Close', result.error)
  })
}
```

- Что делает: пузырь исчезает сразу по щелчку; id остаются в списке окна только до вида main, который делает то же
  (`stillClosed`: пункт сказан, ушёл из `new` или из списка). × и like/dislike и Prepare пузыря просят main запомнить
  пункт; Open и Snooze — нет: пункт уходит из `new` сам, а разбуженный Snooze снова доходит до пузыря.
- Почему здесь: решение, п. 6: после действия пузырь идёт к следующему пункту, новому с последнего закрытия.
- Без него: прежний список закрытых держал бы пункт скрытым до перезапуска, даже когда на нём новое событие.
- Требование: [Решение, п. 6](../issues/161-пузырь-assistant-а-закрывается-целиком.md#решение-orchestrator-2026-11-26)
- Риски и пробелы test-ов: если main отклонит `assistant.cardClosed`, окно прячет пункты до их следующего изменения, но
  после перезапуска они вернутся; test этот отказ не проверяет.

## 7. Что сознательно не меняли

Dismiss, список Waits, число на значке, системные уведомления и то, что считается показанным (`assistant.shown`), —
как в worfy-assistant 14. e2e пузыря нет: `test/e2e/assistant.spec.ts` его не проверяет, править нечего. Русский
перевод `docs/features/ru/assistant.md` не правили: в PR с поведением правится только английская страница.

## 8. Как проверено

Новые test-ы (`test/unit/assistant-speech-card.test.tsx`, новые блоки в `test/unit/assistant-speech.test.tsx` и
`test/unit/assistant-window.test.ts`, `test/contract/assistant-card-closed.test.ts`) были красными на коде origin/main:
16 упали, среди них «один × — пузыря нет». После правки: все unit и contract test-ы Assistant-а (39 файлов,
659 test-ов) — exit 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. e2e и Electron локально не запускали
(правило владельца).

## Проверить себя

1. Почему пункт с новым событием снова попадает в пузырь, хотя его id есть в отметке?
   - Ответ: отметка хранит число событий пункта на момент закрытия; новое событие меняет `events`, и `cardTold`
     перестаёт совпадать.
   - Строки: `src/main/assistant/window/view.ts:226`
2. Почему Snooze из пузыря не просит main запомнить пункт, а like — просит?
   - Ответ: Snooze сам выводит пункт из `new`, и когда он проснётся, пузырь должен о нём сказать; после like пункт
     остаётся `new`, и без отметки вернулся бы после перезапуска.
   - Строки: `src/renderer/assistant/useAssistant.ts:216-223`
3. Что увидит пользователь, обновившийся с 56 пунктами, и что сделает один ×?
   - Ответ: строку «56 waiting in Assistant» без пункта; × отправит все 56 id в main, вид снимет `cardBacklog`, и
     пузыря не будет до нового пункта.
   - Строки: `src/renderer/assistant/speech.ts:26-31`, `src/renderer/assistant/AssistantSpeech.tsx:73-74`
