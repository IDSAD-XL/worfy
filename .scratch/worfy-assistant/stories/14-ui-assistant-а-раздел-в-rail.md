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

## 3. Like и dislike доходят до обязанности, а снятая оценка снимает свой счёт

Code: `src/main/assistant/window/view.ts:494-516` · key lines: 504, 505, 506, 510

```ts
  rate(target: RatingTarget, rating: Rating | null): { id: string; text: string } | null {
    const key = ratingKey(target)
    const before = this.load().ratings.find((each) => each.key === key)
    const item = this.ratedItem(target)
    if (before?.rating === rating) {
      const rule = before?.rule === undefined ? undefined : this.deps.duties.rules().find((each) => each.id === before.rule)
      return rule === undefined ? null : { id: rule.id, text: rule.text }
    }
    // Taking a rating back uncounts it at its duty; a dislike's rule goes with it, and the items it hid wait again —
    // unless another rating still holds that rule (a dislike of the item and one of a journal row it caused).
    const held = before?.rule !== undefined && this.load().ratings.some((each) => each.key !== key && each.rule === before.rule)
    const ruleId = before?.rule === undefined || held ? null : before.rule
    if (before?.counted !== undefined) this.deps.duties.unrate(before.counted.duty, before.counted.item, before.rating, ruleId, before.counted.run)
    else if (ruleId !== null) this.deps.duties.deleteRule(ruleId)
    let rule: MemoryRule | null = null
    if (rating !== null && item !== null) rule = this.deps.duties.rate(item, rating)
    const counted = rating !== null && item !== null && item.duty !== null ? { duty: item.duty, item: item.id, run: this.deps.duties.runOf(item.duty) } : undefined
    this.save((state) => {
      state.ratings = state.ratings.filter((each) => each.key !== key)
      if (rating !== null) state.ratings.push({ key, rating, at: this.deps.now(), ...(rule === null ? {} : { rule: rule.id }), ...(counted === undefined ? {} : { counted }) })
    })
    return rule === null ? null : { id: rule.id, text: rule.text }
  }
```

- Что делает: оценка пункта или строки журнала идёт в `duties.rate` (Ticket 07): like считается обязанности, dislike
  пишет правило, которое прячет такие пункты. Запись оценки в `<data>/assistant/window.json` помнит, какой обязанности и
  какому пункту она засчитана (`counted`). Снятая оценка — Undo, повторное нажатие или смена like на dislike — идёт в
  `duties.unrate`. Та же оценка второй раз ничего не считает. Правило уходит, только если его не держит другая оценка —
  например dislike того же пункта и dislike строки журнала, которую он вызвал (review, раунд 2).
- Почему здесь: spec, «Границы», 6: у каждого действия like и dislike, и они доходят до обязанности. Что снятие оценки
  снимает её счёт — находка review, раунд 1.
- Без него: пять раз dislike и Undo ставили обязанность на паузу (`by: 'disliked'`), а like, снятие, like считали два
  like.
- Требование: [Готово, когда, пункт 3](../issues/14-ui-assistant-а-раздел-в-rail.md#готово-когда)
- Риски и пробелы test-ов: оценка сообщения, предложения и сводки только хранится — обязанности у неё нет. Один пункт,
  оценённый и в списке, и в журнале, — две разные оценки, и обязанность сочтёт обе.

## 4. Duties.unrate: что снимает снятая оценка

Code: `src/main/assistant/duties/duties.ts:280-295` · key lines: 287, 288, 289, 293

```ts
  unrate(duty: string, itemId: string, rating: 'like' | 'dislike', ruleId: string | null, run?: number): void {
    const memory = this.load()
    const state = memory.duties[duty]
    if (state !== undefined) {
      if (rating === 'like') state.counters.liked = Math.max(0, state.counters.liked - 1)
      else {
        state.counters.disliked = Math.max(0, state.counters.disliked - 1)
        if (run === (state.run ?? 0)) {
          state.streak = Math.max(0, state.streak - 1)
          if (state.paused?.by === 'disliked' && state.streak < (memory.pauseAfter ?? DEFAULT_PAUSE_AFTER)) delete state.paused
        }
      }
    }
    if (ruleId !== null) memory.rules = memory.rules.filter((rule) => rule.id !== ruleId || rule.from !== itemId)
    this.save()
  }
```

- Что делает: снимает like или dislike с обязанности: счётчик, для dislike — его шаг в серии dislike-ов и паузу, которую
  серия начала, если серия снова короче порога, но только пока идёт та же серия (`run`, номер серии, запомнен при оценке;
  review, раунд 2); правило удаляется, только если его написал этот пункт.
- Почему здесь: счётчики, серия и пауза живут в `Duties` (Ticket 07); review, раунд 1, предложил `Duties.unrate`.
- Без него: снятая оценка оставляла бы свой счёт, серию и паузу.
- Требование: [Готово, когда, пункт 3](../issues/14-ui-assistant-а-раздел-в-rail.md#готово-когда)
- Риски и пробелы test-ов: снятый like не возвращает серию проигнорированных предложений, которую он оборвал, —
  решено без владельца: это только отодвигает паузу.

## 5. Session стартует только по Start и ровно с показанным текстом

Code: `src/main/assistant/window/view.ts:553-565` · key lines: 554, 559

```ts
  start(request: { projectId: string; text: string; itemId: string | null; proposalId: string | null }): { projectId: string; nodeId: string; sessionId: string } {
    const started = this.deps.start(request.projectId, request.text)
    if (request.itemId !== null) {
      const item = this.allItems().find((each) => each.id === request.itemId)
      if (item !== undefined) {
        if (item.state === 'new') this.mark(item, 'seen')
        this.react(item, 'accepted')
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
- Без него: текст Session мог бы разойтись с тем, что пользователь прочитал; а окно Prepare называло бы Project пункта,
  хотя предложение Assistant-а может вести в другой Project — теперь оно показывает `prepare.projectName`, имя Project-а
  из `prepare.projectId` (находка review, раунд 1).
- Требование: [Готово, когда, пункт 2](../issues/14-ui-assistant-а-раздел-в-rail.md#готово-когда)
- Риски и пробелы test-ов: старт настоящей Session (`sharedNodeSessions().create`) test-ами не проверен: в
  `test/unit/assistant-window.test.ts` она подменена; что окно отправляет ровно показанный или исправленный текст,
  проверяет `test/unit/assistant-panel.test.tsx` (mutant «отправить исходный текст» — красный).

## 6. Системное уведомление: только срочное, только в work hours, только когда worfy не впереди

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

## 7. Одна карточка у значка, и показанным считается только то, что видно

Code: `src/renderer/assistant/speech.ts:11-25` · key lines: 13, 22, 23, 24

```ts
export function speechQueue(view: AssistantView | null, closed: ReadonlySet<string>, sectionShown: boolean): WindowItem[] {
  if (view === null || !view.on || sectionShown) return []
  return view.items.filter((item) => item.state === 'new' && !closed.has(item.id))
}

/**
 * The items the window shows the user now, which their duties count as shown (`assistant.shown`): the item of the speech
 * card, and every item of the list while the section is in front on its tab of what waits. Nothing while the Assistant is
 * off: its duties count nothing before the user turns it on.
 */
export function shownItemIds(view: AssistantView | null, sectionShown: boolean, tab: string, queue: readonly WindowItem[]): string[] {
  if (view === null || !view.on) return []
  if (sectionShown) return tab === 'waits' ? view.items.map((item) => item.id) : []
  return queue.length > 0 ? [queue[0]!.id] : []
}
```

- Что делает: очередь карточек — новые пункты без закрытых; первая из них показывается карточкой у значка в rail, а
  значок показывает, сколько ещё ждёт за ней. `shownItemIds` говорит, что окно сейчас показывает пользователю: пункт
  карточки или весь список, пока раздел открыт на вкладке Waits. Окно сообщает это в main (`assistant.shown`).
- Почему здесь: spec, «UI»: одна карточка за раз, остальное — число на значке. Что показанным считается только видимое,
  — находка review, раунд 1.
- Без него: несколько карточек сразу закрывали бы окно; а без `shownItemIds` обязанности считали бы показанным то, что
  никто не видел.
- Требование: [Готово, когда, пункт 7](../issues/14-ui-assistant-а-раздел-в-rail.md#готово-когда)
- Риски и пробелы test-ов: окно на заднем плане или свёрнутое тоже считается «показало». Положение и цвет карточки
  (`AssistantSpeech.tsx`, `assistant.css`) не проверены ни test-ом, ни screenshot-ом.

## 8. Показанное считает main, и только пока Assistant включён

Code: `src/main/assistant/window/view.ts:278-283` · key lines: 279, 282

```ts
  shown(itemIds: readonly string[]): void {
    if (this.deps.assistant() === null || itemIds.length === 0) return
    const ids = new Set(itemIds)
    const items = this.allItems().filter((item) => ids.has(item.id))
    if (items.length > 0) this.deps.duties.look(items)
  }
```

- Что делает: пункты, которые окно показало, обязанности считают показанными — только пока Assistant включён. Сам
  `view()` смотрит обязанности с `countShown: false`, поэтому фоновый цикл раз в минуту и системные уведомления ничего не
  считают. Open, Dismiss и Start тоже доходят до обязанности — и считают пункт показанным — только пока Assistant включён
  (review, раунд 2).
- Почему здесь: `view()` строят и фоновый цикл, и уведомления; review, раунд 1, показал, что через сутки такой счёт
  ставил обязанность на паузу (`ignored`) до того, как пользователь включил Assistant-а.
- Без него: обязанности замолкали бы сами, ни разу не показав пункт.
- Требование: [Готово, когда, пункт 3](../issues/14-ui-assistant-а-раздел-в-rail.md#готово-когда)
- Риски и пробелы test-ов: до переключателя Ticket-а 15 Assistant в приложении выключен, и ничего не считается; test-ы
  включают его подменой. Чтения Assistant-а (`worfy-app` items_list и action_run) и закрытый список тоже передают
  `countShown: false`.

## 9. Разговор идёт в собственную Session Assistant-а

Code: `src/main/assistant/window/app.ts:40-46` · key lines: 45

```ts
/**
 * The Assistant while it runs; null while it is off (ticket 10, appAssistant). Nothing in the app turns it on before the
 * switch of ticket 15, so until then the section says «Assistant is off on this machine» and refuses a message.
 */
function runningAssistant(): AssistantConversation | null {
  return appAssistant()
}
```

- Что делает: сообщение из раздела идёт в `appAssistant()` Ticket-а 10: оно будит Session Assistant-а с этим текстом, а
  ответ встаёт в разговор раздела. Пока Assistant выключен, `appAssistant()` отвечает null, и раздел отказывает с
  «Assistant is off on this machine».
- Почему здесь: brief оркестратора: подключить `appAssistant()` после merge Ticket-а 10 (PR #2247), не добавляя
  переключатель — его добавит Ticket 15.
- Без него: разговору не с кем было бы говорить.
- Требование: [Готово, когда, пункт 5](../issues/14-ui-assistant-а-раздел-в-rail.md#готово-когда)
- Риски и пробелы test-ов: `test/unit/assistant-window-app.test.ts` проверяет путь через настоящий `composeAssistant` с
  подменёнными Session-ами; настоящий Claude Code не запускался. В приложении Assistant не включается до Ticket-а 15.
  Тексты пробуждений — следующий шаг.

## 10. Тексты пробуждений Assistant-а встают в разговор

Code: `src/main/assistant/session/runner.ts:200-208` · key lines: 204, 205, 206

```ts
  loop = parts.startWake((wake) => {
    const message = wake.reason === 'user' ? said : undefined
    said = undefined
    lastRun = parts.sessions.wake(wake, message)
    const onRun = parts.onRun
    if (onRun !== undefined) {
      lastRun.then(onRun).catch((error: unknown) => console.warn('[assistant] the text of a run was not passed on', error))
    }
  })
```

- Что делает: `composeAssistant` Ticket-а 10 сообщает необязательному `onRun` о каждом законченном прогоне: пробуждении
  или сообщении пользователя. `startAssistant` передаёт прогоны слушателям `onAssistantRun`, а раздел (`followAssistantRuns`
  в `src/main/assistant/window/app.ts`) кладёт текст ответившего пробуждения в разговор через `noteWakeRun`: утренний ещё
  и в сводку. Ответ на сообщение пользователя второй раз не пишется, прогон без ответа ничего не пишет.
- Почему здесь: `composeAssistant` держит прогон пробуждения внутри (`lastRun`), другого места, где виден его текст, нет;
  оркестратор попросил закрыть этот пробел в этом PR.
- Без него: утренняя сводка и пакетные сообщения Assistant-а не попадали бы в раздел.
- Требование: [Готово, когда, пункт 5](../issues/14-ui-assistant-а-раздел-в-rail.md#готово-когда)
- Риски и пробелы test-ов: без `onRun` поведение Session Ticket-а 10 не меняется. Путь `startAssistant` → слушатели не
  покрыт test-ом: `startAssistant` собран из синглтонов приложения; покрыты `composeAssistant` с `onRun`, `noteWakeRun` и
  `followAssistantRuns`.

## 11. Как проверено

- `node scripts/vitest-electron.mjs test/unit/assistant-window.test.ts` — exit 1 до кода (нет модуля), exit 0 после.
- `node scripts/vitest-electron.mjs test/unit/assistant-speech.test.tsx` — exit 1 без `speech.ts`, exit 0 с ним.
- `node scripts/vitest-electron.mjs test/unit/sidebar-scope.test.tsx` — test `railDefault` красный до правки
  `Sidebar.tsx` и `registry.ts`, зелёный после.
- `node scripts/vitest-electron.mjs test/unit/assistant-panel.test.tsx` — exit 0; mutant «Start отправляет исходный
  текст» — exit 1.
- `pnpm lint`, `pnpm typecheck` — exit 0; gate fast — exit 0, `[gate] green (fast)`.
- Review, раунд 1: новые test-ы в `test/unit/assistant-window.test.ts`, `assistant-panel.test.tsx` и
  `assistant-speech.test.tsx` красные до правки (9 и 6 упавших), зелёные после; семь mutant-ов правок раунда — каждый
  даёт exit 1.
- Review, раунд 2: три новых test-а красные до правки, зелёные после; три mutant-а (правило, которое держит другая оценка;
  номер серии; реакция при выключенном Assistant-е) — exit 1.
- После merge Ticket-а 10: `test/unit/assistant-window-app.test.ts` красный, пока `runningAssistant()` отвечал null,
  зелёный после; два test-а в `test/contract/worfy-app-tools.test.ts` (items_list и action_run ничего не считают
  показанным) красные до правки (5 показанных), зелёные после; `pnpm build` — exit 0.
- Тексты пробуждений: пять новых test-ов (`assistant-session`, `assistant-window`, `assistant-window-app`) красные до
  правки, зелёные после; два mutant-а фильтра `noteWakeRun` — exit 1.
- `test/e2e/assistant.spec.ts` (список, like, dislike, Undo) локально не запускался: e2e запускает CI.

## Проверить себя

1. Почему окно открывается на Projects, хотя Assistant стоит в rail первым?
   - Ответ: выбор по умолчанию берёт первую секцию, у которой `rail.start` не false, а секция Assistant-а
     экспортирует `railDefault = false`.
   - Строки: `src/renderer/shell/Sidebar.tsx:216-220`
2. Почему пять раундов dislike и Undo больше не ставят обязанность на паузу?
   - Ответ: запись оценки помнит, кому она засчитана, и снятие идёт в `duties.unrate`: оно снимает счётчик, шаг серии
     dislike-ов и паузу, которую серия начала, и удаляет правило этого пункта.
   - Строки: `src/main/assistant/window/view.ts:504-506`
3. Придёт ли системное уведомление о срочном пункте, который появился, пока worfy был впереди, когда пользователь
   переключится в другое приложение?
   - Ответ: нет: пункт попадает в `done` при первом взгляде, ещё до проверки фокуса, и больше не рассматривается.
   - Строки: `src/main/assistant/window/notices.ts:35-37`
