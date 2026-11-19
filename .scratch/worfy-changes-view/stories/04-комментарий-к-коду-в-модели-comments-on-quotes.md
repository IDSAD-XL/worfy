# Code story — worfy-changes-view 04: Комментарий к коду в модели Comments on quotes

Kind: pr · Epic: worfy-changes-view · Ticket: 04 · PR: - · Language: ru

## 1. Что было не так

Comments on quotes умели комментировать только текст ответа агента: комментарий знал сообщение (`anchor`) и диапазон в
нём, хранилище неотправленных комментариев держало только такие записи (схема `v: 2`), а текст для агента имел один
раздел «Comments on parts of your messages». Экрану Changes (Ticket 05) нужен комментарий к строкам файла diff-а в том же
лотке и в той же пачке. Этот PR даёт модель: вариант `code` у `QuoteComment`, схему `v: 3`, второй раздел текста для
агента, его разбор для пузыря и поиск строки после Refresh.

- Требование: [Что происходит](../issues/04-комментарий-к-коду-в-модели-comments-on-quotes.md#что-происходит)

## 2. Комментарии к коду идут после комментариев к сообщениям

Code: `src/renderer/session/quote-comments.ts:210-220` · key lines: 213, 214, 215

```ts
export function inTextOrder<T extends QuoteComment>(comments: readonly T[], order?: (anchor: string) => number | undefined): T[] {
  const place = (comment: MessageComment): number => order?.(comment.anchor) ?? comment.messageAt ?? comment.at
  return [...comments].sort((a, b) => {
    if (a.kind === 'code' || b.kind === 'code') {
      if (a.kind !== 'code') return -1
      if (b.kind !== 'code') return 1
      return byText(a.worktree, b.worktree) || byText(a.branch, b.branch) || byText(a.path, b.path) || byText(a.side, b.side) || a.startLine - b.startLine || a.at - b.at
    }
    return place(a) - place(b) || (a.anchor === b.anchor ? a.start - b.start : byText(a.anchor, b.anchor)) || a.at - b.at
  })
}
```

- Что делает: `QuoteComment` теперь объединение `MessageComment | CodeComment`; `inTextOrder` ставит каждый комментарий к
  коду после всех комментариев к сообщениям, а комментарии к коду — по worktree, ветке, файлу, стороне и первой строке.
  Порядок комментариев к сообщениям не меняется.
- Почему здесь: `composeRound` (только читать, по брифу) прикладывает картинки в порядке `inTextOrder`, а `agentText`
  нумерует `[image N]` в порядке разделов. Чтобы номера совпали с вложениями без правки `composeRound`, порядок раунда
  должен совпадать с порядком разделов.
- Без него: картинка комментария к коду, стоящего в раунде раньше комментария к сообщению, получила бы чужой номер
  `[image N]`, и пузырь показал бы её не под тем комментарием.
- Требование: [Что делаем, пункты 1 и 3](../issues/04-комментарий-к-коду-в-модели-comments-on-quotes.md#что-делаем)
- Риски и пробелы test-ов: сортировка строк — по кодам UTF-16, не по локали; для порядка в тексте агента это всё равно.

## 3. Второй раздел текста для агента

Code: `src/renderer/session/quote-comments.ts:336-348` · key lines: 339, 341, 342, 344

```ts
  for (const section of codeSections(items.filter((item): item is AgentCodeItem => item.kind === 'code'))) {
    const [first] = section
    if (first === undefined) continue
    lines.push(`Comments on lines of the diff (${section.length})${first.worktree === '' ? '' : `, worktree ${first.worktree}`}${first.branch === '' ? '' : `, branch ${first.branch}`}:`, '')
    section.forEach((item, index) => {
      lines.push(`${index + 1}. ${linesLabel(item.path, item.startLine, item.endLine)} (${item.side} side, ${item.commit === null ? 'uncommitted' : `commit ${item.commit.slice(0, COMMIT_SHOWN)}`})`)
      for (const line of codeForAgent(item.code)) {
        const shown = line.replace(/\s+$/, '')
        lines.push(`${INDENT}>${shown === '' ? '' : ` ${shown}`}`)
      }
      body(item)
    })
  }
```

- Что делает: после раздела комментариев к сообщениям пишет «Comments on lines of the diff (N), worktree …, branch …:»,
  по комментарию — `путь:строки (new side, commit 9f8e7d6)` или `(…, uncommitted)`, строки кода как `   > …`
  (`codeForAgent` режет больше 6 строк: три первые, «…», две последние), затем комментарий и `[image N]`. Новый раздел
  начинается, где меняются worktree или ветка. `parseQuoted` читает этот раздел обратно: строк `>` он берёт столько,
  сколько их написано для диапазона (не больше 6), поэтому комментарий, начатый с «>», остаётся текстом.
- Почему здесь: формат — пример spec-а («Решения по реализации — часть 1» → «Комментарии к строкам»); пузырь читает
  блоки из текста сообщения, чтобы рестарт ничего не менял.
- Без него: агент не получил бы файл, строки и код, а пузырь показал бы сообщение сырым текстом.
- Требование: [Что делаем, пункты 3 и 4](../issues/04-комментарий-к-коду-в-модели-comments-on-quotes.md#что-делаем)
- Риски и пробелы test-ов: commit пишется первыми 7 знаками; путь с переводом строки сломал бы разбор — такого test-а
  нет. Раздел на каждую пару worktree и ветка — решение этого PR, в spec-е показан один раздел.

## 4. Схема хранилища `v: 3`, и `v: 2` читается

Code: `src/renderer/session/quote-store.ts:74-76` · key lines: 75, 76

```ts
/** The schema this version writes; an entry of `v: 2` still reads (its comments are all on quotes). */
const VERSION = 3
const entrySchema = z.object({ v: z.union([z.literal(2), z.literal(VERSION)]), at: z.number(), drafts: z.array(draftSchema), pending: z.array(pendingSchema), rounds: z.array(roundSchema), sent: z.array(sentSchema) })
```

- Что делает: запись хранилища принимает `v: 2` и `v: 3`; `drafts` и комментарии ожидающих раундов — объединение схемы
  комментария к коду и прежней схемы комментария к цитате. Запись всегда пишет `v: 3`. Отправленный комментарий к коду в
  `sent` не попадает (`settlePending` берёт `onMessages`): тусклого следа в транскрипте у него нет.
- Почему здесь: Ticket, «Что делаем», пункт 2: запись `v: 2` читается как есть и переписывается в `v: 3` при следующей
  записи.
- Без него: после обновления все неотправленные комментарии пользователя пропали бы — запись другой версии читается
  как пустая.
- Требование: [Что делаем, пункт 2](../issues/04-комментарий-к-коду-в-модели-comments-on-quotes.md#что-делаем)
- Риски и пробелы test-ов: прежняя версия worfy прочтёт запись `v: 3` как пустую (откат теряет черновики); это не
  проверено и не записано как решение.

## 5. В памяти нет номера схемы

Code: `src/renderer/session/quote-store.ts:108-113` · key lines: 111, 112

```ts
        const parsed = entrySchema.safeParse(JSON.parse(storage.getItem(name) ?? 'null'))
        if (parsed.success) {
          // Memory keeps no schema version: the next write is this version's.
          const { at, drafts, pending: waiting, rounds, sent } = parsed.data
          entries.set(name.slice(PREFIX.length), { at, drafts, pending: waiting, rounds, sent })
        }
```

- Что делает: из прочитанной записи в память идут только поля состояния, без `v`.
- Почему здесь: прежний код клал в память запись целиком, вместе с `v`, и писал `{ v: 2, ...state }` — номер из памяти
  перекрыл бы номер новой версии. Test миграции ловил именно это.
- Без него: запись `v: 2` после правки снова ушла бы в хранилище как `v: 2`.
- Требование: [Что делаем, пункт 2](../issues/04-комментарий-к-коду-в-модели-comments-on-quotes.md#что-делаем)
- Риски и пробелы test-ов: не записано

## 6. Строка комментария после Refresh

Code: `src/renderer/session/quote-comments.ts:250-260` · key lines: 255, 257, 259

```ts
export function anchorLines(file: string, kept: { startLine: number; code: string }): { startLine: number; endLine: number } | { mark: typeof LINE_CHANGED } {
  const lines = file.split(/\r?\n/)
  const wanted = kept.code.split(/\r?\n/)
  const fits = (from: number): boolean => from >= 0 && from + wanted.length <= lines.length && wanted.every((line, index) => lines[from + index] === line)
  const was = kept.startLine - 1
  let best: number | null = fits(was) ? was : null
  for (let from = 0; best !== was && from + wanted.length <= lines.length; from += 1) {
    if (fits(from) && (best === null || Math.abs(from - was) < Math.abs(best - was))) best = from
  }
  return best === null ? { mark: LINE_CHANGED } : { startLine: best + 1, endLine: best + wanted.length }
}
```

- Что делает: ищет строки комментария в новом тексте файла: на старом месте, если они там, иначе ближайшее совпадение
  к старому месту, как `anchorRange` для цитат; нет совпадения — `{ mark: 'Line changed' }`. CRLF не мешает.
- Почему здесь: Ticket, «Что делаем», пункт 5, называет чистую функцию `anchorLines`; вызывать её после Refresh будет
  Ticket 05.
- Без него: Ticket 05 не смог бы перенести комментарий на сдвинутую строку.
- Требование: [Что делаем, пункт 5](../issues/04-комментарий-к-коду-в-модели-comments-on-quotes.md#что-делаем)
- Риски и пробелы test-ов: строки сравниваются точно, без пробелов в конце; одинаковые строки в двух местах выбираются по
  близости, и это может быть не та копия.

## 7. Что сознательно не меняли

`composeRound` не менялся: его отказы (команда со `/`, больше 10 картинок, больше вложений, чем берёт сообщение) действуют
и на комментарии к коду. Вид Session для старых цитат тот же: шапка лотка «N comments on M messages» и блоки пузыря
прежние, пока в раунде нет комментария к коду. Chip комментария к коду не кнопка: переход к строке в Changes — Ticket 05.
`quote-comments.css` не правился: код в пузыре держит переносы строк через inline style.

## 8. Как проверено

`pnpm lint && pnpm typecheck && pnpm test` — exit 0; `gate fast` — exit 0. Пять мутантов хранилища (не читать `v: 2`,
писать `v: 2`, без схемы кода, без проверки порядка строк, отправленный код в `sent`) и четыре мутанта модели (код
раньше сообщений, без обрезки 6 строк, `anchorLines` без «ближайшего», жадный разбор `>`) — каждый краснит test.

## Проверить себя

1. Почему комментарии к коду в раунде должны стоять после комментариев к сообщениям?
   - Ответ: `composeRound` прикладывает картинки в порядке раунда, а `agentText` нумерует `[image N]` в порядке разделов;
     иначе номера разойдутся с вложениями.
   - Строки: `src/renderer/session/quote-comments.ts:213-215`
2. Что случилось бы с черновиком из схемы `v: 2`, если бы в память шла запись целиком?
   - Ответ: `v: 2` из памяти уехал бы в следующую запись, и хранилище так и не перешло бы на `v: 3`.
   - Строки: `src/renderer/session/quote-store.ts:111-112`
