# Code story — worfy-pr-review 05: Поиск в виде Pull requests: поле, `/`, меню области, chip-ы фильтров, сохранённые поиски, список результатов и полоса «Review this pull request»

Kind: pr · Epic: worfy-pr-review · Ticket: 05 · PR: - · Language: ru

## 1. Что было не так

Вид Pull requests показывал только группы inbox: найти PR вне них было нельзя. Ticket 04 дал main поиск
(`prSearch.run`, `prSearch.pull`, сохранённые поиски), но в виде не было ни поля, ни списка результатов. Этот PR
строит вид по прототипу Card Ticket-а 01: поле с меню области и chip-ами фильтров, список «Search · N results» вместо
групп и полосу «Review this pull request» для чужого PR вне inbox.

- Требование: [Что происходит](../issues/05-поиск-в-виде-pull-requests.md#что-происходит)

## 2. `/` ставит фокус в поле, но не из текстового поля

Code: `src/renderer/pr-inbox/PrInboxView.tsx:839-846` · key lines: 841, 842, 845

```tsx
/** Whether this `/` is the view's: it puts the focus in the search field from anywhere in the shown view but a field. */
function slashKey(event: KeyboardEvent, frame: HTMLElement | null): boolean {
  if (event.key !== '/' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false
  if (frame === null || frame.closest('[hidden]') !== null) return false
  const target = event.target
  if (target instanceof Element && target !== document.body && target !== document.documentElement && !frame.contains(target)) return false
  return !(target instanceof HTMLElement && (target.isContentEditable || target.closest('textarea, input, select') !== null || layerOf(target) !== null))
}
```

- Что делает: `/` — клавиша вида, только когда вид показан, нажатие пришло из него (или из `body`) и не из поля
  ввода, редактируемого текста или открытого меню (`layerOf`). Тогда обработчик клавиш вида ставит фокус в поле.
- Почему здесь: рядом с `listKey`, который так же решает за ↑ и ↓; обработчик один на вид.
- Без него: `/` в черновике ответа или в поле имени сохранённого поиска уводил бы фокус в поиск, а скрытый вид (другая
  вкладка) перехватывал бы `/` у видимой.
- Требование: [Что делаем, пункт 1](../issues/05-поиск-в-виде-pull-requests.md#что-делаем)
- Риски и пробелы test-ов: unit проверяет `/` из вида и из текстового поля; `/` из открытого меню kit проверен только
  чтением кода.

## 3. Chip пишет квалификатор в поле, поле — единственный источник правды

Code: `src/renderer/pr-inbox/SearchBar.tsx:373-385` · key lines: 377, 379, 381

```tsx
        {PR_SEARCH_CHIPS.map((chip) => (
          <FilterChip
            key={chip.id}
            chip={chip}
            text={search.text}
            authors={authors}
            onWrite={(qualifiers) => write(setChip(search.text, chip.id, qualifiers))}
            onType={(key) => {
              search.setText(`${search.text.trim()} ${key}`.trimStart())
              focusEnd()
            }}
          />
        ))}
```

- Что делает: каждый chip получает текст поля и сам по нему (`chipsOf`) показывает, какой квалификатор уже записан;
  выбор варианта заменяет квалификаторы chip-а в тексте (`setChip` Ticket-а 04) и ищет. Author и Label с вводом
  дописывают `author:` или `label:` и ставят фокус в конец поля.
- Почему здесь: `setChip` и `chipsOf` — чистые функции `src/shared/pr-search/query.ts`; у chip-ов нет своего
  состояния, поэтому набранный руками `is:draft` тоже отмечает chip Draft.
- Без него: состояние chip-ов и текст поля расходились бы, и поиск искал бы не то, что показано.
- Требование: [Что делаем, пункт 2](../issues/05-поиск-в-виде-pull-requests.md#что-делаем)
- Риски и пробелы test-ов: unit проверяет запись State, показ набранного руками `is:draft` на chip-е Draft, три
  переключателя, Author и Label; варианты Review requested и Review status идут через те же `setChip` и `chipsOf`,
  их покрывает `test/unit/pr-search-query.test.ts`.

## 4. Последний поиск побеждает, Load more дописывает, пауза ждёт своего конца

Code: `src/renderer/pr-inbox/usePrInbox.ts:631-664` · key lines: 634, 638, 645, 650, 657

```ts
  const send = useCallback(
    (shown: ShownSearch, cursor: string | null) => {
      wake()
      const request = ++asked.current
      current.current = { ...current.current, scope: shown.scope }
      setState((before) => ({ ...before, scope: shown.scope, shown, running: true, failure: null, result: cursor === null ? null : before.result }))
      void invoke('prSearch.run', { projectId, text: shown.text, scope: shown.scope, cursor }).then((answer) => {
        if (asked.current !== request) return
        if (!answer.ok) {
          setState((before) => ({ ...before, running: false, failure: `The search failed: ${readableReason(answer.error)}` }))
          return
        }
        // A search refused for the rate limit runs again by itself when the pause ends, unless another search or
        // Clear came first (spec, section 10: Enter during the pause schedules the search for its end).
        const until = answer.value.pausedUntil === null ? Number.NaN : Date.parse(answer.value.pausedUntil)
        if (Number.isFinite(until)) {
          wake()
          pending.current = setTimeout(() => {
            pending.current = null
            if (asked.current === request) again.current(shown, cursor)
          }, Math.max(PAUSE_MIN_MS, until - Date.now()))
        }
        setState((before) => {
          if (cursor === null || before.result === null) return { ...before, running: false, result: answer.value }
          // A page main refused (the pause, a failure) brings no rows and no cursor: the pages shown keep their count,
          // their cursor and their notices, and its own notices join them.
          if (refused(answer.value)) return { ...before, running: false, result: { ...before.result, pausedUntil: answer.value.pausedUntil, notices: joined(before.result.notices, answer.value.notices) } }
          const seen = new Set(before.result.rows.map(rowKey))
          const rows = [...before.result.rows, ...answer.value.rows.filter((each) => !seen.has(rowKey(each)))]
          return { ...before, running: false, result: { ...answer.value, rows, searchedAt: before.result.searchedAt } }
        })
      })
    },
    [projectId, wake],
```

- Что делает: каждый запрос получает номер; ответ, который пришёл после следующего запроса или после Clear, отброшен.
  Новый поиск заменяет результаты, Load more (с `cursor`) дописывает строки без повторов и сохраняет время первого
  поиска. Страница, которую main отказал (пауза rate limit, сбой: ни строк, ни `cursor`), не затирает показанные:
  их число, `cursor` и notice-ы остаются, notice-ы отказа добавляются (раунд ревью 1). Ответ с `pausedUntil` ставит тот
  же запрос на конец паузы; новый поиск, Clear или уход с вида его снимают.
- Почему здесь: в hook-е `usePrSearch` рядом с `usePrInbox`; состояние поиска — состояние вида, в main его нет.
- Без него: медленный ответ первого поиска затёр бы результаты второго; Load more во время паузы показал бы
  «Search · 0 results» над строками и убрал бы Load more насовсем; Enter во время паузы пришлось бы повторять руками.
- Требование: [Что делаем, пункты 3 и 6](../issues/05-поиск-в-виде-pull-requests.md#что-делаем)
- Риски и пробелы test-ов: гонку двух поисков unit не воспроизводит — ответы fake preload приходят по порядку. Пауза
  проверена на 1 s реального таймера; минимум ожидания — 1 s, чтобы прошедшая пауза не искала в цикле.

## 5. Полоса чужого PR вне inbox

Code: `src/renderer/pr-inbox/usePrInbox.ts:512-533` · key lines: 513, 527, 530

```ts
export function searchStep(row: PrInboxRow, now: number, viewer: string | null): NextStep {
  if (viewer !== null && sameLogin(row.author, viewer)) return { tone: 'waiting', title: 'Your pull request', text: `Last activity ${ageText(row.lastActivityAt, now)} ago.`, action: null, more: [] }
  const approvals = row.approvals
  const asked = (approvals?.reviewers ?? [])
    .filter((each) => each.state === 'requested')
    .map((each) => (viewer !== null && each.kind === 'user' && sameLogin(each.login, viewer) ? 'you' : each.login))
  const left =
    approvals === undefined || approvals.source === 'none'
      ? `opened ${ageText(row.createdAt, now)} ago`
      : approvals.need === null
        ? `${countOf(approvals.have, 'approval')}, the rule is not visible`
        : approvals.need === 0
          ? 'no approvals required'
          : `${approvals.have} of ${approvals.need} required approval${approvals.need === 1 ? '' : 's'}`
  return {
    tone: 'review',
    title: 'Review this pull request',
    text: `${row.author ?? 'ghost'} asked ${asked.length === 0 ? 'nobody' : namesText(asked)}; ${left}.`,
    action: { kind: 'link', label: 'Start review', url: `${row.url}/files` },
    more: [],
  }
}
```

- Что делает: у результата без группы inbox панель PR берёт полосу отсюда: для чужого PR — «Review this pull request»,
  кого автор попросил и сколько одобрений осталось, и Start review на вкладку Files GitHub; для своего — последняя
  активность без действия.
- Почему здесь: рядом с `nextStep`, полосой групп inbox; `PrPane` выбирает `searchStep`, когда `group` равен `null`.
- Без него: у PR вне inbox не было бы группы, и панель не знала бы, какую полосу показать.
- Требование: [Что делаем, пункт 5](../issues/05-поиск-в-виде-pull-requests.md#что-делаем)
- Риски и пробелы test-ов: Start review ведёт на GitHub до Ticket-а 09; e2e проверяет текст полосы и ссылку.

## 6. Выбор результата вне inbox читает PR, пока результат не новее чтения

Code: `src/renderer/pr-inbox/PrInboxView.tsx:947-970` · key lines: 951, 956, 963, 965, 967

```tsx
  const pull = (key: string, row: PrSearchRow, refresh: boolean): void => {
    if (reading.current.has(key)) return
    reading.current.add(key)
    const { repo, number, updatedAt } = row
    void invoke('prSearch.pull', { projectId: project.id, repo, number, updatedAt, ...(refresh ? { refresh: true } : {}) }).then((answer) => {
      reading.current.delete(key)
      const value: PrSearchPull = answer.ok ? answer.value : { row: null, readAt: null, notices: [{ kind: 'failed', text: `${repo}#${number} could not be read: ${readableReason(answer.error)}`, url: null }] }
      setPulls((before) => {
        const old = before[key]
        return { ...before, [key]: value.row === null && old?.row != null ? { ...old, notices: value.notices } : value }
      })
    })
  }
  // A selected result the inbox lacks is read once per `updatedAt` the results gave, in the shape of the inbox's row
  // (main answers from its memory while GitHub's updatedAt is that one).
  useEffect(() => {
    if (pullKey === null || currentResult === undefined || pulling.current.has(pullKey)) return
    pulling.current.add(pullKey)
    const refresh = forced.current
    forced.current = false
    pull(pullKey, currentResult, refresh)
    // Once per PR: the row is that of the render that selected it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pullKey])
```

- Что делает: PR вне inbox читается `prSearch.pull` один раз на `updatedAt`, который дали результаты: ключ памяти —
  `rowKey` и `updatedAt`, поэтому новый поиск, нашедший PR изменённым, читает его снова, а панель берёт строку
  результата, если прочитанная старше (раунд ревью 1). Refresh читает выбранный PR мимо памяти main
  (`refresh: true`), фокус окна — тоже, когда чтению больше 60 s (spec, решения по реализации, 9). Повторное чтение со
  сбоем оставляет прежнюю строку и добавляет notice.
- Почему здесь: в `ProjectPrInbox`, который уже держит выбор, `markSeen` и панель; `PrInboxBody` получает готовые
  `results` и не знает о каналах.
- Без него: панель PR вне inbox показала бы только строку поиска без ветки, CI и ревьюеров; после второго поиска —
  старые заголовок, CI и обсуждения.
- Требование: [Что делаем, пункт 5](../issues/05-поиск-в-виде-pull-requests.md#что-делаем)
- Риски и пробелы test-ов: фокус проверен событием `focus` окна в jsdom; фокус настоящего окна Electron e2e не
  проверяет.

## 7. Что сознательно не меняли

- Main не тронут: каналы и тексты notice-ов — Ticket 04. Счётчик «new since you looked» у PR вне inbox main отдаёт, а
  вид его прячет (`unseenless`, `src/renderer/pr-inbox/PrInboxView.tsx:849`).
- Review mode и Enter на строке результата как старт ревью — Ticket 09.
- Раздел «Recent» меню сохранённых поисков из прототипа не построен.

## 8. Как проверено

- `test/unit/pr-search-view.test.tsx` — красный до правки (21 из 21), затем 21 из 21; после раунда ревью 1 — 27 из 27; с `test/unit/pr-inbox-view.test.tsx`
  114 из 114.
- `test/e2e/pr-search.spec.ts` и `test/e2e/pr-inbox.spec.ts` целиком — 12 из 12 на gh stand-in без записи в GitHub.
- `pnpm lint`, `pnpm typecheck`, `check-feature-docs`, `check-personal` — exit 0; `pnpm test` и gate fast красные
  только на contract test-ах слежения за файлами (fseventsd этого Mac) — подробности в «Итог» Ticket-а.

## Проверить себя

1. Почему `/`, нажатый в поле имени сохранённого поиска, не уводит фокус в поле поиска?
   - Строки: `src/renderer/pr-inbox/PrInboxView.tsx:845`
   - Ответ: `slashKey` отказывает, когда цель — `input`, `textarea`, `select` или редактируемый текст.
2. Что увидит пользователь, если ответ первого поиска придёт после ответа второго?
   - Строки: `src/renderer/pr-inbox/usePrInbox.ts:634`, `src/renderer/pr-inbox/usePrInbox.ts:638`
   - Ответ: результаты второго: ответ с устаревшим номером запроса отброшен.
3. Откуда панель берёт полосу для PR, которого нет в inbox?
   - Строки: `src/renderer/pr-inbox/usePrInbox.ts:512`, `src/renderer/pr-inbox/usePrInbox.ts:527`
   - Ответ: из `searchStep`: у такого PR нет группы, и полоса — «Review this pull request» или «Your pull request».

## 9. Что нашёл review и что осталось

> VERIFIED — worfy-pr-review 05 (search in the Pull requests view), head d00f2626c703ff3471596d487ee3407372edc9fa
>
> Gate (depth medium, two rounds): verifier (lens: implementer's report) — claims backed, «not verified» only on history (one code commit) and on e2e left to CI, three low test gaps; reviewer (lens: correctness) round 1 three med (two reproduced by probes) + one low spec gap; all fixed test-first; round 2 reviewer: all closed, one new low.
>
> - Verifier: / focuses the field (not from text fields, not with a modifier), Escape blurs (PrInboxView.tsx:840-846); chips write and show qualifiers (SearchBar.tsx:373-385); scope menu, Clear, notices 422 / SSO / sign-in / call failure; a PR outside the inbox read via prSearch.pull with the «Review this pull request» strip (PrInboxView.tsx:929-946, usePrInbox.ts:512-533); the inbox unchanged without a search; docs/features/pr-inbox.md «### Search». Mutants red. Screenshots light/dark/422/SSO match the prototype card-53b21f06 and the listed deviations; fixture data only.
> - Round 1 fixes: a Load more refused by the rate-limit pause keeps the shown pages, cursor and notices (usePrInbox.ts:587, :657) while an honest empty last page drops Load more; the pull cache keyed rowKey + updatedAt and an older pulled row yields to the result row (PrInboxView.tsx:931); the selected PR outside the inbox is read again on window focus when older than 60 s and by Refresh with refresh: true (:983; one read for a burst of focus events, none after unmount); Enter during a rate-limit pause searches again at its end (≥ 1 s), cancelled by a new search, Clear or leaving; tests for the focus entry dropping the search, Refresh clearing the pull cache, data-invalid on 422.
> - Tests: pr-search-view + pr-inbox-view 114/114 EXIT=0; e2e pr-search.spec.ts + pr-inbox.spec.ts whole 12/12 EXIT=0; lint, typecheck, check-feature-docs, check-personal, story-check, evidence-check EXIT=0. Local gate fast red only on file-watcher tests (fseventsd). ci-ok pass on the head.
> - CI fix: d687cc485 was red on test-timeout-scale (two raw limits in pr-search-view.test.tsx:567,:578); d00f2626c routes both through ms(); test-timeout-scale + pr-search-view 34/34 EXIT=0, lint, typecheck EXIT=0.
>
> Decided without the owner (to confirm): the 14 decisions in the ticket's «Итог» (scope names incl. «Organizations of this Project», chips search at once, warnings with repos: [], Forget in the menu, the new-count hidden for PRs outside the inbox, Refresh clears the pull cache, …); prototype deviations: no «Recent» in saved searches, inbox header kept, «Searched N min ago · Refresh» and Load more added, full-width search row.
>
> Consider [low]: usePrInbox.ts:648 — a retry timer set by an answer that arrives after unmount / Project change fires one extra prSearch.run at the end of the pause (probe exit 1); PrInboxView.tsx is 1127 lines (gate warns > 1000); main answers the same search from its 60 s memory so Refresh in the first 60 s returns the same snapshot (spec.md:378); a toast may overlap the right edge of the search row.
