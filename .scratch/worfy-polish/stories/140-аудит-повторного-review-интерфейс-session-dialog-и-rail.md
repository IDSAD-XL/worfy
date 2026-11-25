# Code story — worfy-polish 140: Аудит повторного review: интерфейс Session, Dialog и rail

Kind: pr · Epic: worfy-polish · Ticket: 140 · PR: - · Language: ru

## 1. Что было не так

Аудит повторного review (2026-11-13) оставил в разделе «Чинить сейчас» пять мелких ошибок интерфейса. Все пять были на
main 3c9c06e8c. Метка «not sent» в чате Product Session была цвета фона, и всё сообщение было приглушено. Закрывающееся
kit-окно забирало focus у нового окна и у элемента, на который его поставила команда Command palette. Список Queued сам открывался, когда очередь снова наполнялась. Кнопка «Show all» не появлялась, когда полная
цитата заменяла обрезанную. Точка на кнопке Pipeline в rail горела для каждого Ticket в работе, даже когда его ждал агент.

- Требование: [Что происходит](../issues/140-аудит-повторного-review-интерфейс-session-dialog-и-rail.md#что-происходит)

## 2. Сообщение «not sent» не приглушено, его метка красная

Code: `src/renderer/session/session.css:889-909` · key lines: 893, 894, 907

```css
/*
 * A message still in the Session's queue (ticket 28): the owner's bubble, dimmed, last in the chat. One not
 * sent is an error the user must see: it is not dimmed, and its label stays readable (worfy-polish ticket 140).
 */
.w-pmsg--queued:not([data-status='not-sent']) {
  opacity: 0.55;
}

.w-pmsg--queued .w-pmsg__bubble {
  border-style: dashed;
}

.w-pmsg__queued {
  font-style: italic;
}

/* Red text on the chat's ground: --danger, not --danger-text, the text on a danger fill (test/unit/contrast.test.ts) */
.w-pmsg--queued[data-status='not-sent'] .w-pmsg__queued {
  color: var(--danger);
  font-style: normal;
}
```

- Что делает: приглушает (`opacity: 0.55`) только сообщения, которые ещё ждут в очереди; сообщение «not sent» рисуется
  в полную силу. Метку «not sent» красит token `--danger`: `#d70015` в светлой теме, `#ff6b5e` в тёмной.
- Почему здесь: Ticket называет оба правила. `--danger-text` — цвет текста на красной заливке кнопки: белый в светлой
  теме и `#121110` в тёмной, то есть цвет фона чата в обеих. Review нашёл, что и красный `--danger` под
  `opacity: 0.55` виден с контрастом 2.7–2.9:1; сообщение, которое не ушло, — ошибка, её не приглушают.
- Без него: пользователь не видит, что сообщение не ушло.
- Требование: [Что делаем, п. 1](../issues/140-аудит-повторного-review-интерфейс-session-dialog-и-rail.md#что-делаем)
- Риски и пробелы test-ов: `test/unit/contrast.test.ts` разбирает правила `session.css` сам: правило, объявленное
  позже, побеждает, specificity не считается, а правило внутри `@media` считается действующим всегда. Для элементов
  сообщения этого хватает; новое правило с более сильным селектором выше по файлу test может прочитать неверно.
  Настоящий вид проверяет e2e `product-session.spec.ts`: цвет метки и opacity 1 в собранном приложении, снимки в обеих темах.

## 3. Kit-окно возвращает focus, только если он потерян

Code: `src/renderer/theme/kit/Dialog.tsx:93-113` · key lines: 102, 105, 107

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
      const lost = focused === null || focused === document.body || closing?.contains(focused) === true
      // Without scrolling: a transcript scrolled away from the opener stays where it is.
      if (lost && back?.isConnected === true) back.focus({ preventScroll: true })
    }
  }, [open])

  // Base UI draws the window into its portal a render after `open`: the window is known here then.
  useLayoutEffect(() => {
    if (!open || popup === null) return
```

- Что делает: при закрытии окно смотрит, где сейчас focus. Если он остался в закрывающемся окне или упал на `body`,
  focus возвращается тому, что открыло окно. Элемент, снятый со страницы, оставляет focus на `body`, поэтому отдельной
  проверки для него нет. Если focus у другого элемента — у более нового окна или у элемента, на который его поставило
  действие окна, — окно его не трогает. Закрывающееся окно запоминается в `shownPopup`, когда оно показано.
- Почему здесь: Ticket называет возврат focus в `Dialog.tsx`; triage предлагает возвращать focus, только если он
  потерян. Command palette тоже открыта в kit Dialog (`CommandPalette.tsx:40`, `:499`), поэтому та же правка закрывает
  finding 142.
- Без него: окно, закрытое под другим окном, уводит focus из нового окна на элемент страницы за ним; palette,
  закрытая своей командой, забирает focus у того, что команда сфокусировала.
- Требование: [Что делаем, п. 2](../issues/140-аудит-повторного-review-интерфейс-session-dialog-и-rail.md#что-делаем)
- Риски и пробелы test-ов: случай 142 проверен на пробном окне `kit-dialog.test.tsx`, а не на настоящей команде
  «Getting started». Та фокусирует заголовок панели после ответа main, когда palette уже закрыта.

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

Своего возврата focus у Command palette нет, её закрывает kit Dialog, поэтому сама palette и команда «Getting started»
не менялись. Сообщения, которые ещё ждут в очереди, по-прежнему приглушены.

## 9. Как проверено

Каждый новый test сначала падал на коде origin/main, потом прошёл после правки: `contrast.test.ts` (контраст 1.0–1.08;
после первого раунда review — 5 красных на CSS предыдущего head: opacity 0.55, контраст 2.7–2.9), `kit-dialog.test.tsx`
(focus уходил на открывшего, в том числе с элемента, который сфокусировало действие окна), `composer-popovers.test.tsx` (список открывался сам,
`aria-expanded` было `true`), `quote-comments-ui.test.tsx` (нет «Show all»), `pipeline-board.test.tsx` (точка считала 4
Ticket-а вместо 2). Mutation: без проверки «focus в закрывающемся окне» падают три test-а возврата focus.
`pnpm lint && pnpm typecheck && pnpm test` — exit 0 (914 файлов, 20690 test-ов). E2e целыми spec-файлами (layers-dialog,
focus-sidebar, select, layers-popover, session-controls, session-two-windows, autopilot-queue, autopilot-start-modal,
quote-comments, changes-comments, product-session, pipeline, sidebar-rail) — 59 прошли, 4 упали в `layers-popover.spec.ts`
(demo Ticket Node не появляется на Canvas); те же 4 падают и с `src/` от origin/main на этой машине. После раунда review
`product-session.spec.ts` целиком — 13/13, exit 0, со снимками «queued» и «not sent» в обеих темах.

## Проверить себя

1. Почему проверка «focus внутри закрывающегося окна» нужна в условии `lost`, а не только «focus на `body`»?
   - Ответ: в момент cleanup Base UI ещё держит закрывающееся окно в DOM, и focus обычно стоит в нём. Без этой проверки
     окно, закрытое по Esc или кнопкой Close, не возвращало бы focus открывшему.
   - Строки: `src/renderer/theme/kit/Dialog.tsx:105-107`
2. Почему точка на rail горела для каждого Ticket в работе, хотя условие проверяло `waits !== null`?
   - Ответ: у Ticket в работе `waits` не бывает `null`: Stage агента даёт `agent`. Только `waitsForPerson` отделяет
     ожидание человека от работы агента.
   - Строки: `src/renderer/shell/sidebar/PipelineSection.tsx:54`

## 10. Что нашёл review и что осталось

> VERIFIED — worfy-polish 140 (audit findings 70, 141 with 142, 189, 187, 133: the «not sent» label, focus after a kit Dialog closes, the Queued list reopening, «Show all» of a replaced quote, the Pipeline rail dot), head f45d193e2d7bd8a3242b709c10b4cb865859d040
>
> Gate (depth medium, two rounds): reviewer (lens: correctness) — MERGE with three lows; the Orchestrator sent finding 70 back (the label was red but at 2.7–2.9:1 under the 0.55 opacity of a queued message) with the palette note and the uncovered isConnected check; round 1 checked by the Orchestrator against the diff 95bac09cc..f45d193e2 and the screenshots.
>
> - What the user sees: a «not sent» message is no longer dimmed and its label is red in both themes (a waiting queued message stays dimmed); a kit Dialog that closes under a newer one, or after its action moved the focus, leaves the focus where it is — this covers the Command palette too (finding 142); the Queued list does not reopen by itself after the queue empties; «Show all» appears when the whole quote replaces the cut one; the Pipeline rail dot and «N Tickets wait» count only Tickets that are blocked or wait for a person.
> - Evidence: every new test red on origin/main code; reviewer 8 of 9 mutants caught in round 1 (the ninth, isConnected, is removed in round 1); contrast test computes the blended contrast the user sees (red on the old CSS, 5 failed, green after); kit-dialog 25 passed; 269 tests of the touched files EXIT=0; e2e product-session.spec.ts whole 13/13 EXIT=0 with a new not-sent case; lint, typecheck EXIT=0; gate fast green on f45d193e2; story-check ok; four screenshots looked at by the Orchestrator (fixture text only).
> - Not verified: the real «Getting started» command after the palette closes (a test window stands in).
