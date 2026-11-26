# Code story — worfy-assistant 14: UI Assistant-а по принятому прототипу: раздел в rail и свои уведомления

Kind: pr · Epic: worfy-assistant · Ticket: 14 · PR: - · Language: ru

## 1. Что было не так

Ticket-ы 03–13 построили Assistant-а в main: ядро внимания, обязанности, предложения, журнал действий, расход, work
hours. Но в окне его не было: пользователь не видел, что ждёт, не мог отложить или отклонить пункт, поставить like или
dislike, прочитать журнал или текст Session до старта. Решение 17 spec-а: раздел в rail рядом с Canvas и свои
уведомления, отдельно от обычных toast-ов; решение 18: по прототипу, который принял владелец.

- Требование: [Что строить](../issues/14-ui-assistant-а-раздел-в-rail.md#что-строить)

## 2. Первый в rail, но окно открывается на Projects

Code: `src/renderer/shell/Sidebar.tsx:216-220` · key lines: 219

```tsx
  const active = pickSection(
    saved,
    ordered.map((section) => section.id),
    ordered.filter((section) => section.rail?.start !== false).map((section) => section.id),
  )
```

- Что делает: секция Assistant-а стоит первой (`order = 1`) и экспортирует `railDefault = false`; registry кладёт это
  в `rail.start`, и окно, где секцию ещё не выбирали, открывается на первой секции, где `start` не false, — на Projects.
- Почему здесь: ticket называет `Sidebar.tsx` и `registry.ts` среди своих файлов. Что окно начинает с Projects, а не с
  Assistant-а, — решено без владельца (раздел «Решено без владельца» ticket-а).
- Без него: каждое новое окно открывалось бы на разделе выключенного Assistant-а.
- Требование: [Готово, когда, пункт 1](../issues/14-ui-assistant-а-раздел-в-rail.md#готово-когда)
- Риски и пробелы test-ов: `test/unit/sidebar-scope.test.tsx` проверяет порядок и выбор на заглушках секций; на
  собранном приложении — `test/e2e/assistant.spec.ts` и `test/e2e/sidebar-rail.spec.ts`, их запускает только CI.

## 3. Like и dislike доходят до обязанности

Code: `src/main/assistant/window/view.ts:472-489` · key lines: 481, 483, 486

```ts
  rate(target: RatingTarget, rating: Rating | null): { id: string; text: string } | null {
    const key = ratingKey(target)
    const before = this.load().ratings.find((each) => each.key === key)
    const item = this.ratedItem(target)
    if (before?.rating === rating) {
      const rule = before?.rule === undefined ? undefined : this.deps.duties.rules().find((each) => each.id === before.rule)
      return rule === undefined ? null : { id: rule.id, text: rule.text }
    }
    // Taking a dislike back deletes the rule it wrote: the items it hid wait again.
    if (before?.rule !== undefined) this.deps.duties.deleteRule(before.rule)
    let rule: MemoryRule | null = null
    if (rating !== null && item !== null) rule = this.deps.duties.rate(item, rating)
    this.save((state) => {
      state.ratings = state.ratings.filter((each) => each.key !== key)
      if (rating !== null) state.ratings.push({ key, rating, at: this.deps.now(), ...(rule === null ? {} : { rule: rule.id }) })
    })
    return rule === null ? null : { id: rule.id, text: rule.text }
  }
```

- Что делает: оценка пункта или строки журнала идёт в `duties.rate` (Ticket 07): like считается обязанности, dislike
  пишет правило, которое прячет такие пункты. Оценка хранится в `<data>/assistant/window.json`, чтобы кнопка осталась
  нажатой; снятие dislike удаляет его правило.
- Почему здесь: spec, «Границы», 6: у каждого действия like и dislike, и они доходят до обязанности. Что снятие dislike
  удаляет правило — решено без владельца.
- Без него: dislike прятал бы пункт навсегда, без способа вернуть, или не доходил бы до обязанности вовсе.
- Требование: [Готово, когда, пункт 3](../issues/14-ui-assistant-а-раздел-в-rail.md#готово-когда)
- Риски и пробелы test-ов: оценка сообщения, предложения и сводки только хранится — обязанности у них нет.

## 4. Session стартует только по Start и ровно с показанным текстом

Code: `src/main/assistant/window/view.ts:526-538` · key lines: 527, 532

```ts
  start(request: { projectId: string; text: string; itemId: string | null; proposalId: string | null }): { projectId: string; nodeId: string; sessionId: string } {
    const started = this.deps.start(request.projectId, request.text)
    if (request.itemId !== null) {
      const item = this.allItems().find((each) => each.id === request.itemId)
      if (item !== undefined) {
        if (item.state === 'new') this.mark(item, 'seen')
        this.deps.duties.react(item, 'accepted')
      }
    }
    if (request.proposalId !== null && this.deps.proposals.list().some((proposal) => proposal.id === request.proposalId)) this.deps.proposals.remove(request.proposalId)
    this.changed()
    return { projectId: request.projectId, ...started }
  }
```

- Что делает: Start из окна Prepare передаёт текст, который пользователь видел (или исправил через Edit), без
  изменений в новую Session на Canvas Project-а; пункт отмечается как увиденный, обязанность получает «принято», а
  предложение уходит из списка.
- Почему здесь: spec, «Границы», 3: Session с текстом Assistant-а стартует только по щелчку пользователя.
- Без него: текст Session мог бы разойтись с тем, что пользователь прочитал.
- Требование: [Готово, когда, пункт 2](../issues/14-ui-assistant-а-раздел-в-rail.md#готово-когда)
- Риски и пробелы test-ов: старт настоящей Session (`sharedNodeSessions().create`) test-ами не проверен: в
  `test/unit/assistant-window.test.ts` она подменена; что окно отправляет ровно показанный или исправленный текст,
  проверяет `test/unit/assistant-panel.test.tsx` (mutant «отправить исходный текст» — красный).

## 5. Системное уведомление: только срочное, только в work hours, только когда worfy не впереди

Code: `src/main/assistant/window/notices.ts:33-48` · key lines: 34, 35, 39, 43

```ts
  look(view: AssistantView): void {
    if (!view.on || !view.workHours) return
    const due = view.items.filter((item) => item.urgent && item.state === 'new' && !this.done.has(item.id))
    if (due.length === 0) return
    for (const item of due) this.done.add(item.id)
    const tell = (): void => {
      for (const item of due) this.deps.show({ title: ASSISTANT_NOTE_TITLE, body: assistantNoteBody(item) }, () => this.deps.reveal())
    }
    const focused = this.deps.focused()
    if (typeof focused === 'boolean') {
      if (!focused) tell()
      return
    }
    focused.then((yes) => (yes ? undefined : tell())).catch((error: unknown) => console.warn('[assistant] a notification was not shown', error))
  }
}
```

- Что делает: на каждое изменение вида берёт срочные новые пункты, о которых ещё не говорил, и показывает системное
  уведомление с заголовком «worfy Assistant», если worfy не впереди. Пункт, увиденный впереди, позже не уведомляет;
  вне work hours и при выключенном Assistant-е — молчит, а пункт, пришедший ночью, ждёт начала work hours.
- Почему здесь: ticket называет `src/main/notify.ts`; показ и фокус берутся оттуда. Что считать срочным — решено без
  владельца: Run, который остановился, и сообщение источника с пометкой `urgent`.
- Без него: Assistant либо молчал бы о срочном, либо будил бы ночью и дублировал то, что пользователь уже видит.
- Требование: [Готово, когда, пункт 8](../issues/14-ui-assistant-а-раздел-в-rail.md#готово-когда)
- Риски и пробелы test-ов: настоящее системное уведомление Electron не показано ни одним test-ом; `focused` и `show`
  подменены.

## 6. Одна карточка у значка, остальное — число

Code: `src/renderer/assistant/speech.ts:11-28` · key lines: 12, 13, 24, 27

```ts
export function speechQueue(view: AssistantView | null, closed: ReadonlySet<string>, sectionShown: boolean): WindowItem[] {
  if (view === null || !view.on || sectionShown) return []
  return view.items.filter((item) => item.state === 'new' && !closed.has(item.id))
}

/**
 * The badge of the Assistant's rail button: while a card speaks, how many more wait behind it («+2»); without a card, how
 * many items wait. None while the Assistant is off, or nothing waits.
 */
export function assistantBadge(view: AssistantView | null, queue: readonly WindowItem[]): RailBadge | undefined {
  if (view === null || !view.on) return undefined
  if (queue.length > 0) {
    const more = queue.length - 1
    return more > 0 ? { tone: 'assistant', count: more, label: `${more} more from Assistant` } : undefined
  }
  const waiting = view.items.length
  return waiting > 0 ? { tone: 'assistant', count: waiting, label: waiting === 1 ? '1 item waits for you' : `${waiting} items wait for you` } : undefined
}
```

- Что делает: очередь карточек — новые пункты без закрытых; первая из них показывается карточкой у значка в rail, а
  значок показывает, сколько ещё ждёт за ней. Пока раздел открыт или Assistant выключен, карточек нет.
- Почему здесь: spec, «UI»: одна карточка за раз, остальное — число на значке.
- Без него: несколько карточек сразу закрывали бы окно, или пользователь не знал бы, что ждёт ещё.
- Требование: [Готово, когда, пункт 7](../issues/14-ui-assistant-а-раздел-в-rail.md#готово-когда)
- Риски и пробелы test-ов: положение и цвет карточки (`AssistantSpeech.tsx`, `assistant.css`) не проверены ни
  test-ом, ни screenshot-ом: приложение по правилу владельца не запускалось.

## 7. Что сознательно не менялось

Code: `src/main/assistant/window/app.ts:39-42` · key lines: 41

```ts
/** The Assistant while it runs; null while it is off. Ticket 10 (appAssistant) answers it. */
function runningAssistant(): AssistantConversation | null {
  return null
}
```

- Что делает: пока Ticket 10 (собственная Session Assistant-а, PR #2247) не влит, разговору не с кем говорить:
  отправка отвечает «Assistant is off on this machine», а поле ввода выключено.
- Почему здесь: brief оркестратора: не копировать код Ticket-а 10 в эту ветку; подключить `appAssistant()` после его
  merge.
- Без него: ветка зависела бы от неслитого PR.
- Требование: [Готово, когда, пункт 5](../issues/14-ui-assistant-а-раздел-в-rail.md#готово-когда)
- Риски и пробелы test-ов: пункт 5 не выполнен, пока здесь `null`.

## 8. Как проверено

- `node scripts/vitest-electron.mjs test/unit/assistant-window.test.ts` — exit 1 до кода (нет модуля), exit 0 после.
- `node scripts/vitest-electron.mjs test/unit/assistant-speech.test.tsx` — exit 1 без `speech.ts`, exit 0 с ним.
- `node scripts/vitest-electron.mjs test/unit/sidebar-scope.test.tsx` — test `railDefault` красный до правки
  `Sidebar.tsx` и `registry.ts`, зелёный после.
- `node scripts/vitest-electron.mjs test/unit/assistant-panel.test.tsx` — exit 0; mutant «Start отправляет исходный
  текст» — exit 1.
- `pnpm lint`, `pnpm typecheck` — exit 0; gate fast — exit 0, `[gate] green (fast)`.
- `test/e2e/assistant.spec.ts` (список, like, dislike, Undo) локально не запускался: e2e запускает CI.

## Проверить себя

1. Почему окно открывается на Projects, хотя Assistant стоит в rail первым?
   - Ответ: выбор по умолчанию берёт первую секцию, у которой `rail.start` не false, а секция Assistant-а
     экспортирует `railDefault = false`.
   - Строки: `src/renderer/shell/Sidebar.tsx:216-220`
2. Что происходит с правилом, когда пользователь снимает свой dislike?
   - Ответ: прежняя оценка хранит id правила, и `rate` удаляет его через `duties.deleteRule` до записи новой оценки —
     спрятанные пункты снова ждут.
   - Строки: `src/main/assistant/window/view.ts:480-481`
3. Придёт ли системное уведомление о срочном пункте, который появился, пока worfy был впереди, когда пользователь
   переключится в другое приложение?
   - Ответ: нет: пункт попадает в `done` при первом взгляде, ещё до проверки фокуса, и больше не рассматривается.
   - Строки: `src/main/assistant/window/notices.ts:35-37`
