# Code story — worfy-changes-view 09: Rework of worfy-changes-view 07, item 3

Kind: pr · Epic: worfy-changes-view · Ticket: 09 · PR: - · Language: ru

## 1. Что было не так

На приёмке Ticket-а 07 владелец сказал: «как выделять диапазон строк непонятно». Диапазон выбирался только щелчком,
щелчком с Shift и клавишей `c`, а экран об этом молчал; «+» сразу открывал popover на одну строку. Второе: текст агенту
называл каждую строку новой стороны «uncommitted», даже в чистом worktree, где всё уже в HEAD (D3).

- Требование: [Что происходит](../issues/09-rework-07-item-3.md#что-происходит)

## 2. Перетаскивание «+» — один hook на два экрана

Code: `src/renderer/changes/line-pick.tsx:152-192` · key lines: 158, 164, 170, 172, 177, 180, 181

```tsx
  const press = (start: LineAt) => {
    stop.current?.()
    const { key, side, block, line } = start
    const drag: Drag = { key, side, block, line, end: line, moved: false }
    const onMove = (event: MouseEvent) => {
      // No button held: it was let go where the window did not hear it (outside it). The drag ends, opening nothing.
      if (event.buttons === 0) {
        stop.current?.()
        return
      }
      const at = lineAt(event.target)
      // A line of another hunk of the same file is not taken: the comment would not get the lines between them.
      if (at === null || at.key !== drag.key || at.side !== drag.side || at.block !== drag.block) return
      if (at.line === drag.line && !drag.moved) return
      drag.moved = true
      drag.end = at.line
      setPicked({ key: drag.key, side: drag.side, block: drag.block, start: drag.line, end: at.line })
    }
    const onUp = () => {
      stop.current?.()
      if (!drag.moved) {
        openOn(drag.key, drag.side, drag.line, drag.block)
        return
      }
      const { from, to } = pickRange({ ...drag, start: drag.line })
      latest.current.options.open(drag.key, drag.side, from, to)
    }
    // The window lost the focus (⌘-Tab) with the button held: its mouseup may never come here.
    const onBlur = () => stop.current?.()
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onBlur)
    setDragging(true)
    stop.current = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onBlur)
      stop.current = null
      setDragging(false)
    }
  }
```

- Что делает: нажатие на «+» вешает `mousemove`, `mouseup` и `blur` на окно; движение по строкам того же hunk-а и
  стороны растягивает выбор, отпускание открывает popover на весь диапазон, а без движения — прежний путь `openOn`
  (строка или выбранный диапазон, если строка в нём). Потеря фокуса окном или движение без нажатой кнопки кончают
  перетаскивание без popover-а (ревью, раунд 2: иначе следующий mouseup где угодно открывал popover на старой строке).
  Строка другого hunk-а не берётся (раунд 2: подсказка обещала строки, которых комментарий не получал).
- Почему здесь: Ticket, пункты 1 и 2 — общий hook для Changes и Review mode PR, слушатели на `window`, строка по
  `data-side`/`data-line`; решение 6 «Решено без владельца» — `DiffPane.tsx` не трогать, его правит Ticket 10. Файл
  `.tsx`, а не `.ts`, как в Ticket-е: hook рисует «+» и подсказку.
- Без него: диапазон оставался бы скрытым приёмом (щелчок, Shift, `c`), и в двух копиях кода выбор расходился бы.
- Требование: [Что делаем, пункты 1–2](../issues/09-rework-07-item-3.md#что-делаем)
- Риски и пробелы test-ов: jsdom не считает раскладку, поэтому unit test-ы шлют `mousemove` прямо на строку; реальное
  движение мыши проверяют e2e test-ы в Changes и в Review mode. Перетаскивание за край прокрутки не прокручивает diff.

## 3. Любой способ растянуть выбор держит его в одном hunk-е

Code: `src/renderer/changes/line-pick.tsx:46-48` · key lines: 47, 48

```tsx
/** The pick stretched to a line: from the same start when the line is of its file, side and hunk, else the line alone. */
const stretched = (pick: Picked | null, at: LineAt): Picked =>
  pick !== null && pick.key === at.key && pick.side === at.side && pick.block === at.block ? { ...pick, end: at.line } : { key: at.key, side: at.side, block: at.block, start: at.line, end: at.line }
```

- Что делает: Shift с «+» (мышью и клавиатурой), щелчок с Shift по строке и выделение текста через строки растягивают
  выбор через `stretched`: строка того же файла, стороны и hunk-а (`data-block` блока DiffPane) растягивает его, строка
  другого hunk-а выбирается одна; выделение через hunk-и выбирает строку, где оно кончилось. Перетаскивание сравнивает
  тот же `block`.
- Почему здесь: ревью, раунд 3 — правило одного hunk-а было только у перетаскивания. Щелчок по строке 3, затем Shift с
  «+» на строке 10 следующего hunk-а подсвечивал 3, 4, 5, 10 и обещал «Comment on lines 3–10 (c)», а `c` в Changes
  молча открывал 3–5, в Review mode — toast о hunk-ах. Комментарий покрывает строки одного hunk-а (GitHub отказывает
  диапазону через hunk-и), поэтому выбор не выходит из hunk-а, где начат.
- Без него: подсказка называла строки, которых комментарий не получал.
- Требование: [Что делаем, пункты 3 и 5](../issues/09-rework-07-item-3.md#что-делаем)
- Риски и пробелы test-ов: hunk узнаётся по `data-block` блока `changes-hunk`; без атрибута у обеих строк (`null`)
  они считаются одним hunk-ом. DiffPane ставит его у каждого блока (`DiffPane.tsx:730`).

## 4. Подсказка под последней выбранной строкой

Code: `src/renderer/changes/line-pick.tsx:230-239` · key lines: 232, 235, 236

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

## 5. Main говорит, у каких файлов есть незакоммиченные правки

Code: `src/main/changes/scopes.ts:223-228` · key lines: 224, 225, 226

```ts
async function uncommittedPaths(context: ChangesContext): Promise<Set<string>> {
  const head = SHA.test(context.subject.headSha) ? context.subject.headSha : 'HEAD'
  const read = await context.git(context.subject.cwd, ['diff', '--name-only', '--no-renames', '-z', head, '--'])
  if (read.code !== 0) throw failed(`git diff --name-only ${head}`, read)
  return new Set(splitZ(read.stdout).filter((path) => path !== ''))
}
```

- Что делает: одной командой на репозиторий читает пути, которые отличаются от head-а ответа (`headSha`) в index или
  рабочем дереве; файл ответа `changes.list` получает `uncommitted`. Неудачное чтение — ошибка всего списка, а не
  догадка. Против `headSha`, а не живого HEAD (раунд 2): commit агента между чтением списка worktree и этим чтением
  назвал бы файл против другого commit-а, чем тот, что в ответе.
- Почему здесь: Ticket, пункт 6 — `git diff --name-only -z HEAD` в `src/main/changes/scopes.ts`, только чтение через
  runner ADR-0110. `--no-renames` добавлен, чтобы переименованный и не закоммиченный файл попал в список своим новым
  путём.
- Без него: renderer не мог отличить закоммиченный файл worktree от правленного и писал «uncommitted» обо всех.
- Требование: [Что делаем, пункт 6](../issues/09-rework-07-item-3.md#что-делаем)
- Риски и пробелы test-ов: contract test сравнивает `.git` до и после чтения; поле в схеме канала необязательное — ответ
  сборки до Ticket-а 09 (Linked machine) читается как раньше, «uncommitted».

## 6. Commit комментария — по файлу; после Refresh комментарий идёт за файлом

Code: `src/renderer/changes/line-comments.tsx:537-539` · key lines: 537, 538, 539

```tsx
      const now = commitOf(readOf.scope, comment.side, entry.file, scopesOf, listOf)
      const follows = comment.side === 'new' && (readOf.scope.kind === 'all' || readOf.scope.kind === 'compare') && (comment.commit === null || seenHead(seen, entry.repo, comment.commit))
      if (comment.commit !== now && !follows) continue
```

- Что делает: `commitOf` даёт новой стороне файла без незакоммиченных правок commit HEAD, файлу с ними — `null`. После
  Refresh неотправленный комментарий новой стороны All changes или Compare against ищется заново, если его commit —
  `null` или head Ticket-а, который этот вид уже читал, и получает commit нового чтения.
- Почему здесь: Ticket, пункты 7 и 8. Прочитанные head-ы хранятся по Ticket-у в localStorage окна
  (`src/renderer/changes/seen-heads.ts`), рядом с комментариями, а не в комментарии: формат комментария не меняется
  (решение 1 «Решено без владельца»). В первом раунде они жили в памяти вида и терялись при открытии другого Ticket-а и
  перезапуске (ревью, раунд 2).
- Без него: после commit-а агента комментарий с `null` больше не совпадал с commit-ом чтения и выпадал из поиска строк.
- Требование: [Что делаем, пункты 7–8](../issues/09-rework-07-item-3.md#что-делаем)
- Риски и пробелы test-ов: комментарий на head-е, который этот вид не читал (сделан до этого PR), не переезжает и
  остаётся на своих строках; хранится 100 новейших head-ов на Ticket.

## 7. Что сознательно не меняли

`DiffPane.tsx` и рендер строк — Ticket 10 (подсветка синтаксиса). Формат строки агенту (`quote-comments.ts`). Меню
правого щелчка в Review mode. Русский перевод `pr-inbox.md` не описывает комментарии Review mode и не правился.

## 8. Как проверено

- `pnpm lint`, `pnpm typecheck` — exit 0; 20 файлов unit и contract test-ов модулей changes, pr-review, quote — exit 0.
- `pnpm test:e2e test/e2e/changes.spec.ts test/e2e/changes-comments.spec.ts test/e2e/pr-review.spec.ts` — exit 0, 7 passed.
- 22 мутанта (перетаскивание, Shift, подсказка, Esc, `uncommitted` в main, `commitOf`, Refresh) и 6 мутантов раунда 2
  (head-ы в хранилище, hunk, blur, кнопка, `headSha`) — каждый даёт exit 1 своего test-а.
- Раунд 3: 5 мутантов, по одному на путь растяжения (Shift с «+» мышью и клавиатурой, щелчок с Shift, выделение,
  перетаскивание) без проверки hunk-а — каждый даёт exit 1 своего test-а.
- После слияния с Ticket-ом 10 (подсветка синтаксиса) его test «щелчок по цветному слову выбирает строку» показал, что
  hook требовал Session и для выбора строки щелчком; на main выбор щелчком нужен только вне read only. Опция `pickable`
  вернула это: «+», подсказка и `c` по-прежнему ждут Session.

## Проверить себя

1. Почему во время перетаскивания подсказки нет?
   - Ответ: она встаёт под последней выбранной строкой и сдвигает строки ниже, так что указатель попадал бы не на ту
     строку.
   - Строки: `src/renderer/changes/line-pick.tsx:232`
2. Что вернёт «+», если отпустить его на той же строке внутри выбранного диапазона?
   - Ответ: popover на весь диапазон: без движения `onUp` идёт в `openOn`, который берёт диапазон, если строка в нём.
   - Строки: `src/renderer/changes/line-pick.tsx:172-174`
3. Почему комментарий не теряет строки, когда агент закоммитил файл после него?
   - Ответ: на новой стороне All changes комментарий с `null` или с прочитанным head-ом ищется заново и получает commit
     нового чтения.
   - Строки: `src/renderer/changes/line-comments.tsx:538-539`
