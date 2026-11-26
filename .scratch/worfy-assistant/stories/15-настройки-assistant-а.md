# Code story — worfy-assistant 15: Настройки Assistant-а и карточки «было → станет» с Apply

Kind: pr · Epic: worfy-assistant · Ticket: 15 · PR: - · Language: ru

## 1. Что было не так

У Assistant-а не было раздела Settings. Его нельзя было включить: `startAssistant()` не звал никто, и раздел в rail
всегда говорил «Assistant is off on this machine». Work hours, проверки, режимы обязанностей, дневной предел
пробуждений и подробности расхода жили в main, но человек их не видел и не менял. Assistant не мог предложить
изменение настроек так, чтобы его применил только щелчок пользователя. Проверка Slack или Jira после трёх неудач
подряд (Ticket 22) уходила в backoff молча: число неудач и кнопку Check now не показывало ничего.

- Требование: [Что строить](../issues/15-настройки-assistant-а.md#что-строить)

## 2. Переключатель запускает и останавливает Assistant и говорит об этом разделу

Code: `src/main/assistant/session/switch.ts:28-50` · key lines: 34, 36, 41

```ts
export function followAssistantSwitch(deps: AssistantSwitchDeps): () => void {
  let stop: (() => void) | null = null
  const log = deps.log ?? ((message: string) => console.warn(`[assistant] ${message}`))
  const follow = (): void => {
    const on = deps.on()
    if (on && stop === null) {
      stop = deps.start()
      if (stop === null) return log('the Assistant did not start: the attention core is not running')
      deps.changed()
    } else if (!on && stop !== null) {
      const running = stop
      stop = null
      running()
      deps.changed()
    }
  }
  const unfollow = deps.onChange(follow)
  follow()
  return () => {
    unfollow()
    const running = stop
    stop = null
    running?.()
```

- Что делает: при старте worfy и при каждом изменении настроек машины сверяет поле `assistant.on` с тем, работает ли
  Assistant; включённый, но не запущенный — запускает (`startAssistant`), выключенный, но работающий — останавливает.
  После каждого запуска и остановки зовёт `changed()` — в приложении это `AssistantWindow.changed()`.
- Почему здесь: бриф велит звать `AssistantWindow.changed()` при запуске и остановке из настроек; комментарий
  `src/main/assistant/session/app.ts` до правки называл переключатель Ticket-ом 15. Отдельная функция с зависимостями —
  чтобы test проверял поведение без Electron.
- Без него: Assistant нельзя включить, а раздел в rail после включения ещё до минуты показывал бы «off».
- Требование: [Что строить, пункты 1 и 8](../issues/15-настройки-assistant-а.md#что-строить)
- Риски и пробелы test-ов: запуск в приложении (`startAssistantSwitch` в `src/main/index.ts`) проверяет только e2e
  и сборка; unit test идёт по fake-зависимостям.

## 3. Выключенный Assistant не проверяет ни одного источника

Code: `src/main/assistant/schedule/scheduler.ts:231-261` · key lines: 236, 237, 249, 256

```ts
  whyNotNow(kind: CheckKind): CheckNowRefusal | null {
    const entry = this.entries.get(kind)
    if (entry === undefined) return 'not-registered'
    if (!this.started) return 'stopped'
    if (this.asleep) return 'asleep'
    if (!this.active()) return 'assistant-off'
    if (!checkSettingsOf(this.options.settings(), kind).enabled) return 'check-off'
    if (entry.running) return 'running'
    return null
  }

  /**
   * Starts a run of `kind` now, whatever its time; answers false and starts nothing when it is not
   * registered, already running, the scheduler is stopped or asleep, the Assistant is off, or the person turned the
   * check off (whyNotNow says which).
   */
  runNow(kind: CheckKind): boolean {
    const entry = this.entries.get(kind)
    if (entry === undefined || this.whyNotNow(kind) !== null) return false
    this.launch(kind, entry)
    return true
  }

  /** How many runs of `kind` failed in a row, as the marks keep it (ticket 22); 0 when none did. Settings show it (ticket 15). */
  failures(kind: CheckKind): number {
    return this.readMarks()[kind]?.failures ?? 0
  }

  private active(): boolean {
    return this.options.active?.() ?? true
  }
```

- Что делает: планировщик получил необязательный `active`; в приложении это `assistantOn(настройки)`. Пока он ложен,
  `dueOf` не даёт срока ни одному виду, а `runNow` отказывает. `runNow` отказывает и проверке, которую человек
  выключил; `whyNotNow` называет причину отказа, и Check now показывает её. `failures(kind)` читает число неудач подряд
  из тех же меток, которые ведёт Ticket 22, — второго хранилища нет. Проверка CI главной ветки (Ticket 21) снимает
  взведённое условие и при выключении Assistant-а (`mainCiSwitchOf`, `src/main/assistant/duties/main-ci-check.ts`).
- Почему здесь: бриф велит читать метки, которые планировщик уже держит, и звать `CheckScheduler.runNow`; решение
  владельца 10 — после включения работают только внутренние обязанности, а выключенный Assistant не тратит ничего.
- Без него: проверка Slack, включённая раньше, шла бы и при выключенном Assistant-е и оплачивала бы вызовы, а красный
  CI, позеленевший при выключенном Assistant-е, всё равно поднял бы «main CI red».
- Требование: [Что строить, пункты 1, 3 и 8](../issues/15-настройки-assistant-а.md#что-строить)
- Риски и пробелы test-ов: без `active` (test-ы планировщика) он всегда включён — так прежние test-ы не меняются.

## 4. Apply — единственный путь изменения из карточки к настройкам

Code: `src/main/assistant/window/view.ts:616-627` · key lines: 620, 623, 624, 625

```ts
  apply(proposalId: string): void {
    const proposal = this.deps.proposals.list().find((each) => each.id === proposalId)
    if (proposal === undefined) throw new Error('This proposal is no longer there')
    if (proposal.change == null) throw new Error('This proposal changes no setting')
    if (proposal.applied != null) throw new Error('This change is applied already')
    const settings = this.deps.settings
    if (settings === undefined) throw new Error('Settings cannot be changed here')
    const rows = changeRows(proposal.change, settings.now())
    settings.apply(proposal.change)
    this.deps.proposals.update(proposalId, { applied: { at: this.deps.now(), rows } })
    this.changed()
  }
```

- Что делает: на щелчок Apply (`assistant.apply`) берёт изменение из предложения, запоминает ряды «как было → как
  станет», применяет изменение через настройки машины и `Duties.configure` (`applySettingsChange`,
  `src/main/assistant/settings/panel.ts`) и отмечает предложение применённым. Отказ настроек бросает до отметки, и
  карточка остаётся прежней.
- Почему здесь: история 26 — Assistant не меняет настройки без щелчка Apply. Раздел в rail уже держит предложения и
  их Dismiss (Ticket 14), поэтому Apply — его функция.
- Без него: изменение из карточки не дошло бы до настроек, или дошло бы без щелчка.
- Требование: [Что строить, пункт 7](../issues/15-настройки-assistant-а.md#что-строить)
- Риски и пробелы test-ов: Undo после Apply нет (решено без владельца, пункт 4 «Итог»).

## 5. Assistant только предлагает изменение

Code: `src/main/mcp/app-server.ts:493-505` · key lines: 499, 500, 501, 504

```ts
    proposal_create: async (args) => {
      if (args.item !== undefined) await refuseLinkedItem(args.item, 'Propose without item, and tell the user it waits there. Nothing was kept.')
      const item = args.item === undefined ? null : itemOfPublicId(args.item)
      checkPrepare(args.prepare)
      // A change of the settings is only kept for its card «before → after»: the user's Apply in the window applies it
      // (worfy-assistant ticket 15). One that could never apply is refused now, not at the user's click.
      if (args.change !== undefined) {
        const problems = dutyChangeProblems(args.change, deps.duties.look([], { countShown: false }).duties)
        if (problems.length > 0) throw new ToolError(`The change cannot apply: ${problems.join('; ')}. Nothing was proposed.`)
      }
      const draft = clean({ title: args.title, why: args.why, prepare: args.prepare ?? null })
      return { proposal: proposalView(deps.proposals.create({ title: draft.title, why: draft.why, item, prepare: draft.prepare, ...(args.change === undefined ? {} : { change: args.change }) })) }
    },
```

- Что делает: `proposal_create` принимает `change` (схема `settingsChangeSchema`: work hours, проверки, дневной предел,
  обязанности) и только кладёт его в предложение. Изменение обязанности, которой нет, или режим, запрещённый действию
  (`self` у `pr-follow`), отказывается сразу. Ни один tool `worfy-app` не меняет настроек, а `proposal_update` не
  принимает `applied`.
- Почему здесь: tools `worfy-app` — единственные tools Session Assistant-а (ADR-0114, граница 1), так что карточку
  может создать только этот tool.
- Без него: Assistant не мог бы предложить изменение, и карточек «было → станет» не было бы вовсе.
- Требование: [Решения](../issues/15-настройки-assistant-а.md#решения)
- Риски и пробелы test-ов: текст instructions для агента (`agent-instructions-app.md`) проверяет только чтение;
  поведение модели с ним не проверялось.

## 6. Строка неудач подряд и Check now

Code: `src/renderer/settings/AssistantSection.tsx:140-148` · key lines: 140, 142, 144

```tsx
      {check !== undefined && check.failures > 0 ? (
        <div className="w-asst-set__failures" role="status" data-testid={`settings-assistant-failures-${kind}`}>
          <span>{failureLine(check)}</span>
          {/* A check the person turned off is not read on a click either. */}
          <button type="button" className="w-action" disabled={check.running || !settings.enabled} title={settings.enabled ? undefined : 'Turn the check on to run it'} onClick={() => void checkNow(kind)}>
            Check now
          </button>
        </div>
      ) : null}
```

- Что делает: у проверки, у которой больше нуля неудач подряд, — строка «Slack: 3 failures in a row, next check at
  HH:MM» (срок — `CheckScheduler.nextRun`, уже с backoff) и Check now (`assistant.checkNow` → `runNow`). У выключенной
  проверки кнопка неактивна; отказ main приходит с причиной (`refused`), и toast её называет.
- Почему здесь: бриф передаёт эту часть из «Вне скоупа» Ticket-а 22; тексты UI — по-английски по
  `docs/design/BRIEF.md`.
- Без него: человек не видел бы, что connector сломан, и не мог бы проверить его после починки.
- Требование: [Что строить, пункт 3](../issues/15-настройки-assistant-а.md#что-строить)
- Риски и пробелы test-ов: после Check now строка обновляется при следующем `assistant.changed` (не реже раза в
  минуту); отдельного события конца run-а нет.

## 7. Как проверено

- `pnpm lint && pnpm typecheck && pnpm test` и gate fast — коды выхода в отчёте PR.
- Новые test-ы: `test/unit/assistant-switch.test.ts`, `test/unit/assistant-settings-panel.test.ts`,
  `test/unit/settings-assistant.test.tsx`, `test/contract/assistant-settings.test.ts`; дополнены
  `assistant-check-scheduler`, `assistant-wake-planner`, `assistant-window`, `assistant-panel`, `worfy-app-tools`,
  `assistant-schedule-settings`. Test-ы поведения были красными до кода.
- e2e `test/e2e/assistant.spec.ts` (карточка Apply) локально не запускался — правило владельца; его гоняет CI.

## Проверить себя

1. Почему проверка Slack, включённая в настройках, не идёт, пока Assistant выключен?
   - Ответ: планировщик спрашивает `active` — в приложении `assistantOn` — и при ложном не даёт срока ни одному виду и
     отказывает `runNow`; переключатель самой проверки тут не решает.
   - Lines: `src/main/assistant/schedule/scheduler.ts:231-261`
2. Что увидит человек на карточке, если настройки отказали изменение после Apply?
   - Ответ: карточку как была, с Apply: отметка `applied` пишется только после того, как `settings.apply` прошёл, а
     отказ бросает раньше и уходит toast-ом.
   - Lines: `src/main/assistant/window/view.ts:616-627`
3. Почему Assistant не может отметить изменение применённым сам?
   - Ответ: `proposal_create` и `proposal_update` не принимают `applied`; его пишет только `AssistantWindow.apply` на
     щелчок Apply.
   - Lines: `src/main/mcp/app-server.ts:493-505`

## 8. Что нашёл review и что осталось

> VERIFIED — worfy-assistant 15 (the Assistant's settings: one switch, off by default; work hours; each check's on/interval/sleep; each duty's action modes, counters and pause; a daily wake limit; usage by source; «before → after» proposal cards that change settings only on Apply; a «N failures in a row» line with Check now for backed-off checks), head f8ff49fb1c8ec4a52d0db07d9c22b4c591f6b2a0
>
> Gate (depth medium, two rounds + rebase):
> - Round 1, reviewer (lens: correctness) — FIX, one med and four low:
>   - med: turning the Assistant off did not disarm a main-ci condition already armed in the attention core, so a «main CI red» item could rise after CI turned green;
>   - low: Check now ran a check turned off in Settings; the refusal toast gave a generic reason; Project rule rows of one title looked the same (duplicate React keys); a wake held by the daily limit was not reconsidered when the limit rose.
>   Checked fine: off by default loses nothing on upgrade; the model cannot write a change or mark it applied; stale, double and dismissed Apply are safe; the switch; the daily limit boundary; reading old settings files.
> - Fix b7c088213: mainCiSwitchOf is on only while the Assistant and the main-ci check are on, and a settings change disarms; runNow refuses check-off and the button is disabled; whyNotNow gives the reason; rows name their Project, key by place+label; the wake loop listens to settings changes. Seven new tests red first.
> - Round 2, narrow reviewer — MERGE: all five closed, no new defect; a mutation removing the disarm turned both disarm tests red. One low comment note, fixed in the rebase.
> - Rebase f8ff49fb1 on f4c8d9fb2 (after #2265 ticket 18 and #2259 ticket 23): conflicts in 9 files resolved keeping both sides; the orchestrator spot-checked isUrgentStop in the window, the linked field, refuseLinkedItem in app-server and the localOnly filter in waiting().
> Evidence: 48 assistant/settings/link test files (1120 passed) exit 0; lint, typecheck exit 0; gate fast green on 6e67df45a (next commit story only); story-check exit 0.
> Not verified: e2e (owner rule; the new Apply e2e runs in CI); the wiring line onSettingsChange in wake/app.ts is covered by typecheck only.
> - CI infra rerun (owner rule 2026-11-08, one per head): run 45787300237, job «windows (harness-scripts 2/2) / full-suite» ended after 48 min with «The hosted runner lost communication with the server», no log and no failing test; the PR does not touch harness/ and the same job passed in 7–8 min on #2265 and #2269. `gh run rerun 45787300237 --failed`.
