# Code story — worfy-changes-view 09: Rework of worfy-changes-view 07, item 3

Kind: pr · Epic: worfy-changes-view · Ticket: 09 · PR: - · Language: ru

## 1. Что было не так

На приёмке Ticket-а 07 владелец сказал: «как выделять диапазон строк непонятно». Диапазон выбирался только щелчком,
щелчком с Shift и клавишей `c`, а экран об этом молчал; «+» сразу открывал popover на одну строку. Второе: текст агенту
называл каждую строку новой стороны «uncommitted», даже в чистом worktree, где всё уже в HEAD (D3).

- Требование: [Что происходит](../issues/09-rework-07-item-3.md#что-происходит)

## 2. Перетаскивание «+» — один hook на два экрана

Code: `src/renderer/changes/line-pick.tsx:125-154` · key lines: 130, 131, 136, 138, 143, 145, 148

```tsx
  const press = (key: string, side: LineSide, line: number) => {
    stop.current?.()
    const drag: Drag = { key, side, line, end: line, moved: false }
    const onMove = (event: MouseEvent) => {
      const at = lineAt(event.target)
      if (at === null || at.key !== drag.key || at.side !== drag.side) return
      if (at.line === drag.line && !drag.moved) return
      drag.moved = true
      drag.end = at.line
      setPicked({ key: drag.key, side: drag.side, start: drag.line, end: at.line })
    }
    const onUp = () => {
      stop.current?.()
      if (!drag.moved) {
        openOn(drag.key, drag.side, drag.line)
        return
      }
      const { from, to } = pickRange({ key: drag.key, side: drag.side, start: drag.line, end: drag.end })
      latest.current.options.open(drag.key, drag.side, from, to)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    setDragging(true)
    stop.current = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      stop.current = null
      setDragging(false)
    }
  }
```

- Что делает: нажатие на «+» вешает `mousemove` и `mouseup` на окно; движение по строкам того же файла и стороны
  растягивает выбор, отпускание открывает popover на весь диапазон, а без движения — прежний путь `openOn` (строка или
  выбранный диапазон, если строка в нём). Отпускание снимает оба слушателя.
- Почему здесь: Ticket, пункты 1 и 2 — общий hook для Changes и Review mode PR, слушатели на `window`, строка по
  `data-side`/`data-line`; решение 6 «Решено без владельца» — `DiffPane.tsx` не трогать, его правит Ticket 10. Файл
  `.tsx`, а не `.ts`, как в Ticket-е: hook рисует «+» и подсказку.
- Без него: диапазон оставался бы скрытым приёмом (щелчок, Shift, `c`), и в двух копиях кода выбор расходился бы.
- Требование: [Что делаем, пункты 1–2](../issues/09-rework-07-item-3.md#что-делаем)
- Риски и пробелы test-ов: jsdom не считает раскладку, поэтому unit test-ы шлют `mousemove` прямо на строку; реальное
  движение мыши проверяют e2e test-ы в Changes и в Review mode. Перетаскивание за край прокрутки не прокручивает diff.

## 3. Подсказка под последней выбранной строкой

Code: `src/renderer/changes/line-pick.tsx:191-200` · key lines: 193, 196, 197

```tsx
  const hint = (line: DiffLine, side: LineSide, entry: FileEntry): ReactNode => {
    const number = lineNumber(line, side)
    if (!enabled || commenting || dragging || picked === null || picked.key !== entry.key || picked.side !== side || number !== pickRange(picked).to) return null
    const { from, to } = pickRange(picked)
    return (
      <button type="button" className="w-cl-hint nodrag" data-testid="changes-pick-hint" onClick={() => latest.current.options.open(picked.key, picked.side, from, to)}>
        {hintText(picked)}
      </button>
    )
  }
```

- Что делает: под нижней строкой выбора рисует «Comment on lines N–M (c)» (одна строка — «Comment on line N (c)»);
  щелчок открывает popover, как `c`. Пока открыт popover или идёт перетаскивание, подсказки нет.
- Почему здесь: Ticket, пункт 4, и решение 5 «Решено без владельца» — у последней строки, не в шапке. Подсказка во
  время перетаскивания сдвигала строки под указателем вниз: e2e test тянул «+» с 1 на 3 и получал 1–2.
- Без него: выбранные строки ничего не подсказывали — то, на что жаловался владелец.
- Требование: [Что делаем, пункт 4](../issues/09-rework-07-item-3.md#что-делаем)
- Риски и пробелы test-ов: Esc сначала снимает выбор, а вид закрывает только второй Esc (Changes и Review mode); это
  решение без владельца, проверено unit test-ами обоих экранов.

## 4. Main говорит, у каких файлов есть незакоммиченные правки

Code: `src/main/changes/scopes.ts:221-225` · key lines: 222, 223, 224

```ts
async function uncommittedPaths(context: ChangesContext): Promise<Set<string>> {
  const read = await context.git(context.subject.cwd, ['diff', '--name-only', '--no-renames', '-z', 'HEAD', '--'])
  if (read.code !== 0) throw failed('git diff --name-only HEAD', read)
  return new Set(splitZ(read.stdout).filter((path) => path !== ''))
}
```

- Что делает: одной командой на репозиторий читает пути, которые отличаются от HEAD в index или рабочем дереве; файл
  ответа `changes.list` получает `uncommitted`. Неудачное чтение — ошибка всего списка, а не догадка.
- Почему здесь: Ticket, пункт 6 — `git diff --name-only -z HEAD` в `src/main/changes/scopes.ts`, только чтение через
  runner ADR-0110. `--no-renames` добавлен, чтобы переименованный и не закоммиченный файл попал в список своим новым
  путём.
- Без него: renderer не мог отличить закоммиченный файл worktree от правленного и писал «uncommitted» обо всех.
- Требование: [Что делаем, пункт 6](../issues/09-rework-07-item-3.md#что-делаем)
- Риски и пробелы test-ов: contract test сравнивает `.git` до и после чтения; поле в схеме канала необязательное — ответ
  сборки до Ticket-а 09 (Linked machine) читается как раньше, «uncommitted».

## 5. Commit комментария — по файлу; после Refresh комментарий идёт за файлом

Code: `src/renderer/changes/line-comments.tsx:530-532` · key lines: 530, 531, 532

```tsx
      const now = commitOf(readOf.scope, comment.side, entry.file, scopesOf, listOf)
      const follows = comment.side === 'new' && (readOf.scope.kind === 'all' || readOf.scope.kind === 'compare') && (comment.commit === null || heads.current.has(`${entry.repo}\u0000${comment.commit}`))
      if (comment.commit !== now && !follows) continue
```

- Что делает: `commitOf` даёт новой стороне файла без незакоммиченных правок commit HEAD, файлу с ними — `null`. После
  Refresh неотправленный комментарий новой стороны All changes или Compare against ищется заново, если его commit —
  `null` или head Ticket-а, который этот вид уже читал, и получает commit нового чтения.
- Почему здесь: Ticket, пункты 7 и 8. Набор прочитанных head-ов живёт в памяти окна, а не в комментарии: формат
  комментария не меняется (решение 1 «Решено без владельца»).
- Без него: после commit-а агента комментарий с `null` больше не совпадал с commit-ом чтения и выпадал из поиска строк.
- Требование: [Что делаем, пункты 7–8](../issues/09-rework-07-item-3.md#что-делаем)
- Риски и пробелы test-ов: после перезапуска worfy набор head-ов пуст — комментарий на старом HEAD остаётся на своих
  строках и не переезжает; комментарий с `null` переезжает и тогда.

## 6. Что сознательно не меняли

`DiffPane.tsx` и рендер строк — Ticket 10 (подсветка синтаксиса). Формат строки агенту (`quote-comments.ts`). Меню
правого щелчка в Review mode. Русский перевод `pr-inbox.md` не описывает комментарии Review mode и не правился.

## 7. Как проверено

- `pnpm lint`, `pnpm typecheck` — exit 0; 20 файлов unit и contract test-ов модулей changes, pr-review, quote — exit 0.
- `pnpm test:e2e test/e2e/changes.spec.ts test/e2e/changes-comments.spec.ts test/e2e/pr-review.spec.ts` — exit 0, 7 passed.
- 22 мутанта (перетаскивание, Shift, подсказка, Esc, `uncommitted` в main, `commitOf`, Refresh) — каждый даёт exit 1
  своего test-а.

## Проверить себя

1. Почему во время перетаскивания подсказки нет?
   - Ответ: она встаёт под последней выбранной строкой и сдвигает строки ниже, так что указатель попадал бы не на ту
     строку.
   - Строки: `src/renderer/changes/line-pick.tsx:193`
2. Что вернёт «+», если отпустить его на той же строке внутри выбранного диапазона?
   - Ответ: popover на весь диапазон: без движения `onUp` идёт в `openOn`, который берёт диапазон, если строка в нём.
   - Строки: `src/renderer/changes/line-pick.tsx:138-140`
3. Почему комментарий не теряет строки, когда агент закоммитил файл после него?
   - Ответ: на новой стороне All changes комментарий с `null` или с прочитанным head-ом ищется заново и получает commit
     нового чтения.
   - Строки: `src/renderer/changes/line-comments.tsx:531-532`
