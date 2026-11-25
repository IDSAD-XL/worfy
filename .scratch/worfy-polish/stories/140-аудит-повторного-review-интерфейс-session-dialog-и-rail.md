# Code story — worfy-polish 140: Аудит повторного review: интерфейс Session, Dialog и rail

Kind: pr · Epic: worfy-polish · Ticket: 140 · PR: - · Language: ru

## 1. Что было не так

Аудит повторного review (2026-11-13) оставил в разделе «Чинить сейчас» пять мелких ошибок интерфейса. Все пять были на
main 3c9c06e8c. Метка «not sent» в чате Product Session была цвета фона. Закрывающееся kit-окно забирало focus у нового
окна. Список Queued сам открывался, когда очередь снова наполнялась. Кнопка «Show all» не появлялась, когда полная
цитата заменяла обрезанную. Точка на кнопке Pipeline в rail горела для каждого Ticket в работе, даже когда его ждал агент.

- Требование: [Что происходит](../issues/140-аудит-повторного-review-интерфейс-session-dialog-и-rail.md#что-происходит)

## 2. Метка «not sent» красная, а не цвета фона

Code: `src/renderer/session/session.css:902-906` · key lines: 904

```css
/* Red text on the chat's ground: --danger, not --danger-text, the text on a danger fill (test/unit/contrast.test.ts) */
.w-pmsg--queued[data-status='not-sent'] .w-pmsg__queued {
  color: var(--danger);
  font-style: normal;
}
```

- Что делает: красит метку token-ом `--danger`: `#d70015` в светлой теме, `#ff6b5e` в тёмной.
- Почему здесь: Ticket называет это правило. `--danger-text` — цвет текста на красной заливке кнопки: белый в светлой
  теме и `#121110` в тёмной, то есть цвет фона чата в обеих.
- Без него: пользователь не видит, что сообщение не ушло.
- Требование: [Что делаем, п. 1](../issues/140-аудит-повторного-review-интерфейс-session-dialog-и-rail.md#что-делаем)
- Риски и пробелы test-ов: test проверяет контраст token-а с `--bg` и `--surface`. Сообщение в очереди целиком
  полупрозрачное (`opacity: 0.55`), и эта прозрачность в расчёт не входит; Ticket её не меняет.

## 3. Kit-окно возвращает focus, только если он потерян

Code: `src/renderer/theme/kit/Dialog.tsx:92-112` · key lines: 101, 104, 106

```tsx
  const previous = useRef<HTMLElement | null>(null)
  const shownPopup = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (open) previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [open])
  useEffect(() => {
    if (!open) return
    return () => {
      const back = previous.current
      const closing = shownPopup.current
      previous.current = null
      const focused = document.activeElement
      const lost = focused === null || focused === document.body || !focused.isConnected || closing?.contains(focused) === true
      // Without scrolling: a transcript scrolled away from the opener stays where it is.
      if (lost && back?.isConnected === true) back.focus({ preventScroll: true })
    }
  }, [open])

  // Base UI draws the window into its portal a render after `open`: the window is known here then.
  useLayoutEffect(() => {
    if (!open || popup === null) return
```

- Что делает: при закрытии окно смотрит, где сейчас focus. Если он остался в закрывающемся окне, упал на `body` или
  стоит на элементе, которого уже нет на странице, focus возвращается тому, что открыло окно. Если focus у другого
  элемента, например у более нового окна, окно его не трогает. Закрывающееся окно запоминается в `shownPopup`, когда
  оно показано.
- Почему здесь: Ticket называет возврат focus в `Dialog.tsx`; triage предлагает возвращать focus, только если он
  потерян.
- Без него: окно, закрытое под другим окном, уводит focus из нового окна на элемент страницы за ним.
- Требование: [Что делаем, п. 2](../issues/140-аудит-повторного-review-интерфейс-session-dialog-и-rail.md#что-делаем)
- Риски и пробелы test-ов: если пользователь сам перевёл focus на другой элемент страницы до закрытия окна, focus
  останется там. Модальное окно этого не даёт (focus trap Base UI), так что случай теоретический.

## 4. Список Queued закрывается вместе с очередью

Code: `src/renderer/session/composer/Queue.tsx:29-33` · key lines: 32

```tsx
  const empty = sessionId === null || queue === null || queue.items.length === 0
  // The list closes with the queue's last message: the next message queued shows the chip, and the list
  // does not open by itself and take the focus from the message field (worfy-polish ticket 140).
  if (empty && open) setOpen(false)
  if (empty) return null
```

- Что делает: когда очередь пустеет, `open` сбрасывается прямо во время render — так React поправляет своё состояние
  по props без лишнего effect-а. Следующее сообщение в очереди показывает chip, а не открытый список.
- Почему здесь: Ticket называет ранний `return null` в `Queue.tsx`. Раньше он прятал chip, а `open` оставался `true`.
- Без него: список сам открывается и забирает focus у поля ввода.
- Требование: [Что делаем, п. 3](../issues/140-аудит-повторного-review-интерфейс-session-dialog-и-rail.md#что-делаем)
- Риски и пробелы test-ов: нет.

## 5. Цитата перемеряется по тому тексту, который показан

Code: `src/renderer/session/QuotedPrompt.tsx:107-114` · key lines: 108, 114

```tsx
  // The whole quote this window sent, once it is known, replaces the one the agent got cut.
  const shown = squash(sent?.quote ?? quote)
  // «Show all» only when the three lines hide something; measured again when the whole quote replaces the cut one.
  useLayoutEffect(() => {
    const element = quoteRef.current
    if (element === null || open) return
    setClamped(element.scrollHeight > element.clientHeight + 1)
  }, [shown, open])
```

- Что делает: высота меряется заново, когда меняется показанный текст, а не только обрезанный `quote` из сообщения.
  Так же уже устроен соседний `CodeBlock` (`[shown, open]`).
- Почему здесь: Ticket называет `QuoteBlock`; triage предлагает добавить `sent?.quote` в зависимости.
- Без него: когда полная цитата этого окна заменяет обрезанную, высота не перемеряется, и «Show all» не появляется.
- Требование: [Что делаем, п. 4](../issues/140-аудит-повторного-review-интерфейс-session-dialog-и-rail.md#что-делаем)
- Риски и пробелы test-ов: jsdom не считает layout, поэтому test подменяет `scrollHeight` и `clientHeight`. Настоящая
  высота в окне Electron проверяется только e2e `quote-comments.spec.ts`, и замену цитаты он не проверяет.

## 6. Точка на rail — только для Ticket-ов, которые ждут человека

Code: `src/renderer/shell/sidebar/PipelineSection.tsx:53-54` · key lines: 54

```tsx
  // A Ticket an agent works on calls nobody: the dot counts those that wait for a person (worfy-polish ticket 140).
  const waiting = tickets.filter(waitsForPerson).length
```

- Что делает: считает Ticket ждущим, только если он заблокирован или ждёт не агента (`waitsForPerson` из
  `src/shared/ipc/project-pulse.ts`). Этим же правилом main считает `waits` в Project pulse.
- Почему здесь: Ticket называет строку и правило `waitsForPerson`. `waits` есть у каждого Ticket в работе: Stage агента
  даёт `agent`.
- Без него: точка горит постоянно, пока хоть один Ticket в работе, и перестаёт звать человека.
- Требование: [Что делаем, п. 5](../issues/140-аудит-повторного-review-интерфейс-session-dialog-и-rail.md#что-делаем)
- Риски и пробелы test-ов: нет.

## 7. Feature page говорит то же правило

Code: `docs/features/workflow.md:339-341` · key lines: 340

```md
  nor on Done; of the active Project alone while the sidebar's Project switcher is on one Project. Its rail icon has a dot
  while one of them is blocked or waits for a person (the owner, the team, a named one), not while it waits for an agent.
  A click opens the board of that Project. With no such Ticket it says "Nothing in work".
```

- Что делает: вместо «waits for someone» страница говорит, что точка горит для Ticket-а, который ждёт человека, и не
  горит, пока его ждёт агент.
- Почему здесь: Ticket, «Что делаем», п. 5, называет эту страницу; перевод `docs/features/ru/` не правится по ADR-0088.
- Без него: страница обещала бы точку для любого ожидания.
- Требование: [Что делаем, п. 5](../issues/140-аудит-повторного-review-интерфейс-session-dialog-и-rail.md#что-делаем)
- Риски и пробелы test-ов: текст страницы test-ом не сверяется.

## 8. Что сознательно не меняли

Finding 142 (Command palette забирает focus у Getting started) в triage слит со 141, но palette — не kit Dialog, и её
возврат focus свой (`src/renderer/palette/CommandPalette.tsx`). Прозрачность сообщения в очереди тоже не менялась:
finding 70 — только о цвете метки.

## 9. Как проверено

Каждый новый test сначала падал на коде origin/main, потом прошёл после правки: `contrast.test.ts` (4 красных: контраст
1.0–1.08), `kit-dialog.test.tsx` (focus уходил на открывшего), `composer-popovers.test.tsx` (список открывался сам,
`aria-expanded` было `true`), `quote-comments-ui.test.tsx` (нет «Show all»), `pipeline-board.test.tsx` (точка считала 4
Ticket-а вместо 2). Mutation: без проверки «focus в закрывающемся окне» падают три test-а возврата focus.
`pnpm lint && pnpm typecheck && pnpm test` — exit 0 (914 файлов, 20690 test-ов). E2e целыми spec-файлами (layers-dialog,
focus-sidebar, select, layers-popover, session-controls, session-two-windows, autopilot-queue, autopilot-start-modal,
quote-comments, changes-comments, product-session, pipeline, sidebar-rail) — 59 прошли, 4 упали в `layers-popover.spec.ts`
(demo Ticket Node не появляется на Canvas); те же 4 падают и с `src/` от origin/main на этой машине.

## Проверить себя

1. Почему проверка «focus внутри закрывающегося окна» нужна в условии `lost`, а не только «focus на `body`»?
   - Ответ: в момент cleanup Base UI ещё держит закрывающееся окно в DOM, и focus обычно стоит в нём. Без этой проверки
     окно, закрытое по Esc или кнопкой Close, не возвращало бы focus открывшему.
   - Строки: `src/renderer/theme/kit/Dialog.tsx:104-106`
2. Почему точка на rail горела для каждого Ticket в работе, хотя условие проверяло `waits !== null`?
   - Ответ: у Ticket в работе `waits` не бывает `null`: Stage агента даёт `agent`. Только `waitsForPerson` отделяет
     ожидание человека от работы агента.
   - Строки: `src/renderer/shell/sidebar/PipelineSection.tsx:54`
