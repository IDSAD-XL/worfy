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

## 4. Последний поиск побеждает, Load more дописывает

Code: `src/renderer/pr-inbox/usePrInbox.ts:604-624` · key lines: 606, 610, 616, 618

```ts
  const send = useCallback(
    (shown: ShownSearch, cursor: string | null) => {
      const request = ++asked.current
      current.current = { ...current.current, scope: shown.scope }
      setState((before) => ({ ...before, scope: shown.scope, shown, running: true, failure: null, result: cursor === null ? null : before.result }))
      void invoke('prSearch.run', { projectId, text: shown.text, scope: shown.scope, cursor }).then((answer) => {
        if (asked.current !== request) return
        if (!answer.ok) {
          setState((before) => ({ ...before, running: false, failure: `The search failed: ${readableReason(answer.error)}` }))
          return
        }
        setState((before) => {
          if (cursor === null || before.result === null) return { ...before, running: false, result: answer.value }
          const seen = new Set(before.result.rows.map(rowKey))
          const rows = [...before.result.rows, ...answer.value.rows.filter((each) => !seen.has(rowKey(each)))]
          return { ...before, running: false, result: { ...answer.value, rows, searchedAt: before.result.searchedAt } }
        })
      })
    },
    [projectId],
  )
```

- Что делает: каждый запрос получает номер; ответ, который пришёл после следующего запроса или после Clear, отброшен.
  Новый поиск заменяет результаты, Load more (с `cursor`) дописывает строки без повторов и сохраняет время первого
  поиска, чтобы «Searched N min ago» не врал.
- Почему здесь: в hook-е `usePrSearch` рядом с `usePrInbox`; состояние поиска — состояние вида, в main его нет.
- Без него: медленный ответ первого поиска затёр бы результаты второго, а Clear, нажатый до ответа, вернул бы
  результаты на экран.
- Требование: [Что делаем, пункт 3](../issues/05-поиск-в-виде-pull-requests.md#что-делаем)
- Риски и пробелы test-ов: гонку двух поисков unit не воспроизводит — ответы fake preload приходят по порядку.

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

## 6. Выбор результата вне inbox читает PR один раз

Code: `src/renderer/pr-inbox/PrInboxView.tsx:929-946` · key lines: 931, 937, 940, 941

```tsx
  const selectResult = (row: PrSearchRow): void => {
    if (searchId !== null) setFound({ search: searchId, key: rowKey(row) })
    if (row.inInbox) markSeen(row)
  }

  // A selected result the inbox lacks is read once, in the shape of the inbox's row (main answers from its memory while
  // GitHub's updatedAt is the one the results gave).
  useEffect(() => {
    if (pullKey === null || currentResult === undefined || pulling.current.has(pullKey)) return
    pulling.current.add(pullKey)
    const { repo, number, updatedAt } = currentResult
    void invoke('prSearch.pull', { projectId: project.id, repo, number, updatedAt }).then((answer) => {
      const value: PrSearchPull = answer.ok ? answer.value : { row: null, readAt: null, notices: [{ kind: 'failed', text: `${repo}#${number} could not be read: ${readableReason(answer.error)}`, url: null }] }
      setPulls((before) => ({ ...before, [pullKey]: value }))
    })
    // Once per PR: the row is that of the render that selected it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pullKey])
```

- Что делает: выбор запоминается по поиску, поэтому новый поиск снова выбирает первый результат. PR из inbox
  отмечается просмотренным, как клик в inbox. PR вне inbox читается `prSearch.pull` один раз за поиск; ошибка чтения
  становится notice в панели.
- Почему здесь: в `ProjectPrInbox`, который уже держит выбор, `markSeen` и панель; `PrInboxBody` получает готовые
  `results` и не знает о каналах.
- Без него: панель PR вне inbox показала бы только строку поиска без ветки, CI и ревьюеров, а ↑ ↓ по результатам
  читали бы один PR снова и снова.
- Требование: [Что делаем, пункт 5](../issues/05-поиск-в-виде-pull-requests.md#что-делаем)
- Риски и пробелы test-ов: Refresh сбрасывает кэш, и выбранный PR читается заново (решено без владельца).

## 7. Что сознательно не меняли

- Main не тронут: каналы и тексты notice-ов — Ticket 04. Счётчик «new since you looked» у PR вне inbox main отдаёт, а
  вид его прячет (`unseenless`, `src/renderer/pr-inbox/PrInboxView.tsx:849`).
- Review mode и Enter на строке результата как старт ревью — Ticket 09.
- Раздел «Recent» меню сохранённых поисков из прототипа не построен.

## 8. Как проверено

- `test/unit/pr-search-view.test.tsx` — красный до правки (21 из 21), затем 21 из 21; с `test/unit/pr-inbox-view.test.tsx`
  108 из 108.
- `test/e2e/pr-search.spec.ts` и `test/e2e/pr-inbox.spec.ts` целиком — 12 из 12 на gh stand-in без записи в GitHub.
- `pnpm lint`, `pnpm typecheck`, `check-feature-docs`, `check-personal` — exit 0; `pnpm test` и gate fast красные
  только на contract test-ах слежения за файлами (fseventsd этого Mac) — подробности в «Итог» Ticket-а.

## Проверить себя

1. Почему `/`, нажатый в поле имени сохранённого поиска, не уводит фокус в поле поиска?
   - Строки: `src/renderer/pr-inbox/PrInboxView.tsx:845`
   - Ответ: `slashKey` отказывает, когда цель — `input`, `textarea`, `select` или редактируемый текст.
2. Что увидит пользователь, если ответ первого поиска придёт после ответа второго?
   - Строки: `src/renderer/pr-inbox/usePrInbox.ts:606`, `src/renderer/pr-inbox/usePrInbox.ts:610`
   - Ответ: результаты второго: ответ с устаревшим номером запроса отброшен.
3. Откуда панель берёт полосу для PR, которого нет в inbox?
   - Строки: `src/renderer/pr-inbox/usePrInbox.ts:512`, `src/renderer/pr-inbox/usePrInbox.ts:527`
   - Ответ: из `searchStep`: у такого PR нет группы, и полоса — «Review this pull request» или «Your pull request».
