# Code story — worfy-acceptance 05: Вкладка Acceptance: две панели, группы, пункт с Evidence вне focus mode, строка Stable copy, Pass и Fail

Kind: pr · Epic: worfy-acceptance · Ticket: 05 · PR: - · Language: ru

## 1. Что было не так

После Ticket-ов 01–03 main отдавал очередь проверок владельца (`acceptance.get`, `acceptance.changed`) со строкой
Stable copy и принимал решение по каналу `actions.ownerCheck`, но окна для них не было: владелец не видел ни групп, ни
Evidence пункта вне focus mode, и Pass или Fail нечем было нажать.

- Требование: [Что происходит](../issues/05-вкладка-acceptance.md#что-происходит)

## 2. Шестая вкладка со счётом Ready to check

Code: `src/renderer/shell/Toolbar.tsx:101-117` · key lines: 101, 109, 116

```tsx
      value: 'acceptance',
      label: 'Acceptance',
      icon: (
        <span className="w-acc-tab">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
            <path d="M5.5 8.2l1.8 1.8 3.4-3.8" />
          </svg>
          {ready > 0 ? (
            <span className="w-acc-tab__count" data-testid="acceptance-tab-count">
              {ready}
            </span>
          ) : null}
        </span>
      ),
      title: 'Checks that wait for you',
      testId: 'acceptance-tab',
```

- Что делает: вкладка «Acceptance» после Pull requests, без `disabled`: вид — по всем Project-ам Machine. Счёт Ready to
  check (`useReadyCount`) стоит после подписи: обёртка иконки — `display: contents` (`acceptance.css`), так что
  примитив `SegmentedControl` не менялся.
- Почему здесь: Ticket называет `src/renderer/shell/Toolbar.tsx` (`ShellView`); tooltip «Checks that wait for you» —
  из spec, «Термин в CONTEXT.md».
- Без него: вид нельзя открыть, а число ждущих проверок не видно, пока вид закрыт.
- Требование: [Что делаем, п. 1](../issues/05-вкладка-acceptance.md#что-делаем)
- Риски и пробелы test-ов: на 1280 px подписи вкладок скрыты (правило `shell.css` до 1400 px), счёт остаётся рядом с
  иконкой; `limits-vendors.spec.ts` и `toolbar.spec.ts` зелёные с шестой вкладкой.

## 3. Решение уходит с текстом пункта, а кнопки ждут ответа main

Code: `src/renderer/acceptance/useAcceptance.ts:167-182` · key lines: 170, 173, 176, 180

```ts
export async function sendDecision(row: AcceptanceItemRow, verdict: OwnerCheckVerdict, where: CheckedIn, words: string): Promise<void> {
  const key = rowKey(row)
  const { sending } = useAcceptanceStore.getState()
  if (sending[key] !== undefined) return
  useAcceptanceStore.setState((store) => ({ sending: { ...store.sending, [key]: verdict }, refused: without(store.refused, key) }))
  const { projectId, epic, num } = row.ticket
  const result = await invoke('actions.ownerCheck', { projectId, epic, num, item: row.item.index, itemText: row.item.text, verdict, ...where, words })
  useAcceptanceStore.setState((store) => {
    const rest = { sending: without(store.sending, key) }
    if (!result.ok) return { ...rest, refused: { ...store.refused, [key]: failureReason('actions.ownerCheck', result.error) } }
    const rows = shownRows(store.state, store.open)
    const at = rows.findIndex((each) => rowKey(each) === key)
    const next = at >= 0 && at + 1 < rows.length ? rowKey(rows[at + 1]!) : store.selected
    return { ...rest, sentHere: { ...store.sentHere, [key]: verdict }, selected: store.selected === key ? next : store.selected }
  })
}
```

- Что делает: `actions.ownerCheck` получает `itemText` — текст пункта, как его показал снимок очереди; пока main не
  ответил, второй вызов по тому же пункту ничего не шлёт; отказ main остаётся под кнопками строки; после ответа строка
  помечена «Sent» этим окном (до метки очереди) и выбирается следующий пункт.
- Почему здесь: Ticket называет `useAcceptance.ts`; `itemText` и запрет второго решения — заметки Итог Ticket-а 03
  (main отказывает изменённому пункту «reload the Acceptance view»).
- Без него: двойной клик отправил бы два решения; решение без `itemText` main не принимает.
- Требование: [Что делаем, п. 4](../issues/05-вкладка-acceptance.md#что-делаем)
- Риски и пробелы test-ов: если main отправил текст, но не записал «Sent» (он только пишет предупреждение), строка
  остаётся «Sent» до перезапуска окна — текст ведь ушёл.

## 4. Когда Pass и Fail неактивны и почему

Code: `src/renderer/acceptance/AcceptanceView.tsx:168-180` · key lines: 172, 173, 175, 176

```tsx
  const sent = sentOf(row, sentHere)
  // The commit of the copy: known for this Machine's Stable copy, the one the Stable copy line reads (main's snapshot);
  // its version when this window is that copy. A window on a Linked machine reads that Machine's queue, whose commit is
  // not this computer's Stable copy: there the sha stays `-`.
  const here = copy === 'stable' && platform === currentPlatform() && windowMachine() === null
  const commit = here ? (state?.stableCommit ?? null) : null
  const version = here ? (update?.enabled === true ? (update.current?.version ?? null) : commit?.slice(0, 7) ?? null) : null
  const where: CheckedIn = { platform, copy, sha: commit !== null && OWNER_CHECK_SHA.test(commit) ? commit : '-' }
  const blocked = readOnly ?? (autopilot ? OWNER_CHECK_AUTOPILOT_HINT : sending[key] !== undefined ? 'Sending…' : sent?.state === 'sent' ? 'Sent: the decision waits for its line in the Ticket' : null)
  const reason = (verdict: OwnerCheckVerdict): string | null => blocked ?? (verdict === 'fail' && words.trim() === '' ? FAIL_NEEDS_WORDS : null)
  const decide = (verdict: OwnerCheckVerdict) => {
    if (reason(verdict) === null) void sendDecision(row, verdict, where, words.trim())
  }
```

- Что делает: одна причина на обе кнопки: Read only окна, Autopilot в Project-е пункта (текст
  `OWNER_CHECK_AUTOPILOT_HINT`, тот же, что у отказа main), решение в пути, пункт «Sent». Fail вдобавок требует
  комментарий. `sha` — commit Stable copy из снимка очереди (`stableCommit`: main берёт его так же, как для строки
  Stable copy — свой commit запуска, иначе файл рядом с копией), когда копия `stable` и платформа этой Machine; иначе
  `-`. Commit последней проверки обновлений не годится: её ответ приходит через секунды после старта, и Pass сразу после
  обновления записал бы прошлую копию. В окне Linked machine очередь и её `stableCommit` — той Machine, поэтому там
  `sha` всегда `-` (commit сборки Linked machine даст Ticket 07).
- Почему здесь: spec, Q6 (а): «Pass и Fail неактивны с причиной, как Run wave»; «Платформа, копия и commit строки».
  `OWNER_CHECK_AUTOPILOT_HINT` переехал в `src/shared/actions/render-template.ts`: renderer не импортирует `src/main`.
- Без него: при Autopilot кнопка жала бы впустую до отказа main; Fail ушёл бы без слов, которые skill пишет в ref.
- Требование: [Что делаем, п. 4](../issues/05-вкладка-acceptance.md#что-делаем)
- Риски и пробелы test-ов: Autopilot читается по `autopilot.state` и `autopilot.changed` выбранного Project-а; Linked
  machine с Read only проверяет Ticket 07.

## 5. Метка ручного пункта не показывается, но уходит

Code: `src/renderer/acceptance/AcceptanceView.tsx:67-75` · key lines: 69, 74

```tsx
/** The item's text without the manual mark it starts with: the pane says "manual" itself. Sent as it is, never so. */
function shownText(item: EvidenceItem): string {
  return item.manual ? item.text.replace(/^\([^)]*\)\s*/, '') : item.text
}

/** The item as plain text, without the manual mark and the markdown markers: the list row and the Evidence matrix. */
function plainText(item: EvidenceItem): string {
  return markdownText(shownText(item)).replace(/\s+/g, ' ').trim()
}
```

- Что делает: в панели и в строке списка текст пункта без ведущего `(manual)`; строка «Item N of M · manual» говорит
  это сама. Строка списка, матрица Evidence и «Prepared by the Orchestrator» показывают простой текст, без `**` и других
  знаков Markdown; панель рисует текст через `Markdown.tsx`. В `actions.ownerCheck` уходит `row.item.text` как есть.
- Почему здесь: not recorded — решено без владельца; метка зависит от Profile-а (`manual` или старая русская), поэтому
  срезается первая скобка ручного пункта, а не слово.
- Без него: каждый пункт начинался бы с «(manual)»; срезанный текст в `itemText` main отказал бы как изменённый пункт.
- Требование: [Что делаем, п. 3](../issues/05-вкладка-acceptance.md#что-делаем)
- Риски и пробелы test-ов: пункт, чей текст сам начинается со скобки после метки, теряет только метку.

## 6. Строка Stable copy, как её рисует spec

Code: `src/renderer/acceptance/AcceptanceView.tsx:131-149` · key lines: 135, 140

```tsx
export function StableLine({ stable }: { stable: AcceptanceStable }) {
  const update = useUpdate()
  let after: ReactNode = null
  if (stable.update === 'available')
    after = (
      <Button variant="secondary" onClick={() => void installUpdateTelling(update)} data-testid="acceptance-update">
        Update worfy
      </Button>
    )
  else if (stable.update !== null) after = <span className="w-acc-muted">{{ 'waits-ci': MAIN_WAITS_FOR_CI, 'no-update-check': NO_UPDATE_CHECK, 'update-not-here': UPDATE_NOT_HERE }[stable.update]}</span>
  return (
    <p className="w-acc-stable" data-testid="acceptance-stable" data-state={stable.state}>
      <span className="w-acc-stable__dot" aria-hidden="true" />
      <span>{stable.text}</span>
      {after}
    </p>
  )
}

```

- Что делает: текст строки из main и точка по состоянию; при `out` — Update worfy (`installUpdateTelling`, как у chip-а
  Update), либо одна из фраз `MAIN_WAITS_FOR_CI`, `NO_UPDATE_CHECK`, `UPDATE_NOT_HERE`.
- Почему здесь: spec, «Stable copy пункта»: «Update first даёт кнопку Update worfy, когда есть Available update; иначе
  говорит, что `main` ждёт зелёного CI»; тексты фраз — из Ticket-а 02.
- Без него: владелец в Update first не узнал бы, что сделать до проверки.
- Требование: [Что делаем, п. 3](../issues/05-вкладка-acceptance.md#что-делаем)
- Риски и пробелы test-ов: unit test проверяет все семь видов строки; в e2e — только `merged` (Project не worfy).

## 7. Как проверено

- `pnpm exec vitest run test/unit/acceptance-view.test.tsx` — exit 0 (24 test-а); до правки — exit 1.
- `pnpm test:e2e test/e2e/acceptance.spec.ts` — exit 0: снимок и клип пункта, ↑ ↓, Pass в лог fake Orchestrator-а,
  строка `owner-check` от `ticket evidence` уводит пункт; снимки 1280 и 1600 px в обеих темах.
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0; `gate fast` — exit 0; 12 мутантов первого прохода и 9 раунда ревью —
  все убиты, кроме одного эквивалентного (ключ на панели пункта).

## Проверить себя

1. Почему кнопки неактивны и после ответа main, хотя очередь ещё не пометила пункт «Sent»?
   - Ответ: ответ main кладёт пункт в `sentHere`, и строка читает «Sent» до прихода метки очереди — второго решения нет.
   - Строки: `src/renderer/acceptance/useAcceptance.ts:180`
2. Что получит main в `itemText`, если пункт начинается с `(manual)`?
   - Ответ: текст с меткой, `row.item.text`; срезанный вариант только рисуется, иначе main отказал бы как изменённому
     пункту.
   - Строки: `src/renderer/acceptance/useAcceptance.ts:173`
3. Когда решение несёт настоящий commit, а не `-`?
   - Ответ: когда окно — этой Machine, выбрана копия `stable` на её платформе и снимок очереди назвал её commit
     (`stableCommit`).
   - Строки: `src/renderer/acceptance/AcceptanceView.tsx:172-175`
