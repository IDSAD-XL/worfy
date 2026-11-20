# Code story — worfy-changes-view 06: Документы: перевод страниц Feature, термин Changes в CONTEXT.md

Kind: pr · Epic: worfy-changes-view · Ticket: 06 · PR: - · Language: ru

## 1. Что было не так

Ticket-ы 02–05 описали Changes только на английских страницах Feature (ADR-0088): новую `changes.md`, строку Changes в
таблице действий `workflow.md`, строку Open changes в Command palette `app-shell.md`, комментарии к строкам diff-а в
`sessions.md` и строку в `README.md`. Переводы в `docs/features/ru/` отстали, а `ru/changes.md` не было вовсе. В
`CONTEXT.md` не было термина Changes.

- Требование: [Что происходит](../issues/06-документы-перевод-context.md#что-происходит)

## 2. Английская страница: «Show whole file» — параметр канала, не кнопка

Code: `docs/features/changes.md:55-58` · key lines: 56, 57

```markdown
`linguist-generated`. A folded patch can still be asked for in full, up to 64 MB. A binary file has no lines: its
answer is the sizes of the two sides. A patch can also be read with the file's every line as context (the option
`whole` of `changes.file`); the screen has no button for it yet. A type change (a
file that became a link, or a link that became a file) shows both sides: the old side's lines deleted, then the new
```

- Что делает: заменяет фразу ««Show whole file» gives the file's every line as context» — в кавычках она читалась как надпись на экране, а такой кнопки в `src/renderer/changes/` нет.
- Почему здесь: бриф велит сверять каждое утверждение страниц с кодом Ticket-ов 03–05; перевод должен совпадать с английской страницей по смыслу, поэтому ошибку правим в обеих.
- Без него: перевод либо повторил бы неверную фразу, либо разошёлся бы с английской страницей.
- Требование: [Готово, когда](../issues/06-документы-перевод-context.md#готово-когда)
- Риски и пробелы test-ов: `check-feature-docs.mjs` проверяет только пути; верность фразы коду проверяет только чтение.

## 3. Код: `whole` — поле запроса `changes.file`

Code: `src/shared/ipc/changes.ts:145-145` · key lines: 145

```ts
/** One file's hunks; `whole` — «Show whole file», `expand` — «Show» on a folded patch. */
```

- Что делает: показывает, что «Show whole file» существует только как поле `whole` запроса `changes.file`.
- Почему здесь: это то место кода, на которое опирается новая фраза страницы.
- Без него: not recorded.
- Требование: [Готово, когда](../issues/06-документы-перевод-context.md#готово-когда)
- Риски и пробелы test-ов: когда экран получит кнопку, фразу «no button for it yet» надо будет убрать — test этого не заметит.

## 4. Английская страница: заголовок раздела Send называет и worktree

Code: `docs/features/changes.md:273-276` · key lines: 273, 274

```markdown
Send sends one message to the Session in «To»: the section «Comments on lines of the diff (N)» with the worktree and the
branch (a section per worktree and branch), then for
each comment its path and lines, its side and commit, its code quoted and its text, then «General:» and the text of the
field. It is the message the Session's own Send would make from the same drafts, comments on its messages included. A
```

- Что делает: говорит, что заголовок раздела несёт worktree и ветку, и что разделов столько, сколько пар worktree и ветки.
- Почему здесь: так собирает текст `agentText` (фрагмент ниже); `sessions.md` уже говорил «worktree …, branch …», а `changes.md` — только «with the branch».
- Без него: две страницы описывали бы одно и то же сообщение по-разному.
- Требование: [Готово, когда](../issues/06-документы-перевод-context.md#готово-когда)
- Риски и пробелы test-ов: not recorded.

## 5. Код: заголовок раздела из worktree и ветки

Code: `src/renderer/session/quote-comments.ts:339-339` · key lines: 339

```ts
    lines.push(`Comments on lines of the diff (${section.length})${first.worktree === '' ? '' : `, worktree ${first.worktree}`}${first.branch === '' ? '' : `, branch ${first.branch}`}:`, '')
```

- Что делает: строит заголовок раздела из worktree и ветки первого комментария раздела.
- Почему здесь: это код Ticket-а 04, на который опирается фраза страницы.
- Без него: not recorded.
- Требование: [Готово, когда](../issues/06-документы-перевод-context.md#готово-когда)
- Риски и пробелы test-ов: not recorded.

## 6. Перевод: строка Changes в таблице действий Workflow

Code: `docs/features/ru/workflow.md:112-113` · key lines: 113

```markdown
| Open PR | На Ticket-е с PR | Адрес на `https://github.com/` | Открывает PR в браузере и ничего не пишет в GitHub |
| Changes | На Ticket-е с веткой worktree, строкой `Branch:` или в работе; у такой карточки есть вторая строка для её действий | Всегда; на экране Linked machine только для чтения — только когда Changes Node Ticket-а уже есть | Открывает [Changes Node](changes.md#the-changes-node) Ticket-а: первый щелчок ставит его справа от полосы frame-ов на высоте Ticket-а, второй переходит к нему. Читает git и ничего не пишет |
```

- Что делает: переводит строку, которую Ticket 03 добавил в английскую таблицу; отметка перевода этой страницы — теперь SHA `ea853f5d`, а не `same-pr`.
- Почему здесь: Ticket называет `docs/features/ru/workflow.md` среди своих файлов.
- Без него: `feature-docs-lag.mjs` этого лага не видел: Ticket polish 132 правил `ru/workflow.md` позже Ticket-а 03, и отчёт считал от его commit-а.
- Требование: [Что делаем, п. 1](../issues/06-документы-перевод-context.md#что-делаем)
- Риски и пробелы test-ов: отчёт о лаге доверяет отметке `same-pr`; если правка перевода переводит не всё, лаг прячется — как было здесь.

## 7. CONTEXT.md: статья Changes

Code: `CONTEXT.md:65-67` · key lines: 66, 67

```markdown
**Changes**:
Node с diff-ом Ticket-а против базы — от merge-base с базовой веткой: commit-ы Ticket-а, ещё не закоммиченные правки и новые файлы, прочитанные из git без единой записи в репозиторий ([ADR-0110](docs/adr/0110-changes-reads-git-writes-nothing.md)), — и с комментариями к строкам, которые по Send уходят Session из списка «To» одним сообщением. У Ticket-а один Changes Node; его открывает кнопка Changes на карточке Ticket-а или Open changes в Command palette ([Changes](docs/features/changes.md)).
_Avoid_: diff view, Review pane, Files changed
```

- Что делает: вводит термин Changes в словарь, после Family, с запретными синонимами из Ticket-а.
- Почему здесь: Ticket просит статью рядом со статьями Node и Family (`CONTEXT.md:17-61`).
- Без него: экран называли бы по-разному — diff view, Review pane, Files changed.
- Требование: [Что делаем, п. 2](../issues/06-документы-перевод-context.md#что-делаем)
- Риски и пробелы test-ов: словарь ничем не проверяется.

## 8. Что сознательно не меняли

Мелкие расхождения английской страницы с кодом оставлены, их смысл верен: порядок базы (`base.ts` сначала проверяет
репозиторий без `origin` с `local-green`, итог тот же), Compare не показывает `<remote>/HEAD`, git-статус `C` (копия)
показывается как `A`. ADR и `HANDOFF.md` не тронуты.

## 9. Как проверено

`node scripts/check-feature-docs.mjs`, `node scripts/check-personal.mjs`, `node scripts/check-handoff.mjs` — exit 0;
`node scripts/feature-docs-lag.mjs` больше не называет ни одну из пяти страниц. `pnpm lint`, `pnpm typecheck`,
`pnpm test` и gate fast — в отчёте implementer-а с exit code-ами.

## Проверить себя

1. Почему правка ушла и в английскую страницу, хотя Ticket держит только переводы?
   - Ответ: фраза про «Show whole file» описывала кнопку, которой нет; перевод должен совпадать с английской страницей по смыслу, и неверную фразу пришлось бы либо повторить, либо разойтись.
   - Строки: `docs/features/changes.md:55-58`
2. Сколько разделов «Comments on lines of the diff» получит сообщение с комментариями из двух worktree?
   - Ответ: два: раздел начинается заново там, где меняются worktree или ветка, и каждый заголовок называет свои.
   - Строки: `docs/features/changes.md:273-276`
