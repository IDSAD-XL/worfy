# Code story — worfy-assistant 25: Части прототипа, не вошедшие в Ticket 15: настройки уведомлений, Undo применённой карточки, Project-ы обязанности, «On since …»

Kind: pr · Epic: worfy-assistant · Ticket: 25 · PR: - · Language: ru

## 1. Что было не так

Ticket 15 построил Settings → Assistant по принятому прототипу-Card, но четыре части прототипа не вошли. Пользователь не
мог сузить или выключить уведомления Assistant-а, не мог отменить применённую карточку «было → станет», не мог выбрать
Project-ы обязанности, и рядом с переключателем не было «On since …». Владелец 2026-11-26 (Q4) решил достроить их.

- Требование: [Что происходит](../issues/25-части-прототипа-не-вошедшие-в-ticket-15.md#что-происходит)

## 2. Apply запоминает, что было до него

Code: `src/main/assistant/window/view.ts:634-640` · key lines: 637, 639

```ts
    const now = settings.now()
    const rows = changeRows(proposal.change, now)
    // What Undo puts back (ticket 25): each setting the change names, as it is before this Apply.
    const before = changeBefore(proposal.change, now)
    settings.apply(proposal.change)
    this.deps.proposals.update(proposalId, { applied: { at: this.deps.now(), rows, before } })
    this.changed()
```


- Что делает: перед тем как применить изменение, берёт значение в силе каждой настройки, которую карточка называет
  (`changeBefore`), и кладёт его в отметку Apply предложения рядом с рядами и временем (`applied.before`).
- Почему здесь: ticket велит Undo идти тем же путём, что Apply (`AssistantWindow.apply` → настройки машины и
  `Duties.configure`), и называет `src/main/assistant/window/view.ts` в «Где в коде». Брать «было» в момент Apply, а не
  из рядов карточки: ряды — слова, а Undo нужны значения.
- Без него: после Apply неизвестно, к чему возвращаться; ряды «было» — текст вроде «Every 10 min».
- Требование: [Что строить, пункт 2](../issues/25-части-прототипа-не-вошедшие-в-ticket-15.md#что-строить)
- Риски и пробелы test-ов: значение по умолчанию, которое пользователь не выбирал, Undo запишет как выбранное — поведение
  то же, решение 2 в «Решено без владельца». Предложение, применённое до этого Ticket-а, `before` не имеет; test
  `a card applied before Undo existed keeps no Undo` это проверяет.

## 3. Undo: отказ целиком, если настройка сдвинулась после Apply

Code: `src/main/assistant/window/view.ts:650-676` · key lines: 657, 658, 659, 660, 661

```ts
  undo(proposalId: string): void {
    const proposal = this.deps.proposals.list().find((each) => each.id === proposalId)
    if (proposal === undefined) throw new Error('This proposal is no longer there')
    if (proposal.change == null || proposal.applied == null) throw new Error('This change is not applied')
    if (proposal.applied.before === undefined) throw new Error('This change was applied before Undo existed: change it back in Settings → Assistant')
    const settings = this.deps.settings
    if (settings === undefined) throw new Error('Settings cannot be changed here')
    const moved = changedSince(proposal.change, settings.now())
    if (moved.length > 0) throw new Error(`Changed since Apply, so Undo would overwrite it: ${moved.join(', ')}. Change it in Settings → Assistant`)
    settings.apply(proposal.applied.before)
    this.deps.proposals.update(proposalId, { applied: null })
    this.deps.record?.({
      at: this.deps.now(),
      action: SETTINGS_UNDO_ACTION,
      by: 'user',
      item: `proposal:${proposal.id}`,
      duty: null,
      projectId: null,
      itemKind: null,
      itemText: `Before → after card: ${proposal.title}`,
      mode: null,
      sessionId: null,
      outcome: 'done',
      detail: proposal.applied.rows.map((row) => `${row.label}: ${row.after} → ${row.before}`).join('; '),
    })
    this.changed()
  }
```


- Что делает: сверяет каждую настройку карточки с тем, что дал ей Apply (`changedSince`). Если хоть одна уже другая,
  отказывает и называет её; иначе применяет `before` тем же `settings.apply`, снимает отметку Apply (карточка снова с
  Apply, как `undoapply` прототипа) и пишет строку журнала «Undid the settings change».
- Почему здесь: бриф Orchestrator-а требует отказ, если настройки сдвинулись после Apply; ticket оставил выбор агенту с
  рекомендацией вернуть остальные — выбран отказ целиком, причина в «Решено без владельца», пункт 1.
- Без него: Undo молча затёр бы выбор пользователя или другой карточки, сделанный после Apply.
- Требование: [Что строить, пункт 2](../issues/25-части-прототипа-не-вошедшие-в-ticket-15.md#что-строить)
- Риски и пробелы test-ов: две карточки по одной настройке проверены (test `Undo is refused whole`); гонки двух
  щелчков Undo из двух окон не проверены — оба идут в один main, второй получит «This change is not applied».

## 4. «Сдвинулась» — значение в силе не равно тому, что дала карточка

Code: `src/shared/assistant/settings-change.ts:254-259` · key lines: 256, 257

```ts
/** The labels of the settings the change named that no longer hold the value it gave them: changed since its Apply. */
export function changedSince(change: SettingsChange, now: SettingsNow): string[] {
  return namedSettings(change, now)
    .filter((setting) => !sameSetting(setting.after, setting.now))
    .map((setting) => setting.label)
}
```


- Что делает: для каждой названной настройки сравнивает значение карточки со значением в силе сейчас; сравнение идёт по
  JSON с отсортированными ключами (`sameSetting`), так что work hours с полями в другом порядке равны.
- Почему здесь: файл назван в «Где в коде» как то, «что может назвать карточка»; там же `changeRows`, и подписи
  настроек у отказа те же, что у рядов карточки.
- Без него: Undo не отличил бы свою настройку от изменённой позже.
- Требование: [Что строить, пункт 2](../issues/25-части-прототипа-не-вошедшие-в-ticket-15.md#что-строить)
- Риски и пробелы test-ов: настройка, изменённая и возвращённая к значению карточки, считается не сдвинутой — так
  решено; отдельного test-а на этот случай нет.

## 5. Уведомления в окне: выбор сужает очередь карточек-реплик

Code: `src/renderer/assistant/speech.ts:14-17` · key lines: 15, 16

```ts
export function speechQueue(view: AssistantView | null, closed: ReadonlySet<string>, sectionShown: boolean, inWindow: InWindowNotices = 'batched'): WindowItem[] {
  if (view === null || !view.on || sectionShown || inWindow === 'none') return []
  return view.items.filter((item) => item.state === 'new' && !closed.has(item.id) && (inWindow === 'batched' || item.urgent))
}
```


- Что делает: `none` — карточек нет; `urgent` — только срочные; `batched` — как было. Значок считает то, что ждёт, сам
  (`assistantBadge`), поэтому при `none` число на значке остаётся.
- Почему здесь: ticket называет `speech.ts` среди уведомлений Ticket-а 14; выбор живёт в поле `assistant` настроек
  машины, окно читает его через `useAppSettings(inWindowOf)` в `AssistantSpeech.tsx`.
- Без него: выбор «In the window» в Settings ни на что бы не действовал.
- Требование: [Что строить, пункт 1](../issues/25-части-прототипа-не-вошедшие-в-ticket-15.md#что-строить)
- Риски и пробелы test-ов: компонент `AssistantSpeech` с выбором в jsdom не проверен; проверена функция очереди и
  значок.

## 6. Системные уведомления: выключенные не показывают и срочного

Code: `src/main/assistant/window/notices.ts:38-44` · key lines: 43

```ts
  look(view: AssistantView): void {
    if (!view.on || !view.workHours) return
    const due = view.items.filter((item) => item.urgent && item.state === 'new' && !this.done.has(item.id))
    if (due.length === 0) return
    for (const item of due) this.done.add(item.id)
    if (this.deps.allowed?.() === false) return
    const tell = (): void => {
```


- Что делает: пункты, о которых пора сказать, отмечаются сказанными, и при выключенных уведомлениях на этом всё.
  Правила Ticket-ов 14 и 23 — только срочное, только в work hours, остановка пользователем не срочная — стоят выше и не
  тронуты.
- Почему здесь: ticket называет `notices.ts`; `allowed` читает `systemNoticesOf` настроек машины
  (`src/main/assistant/window/app.ts`).
- Без него: переключатель «System notifications» ни на что бы не действовал.
- Требование: [Решения](../issues/25-части-прототипа-не-вошедшие-в-ticket-15.md#решения)
- Риски и пробелы test-ов: пункт, пришедший при выключенных уведомлениях, после включения не догоняет — так решено
  (пункт 9 «Решено без владельца») и проверено test-ом.

## 7. Project-ы обязанности: у каких обязанностей и какие

Code: `src/main/assistant/settings/panel.ts:54-73` · key lines: 56, 67, 70, 71, 72

```ts
export function dutyScopedByProject(duty: Pick<DutyStatus, 'projectId' | 'trigger'>): boolean {
  if (duty.projectId !== null || duty.trigger.kind !== 'items') return false
  return duty.trigger.match.every((each) => !OUTSIDE_SOURCES.has(each.source))
}

/**
 * Checks a choice of Projects of a duty before Duties.configure (ticket 25): only a duty scoped by Project takes one, and
 * only Projects of this Machine — a Linked machine's items are only read here (ticket 18). Throws, with the reason.
 */
export function checkDutyProjects(dutyId: string, choice: DutyChoice, deps: { duties: Pick<Duties, 'look'>; projects(): readonly { id: string }[] }): void {
  if (choice.projects === undefined) return
  const duty = deps.duties.look([], { countShown: false }).duties.find((each) => each.id === dutyId)
  if (duty === undefined) throw new Error(`There is no duty ${dutyId}`)
  if (!dutyScopedByProject(duty)) throw new Error(`The duty «${duty.title}» does not cover Projects`)
  if (choice.projects === 'all') return
  if (choice.projects.length === 0) throw new Error('Choose at least one Project, or All Projects')
  const known = new Set(deps.projects().map((project) => project.id))
  const foreign = choice.projects.filter((id) => !known.has(id))
  if (foreign.length > 0) throw new Error(`Not a Project of this Machine: ${foreign.join(', ')}`)
}
```


- Что делает: выбор Project-ов есть только у встроенной обязанности над источниками worfy; main принимает только
  Project-ы этой Machine и непустой список. Вид Settings получает `projects` каждой обязанности (`null`, если выбора
  нет) и список Project-ов Machine.
- Почему здесь: ticket говорит, что Project-ы Linked machine в выборе не участвуют; проверка стоит перед
  `Duties.configure` в `src/main/assistant/settings/app.ts`. Почему не у Slack и Jira — их пункты без Project-а
  (пункт 7 «Решено без владельца»).
- Без него: id Project-а другой Machine или пустой список дошли бы до файла памяти, а суженная обязанность Slack
  скрыла бы все свои пункты.
- Требование: [Что строить, пункт 3](../issues/25-части-прототипа-не-вошедшие-в-ticket-15.md#что-строить)
- Риски и пробелы test-ов: список Project-ов берётся в момент щелчка; Project, удалённый между показом и щелчком,
  main отклонит, и toast скажет почему. Если все выбранные Project-ы удалены из worfy, `Duties.scopeOf` читает область
  как All Projects — и в фильтре, и в Settings (решение 8а; test-ы `a scope whose every Project was removed` и
  `a duty whose picked Projects were all removed`).

## 8. «On since …»: время ставит main, патч его не несёт

Code: `src/shared/assistant/settings.ts:83-93` · key lines: 85, 88

```ts
export function assistantAfter(current: AssistantState | undefined, patch: AssistantChoice | undefined, now: number): AssistantState | undefined {
  const on = patch?.on ?? current?.on
  const turnedOn = on === true && current?.on !== true
  return tidyAssistant({
    on,
    onSince: turnedOn ? now : current?.onSince,
    dailyWakeLimit: patch?.dailyWakeLimit ?? current?.dailyWakeLimit,
    inWindow: patch?.inWindow ?? current?.inWindow,
    systemNotices: patch?.systemNotices ?? current?.systemNotices,
  })
}
```


- Что делает: при переходе переключателя из выключенного во включённый ставит `onSince = now`, пока включён — держит,
  при выключении `tidyAssistant` его роняет. Схема патча `appSettings.set` поля `onSince` не знает.
- Почему здесь: ticket велит main записывать время включения и стирать при выключении; поле `assistant` названо в
  «Где в коде». Часы — опция `now` store-а (`src/main/settings/store.ts`).
- Без него: renderer мог бы прислать любое время, а выключение оставляло бы старое.
- Требование: [Что строить, пункт 4](../issues/25-части-прототипа-не-вошедшие-в-ticket-15.md#что-строить)
- Риски и пробелы test-ов: текст «On since …» по дням (вчера, день недели, дата) проверен только для «today»; другие
  ветви `onSinceText` test-ом не покрыты.

## 9. Что сознательно не меняли

- Карточка «было → станет» не меняет область Project-ов (решение 3 Ticket-а 15 остаётся, пункт 6 «Решено без
  владельца»).
- Apply строки журнала не пишет — только Undo.
- Правила самих уведомлений (одна карточка за раз, системное — только срочное и в work hours) не тронуты: выбор только
  сужает их.

## 10. Как проверено

- Новые и изменённые test-ы на коде `origin/main`: 21 красный (`node scripts/vitest-electron.mjs` по шести файлам —
  exit 1); на ветке — зелёные.
- `node scripts/vitest-electron.mjs test/unit/settings-assistant.test.tsx test/unit/assistant-window.test.ts
  test/unit/assistant-duties.test.ts test/unit/assistant-settings-panel.test.ts test/unit/assistant-speech.test.tsx
  test/contract/assistant-settings.test.ts` — exit 0.
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0; `gate fast` — exit 0, `[gate] green (fast)`.
- e2e `test/e2e/assistant.spec.ts` (Apply, затем Undo) изменён, локально не запускался — его гоняет CI.

## Проверить себя

1. Почему Undo отказывает, если после Apply применили вторую карточку по той же настройке, и как вернуть всё назад?
   - Строки: `src/main/assistant/window/view.ts:657-658`
   - Ответ: `changedSince` видит, что интервал уже не тот, что дала первая карточка, и Undo отказывает целиком. Сначала
     Undo второй карточки (она вернёт значение первой), потом Undo первой.
2. Почему при «None: the list only» число на значке Assistant-а не пропадает?
   - Строки: `src/renderer/assistant/speech.ts:14-17`
   - Ответ: `none` опустошает только очередь карточек; значок без карточки считает все ждущие пункты вида.
3. Может ли renderer задать «On since …» сам?
   - Строки: `src/shared/assistant/settings.ts:83-93`
   - Ответ: нет — `assistantAfter` читает только `on` патча и ставит время сам, при переходе из выключенного во
     включённый.
