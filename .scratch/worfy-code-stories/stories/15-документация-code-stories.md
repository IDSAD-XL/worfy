# Code story — worfy-code-stories 15: Документация: `docs/features/code-stories.md` (en и ru), термины в `CONTEXT.md`

Kind: pr · Epic: worfy-code-stories · Ticket: 15 · PR: - · Language: ru

## 1. Что было не так

Ticket-ы 01–14 и 16 построили Code stories: формат и `story-check` в Harness-е, story PR и guard в `land`, story Epic-а,
вид Story, story по кнопке, вопрос к строкам, «Проверить себя». Страницы Feature о них не было: куски поведения worfy
описаны на странице Workflow, Harness-часть — нигде в `docs/features/`. В `CONTEXT.md` не было термина Code story.

- Требование: [Что происходит](../issues/15-документация-code-stories.md#что-происходит)

## 2. Guard на merge описан по веткам кода `land`, с тем, что он не проверяет

Code: `docs/features/code-stories.md:121-131` · key lines: 129, 130, 131

```md
**The merge guard.** With the switch on, `land` does not merge a PR of its state file that names an Epic and a Ticket
unless its head holds exactly one story of that Ticket and `story-check --repo <repo> --head <head>` is green on it.

| What `land` finds | What happens |
|---|---|
| No story at the head | The PR waits red: `no Code story of ticket <epic> <NN>: <dir>/<NN>-<slug>.md is not in the head <short sha> (code_stories.pr is on)`; in Silent mode `is not in the tickets folder` |
| Two stories of the Ticket | The PR waits red: `ticket <epic> <NN> has <n> Code stories` |
| `story-check` exits 2 | The PR waits red with the first problem |
| The Profile cannot be read (`bin/profile` exit 1), or `story-check` cannot check | The PR waits, never merged |
| The checkout has no Profile (`bin/profile` exit 3) | No story is asked for |
| A PR without a Ticket; a documents PR | Not checked |
```

- Что делает: перечисляет, что `land` делает с PR Ticket-а при включённом `code_stories.pr`: красное ожидание без story,
  с двумя story и с красным `story-check`, простое ожидание, когда Profile или `story-check` не отвечают, и отсутствие
  требования, когда у checkout-а нет Profile (exit 3); PR без Ticket-а и documents PR не проверяются.
- Почему здесь: Ticket называет guard на merge в «Что делаем», п. 1; строки взяты из `storyGreen` и `storiesOn` в
  `harness/bin/land`.
- Без него: читатель решил бы по spec-у, что guard останавливает любой PR, а при сломанном Profile — вливает.
- Требование: [Что делаем, п. 1](../issues/15-документация-code-stories.md#что-делаем)
- Риски и пробелы test-ов: текст сообщений проверен глазами по коду; `scripts/check-feature-docs.mjs` проверяет только
  пути, не смысл.

## 3. Входы названы так, как их пишет код, а не spec

Code: `docs/features/code-stories.md:226-235` · key lines: 230, 233

```md
**The entries.**

| Where | What it does |
|---|---|
| **Code story** on the Epic frame, beside the button of its archived Sessions | Opens the Epic's `story.md`; without one, builds the story of the Epic so far by the button |
| **Code story** in the Epic frame's **⋯** | Opens `story.md`; only while the Epic has one |
| **Code story** on a Ticket card, right of **Open PR** | Opens the story of the Ticket's PR; without one and with a `PR:` line, builds it by the button. Inactive, with the reason, on a done Ticket that names no PR; absent on a Ticket that is not done and has neither a PR nor a story |
| **Code story** of a pull request in [Pull requests](pr-inbox.md) | Opens the story of the PR's Ticket when the Tickets root has one; otherwise builds the PR's story by the button, or opens the one kept before. **Rebuild story**, once one is kept, builds it again |
| **Open code story** in the Command palette (group View) | A row per Epic with `story.md` and per Ticket with a PR story |
| The toast "The Code story of Epic <epic> is ready" with **Open** | Opens the Epic's story |
```

- Что делает: перечисляет все входы в вид Story и что каждый делает без файла story: кнопки «Code story» на рамке
  Epic-а, в её «⋯», на карточке Ticket-а и в Pull requests, команду «Open code story» и toast.
- Почему здесь: Ticket просит «вид Story и все входы» (п. 1); названия взяты из `EpicStory.tsx`, `TicketStory.tsx`,
  `AutopilotAction.tsx`, `PrInboxView.tsx` и `palette/commands.ts`.
- Без него: страница повторила бы spec — кнопку «Story» рядом с «History», — а в коде кнопка называется «Code story» и
  стоит рядом с кнопкой архивных Session-ов.
- Требование: [Что делаем, п. 1](../issues/15-документация-code-stories.md#что-делаем)
- Риски и пробелы test-ов: подписи UI в тексте не сверяет ни один test; переименование кнопки страницу не сломает.

## 4. На Linked machine запись идёт каналами `write`

Code: `docs/features/code-stories.md:323-329` · key lines: 327, 328

```md
#### On a Linked machine

A window that shows a Project of a Linked machine ([Link](link.md)) sends every call of the Story view to that Machine:
the stories, `stories.json`, `gh`, the Vendor and the checkout are its. Opening and reading a story, its code, its
answers and its marks are reading, open with read-only access. Building a story, asking about lines, keeping a read mark
or an answer of "Check yourself" and Stop are writing: with read-only access the link refuses them. The build buttons
are then inactive with the reason, and so is the switch **Code stories for PRs**, which still shows the value.
```

- Что делает: говорит, что окно Linked machine вызывает всё на Machine Project-а, что чтение story открыто при доступе
  только на чтение, а сборка, вопрос, отметки, ответы «Проверить себя» и Stop — запись, которую link тогда отвергает.
- Почему здесь: Ticket просит «что видно на Linked machine» (п. 1); деление каналов — метки `read` и `write` в
  `src/shared/ipc/stories.ts`, их держит `test/unit/link-access.test.ts`.
- Без него: человек с доступом только на чтение не знал бы, что сборка, вопрос и отметки там не работают.
- Требование: [Что делаем, п. 1](../issues/15-документация-code-stories.md#что-делаем)
- Риски и пробелы test-ов: поведение окна при отказе link-а для вопроса и отметок по коду renderer-а не видно: там нет
  своей проверки доступа, страница называет только отказ link-а.

## 5. Шаг story — не Card

Code: `CONTEXT.md:215-217` · key lines: 216

```md
**Story step**:
Часть Code story: фрагмент кода с главными строками и пятью полями (что делает, почему здесь, без него, требование, риски и пробелы test-ов) или текст под постоянным заголовком — «Что было не так», «Стыки между Ticket-ами». Шаг story — не Card: Card — Node Canvas-а.
_Avoid_: карточка, card, слайд
```

- Что делает: заводит термин Story step и правило «шаг — не Card» рядом с тремя другими терминами Epic-а в разделе
  «Workflow».
- Почему здесь: Ticket называет `CONTEXT.md`, раздел «Workflow», и четыре термина (п. 3); правило — решение владельца 3
  spec-а.
- Без него: части story называли бы карточками, а Card уже значит Node Canvas-а.
- Требование: [Что делаем, п. 3](../issues/15-документация-code-stories.md#что-делаем)
- Риски и пробелы test-ов: словарь ничем не проверяется.

## 6. «Спросить автора» — по итогу замера

Code: `docs/features/code-stories.md:400-403` · key lines: 401

```md
- **"Ask the author".** There is no button that resumes the implementer to answer a question. A measurement asked five
  questions about lines of PR stories: a new request scored 19 of 20 and the resumed implementer 19 of 20, so the author
  was not better ([the measurement](../../.scratch/worfy-code-stories/measure-ask-author.md)). A question goes to a new
  request.
```

- Что делает: записывает, что кнопки «Ask the author» нет, и даёт числа замера Ticket-а 16 со ссылкой на заметку.
- Почему здесь: Ticket требует раздел «чего нет» с «Спросить автора» по итогу замера Ticket-а 16 (п. 1).
- Без него: читатель искал бы кнопку, которую spec когда-то обсуждал.
- Требование: [Что делаем, п. 1](../issues/15-документация-code-stories.md#что-делаем)
- Риски и пробелы test-ов: числа взяты из `measure-ask-author.md`; если замер повторят, страница устареет молча.

## 7. Что сознательно не меняли

Страницы Workflow, Projects и Vendors уже описывают части Code stories (код Ticket-ов 08–13, 03 и 04): их текст не
тронут, новая страница на них ссылается. Устаревшая строка `harness/profiles/README.md` о том, что guard «ещё не
построен», вне следа Ticket-а и осталась как есть. Русская страница — перевод английской, `same-pr`.

## 8. Как проверено

- Каждое утверждение страницы сверено с кодом в два раунда: в первом — по заметкам трёх разведчиков с `file:line` и
  выборочным перечитыванием строк; во втором — три свежих проверки по частям готового текста, утверждение за
  утверждением. Расхождения второго раунда исправлены, разница со spec-ом и Ticket-ами — в «Итог» Ticket-а.
- `pnpm lint` (с `scripts/check-feature-docs.mjs` и `scripts/check-personal.mjs`) — exit 0; gate fast — exit 0.

## Проверить себя

1. Почему guard на merge стоит в `land`, а не в gate?
   - Ответ: gate идёт на каждом head ветки, и до story тоже; `land` — единственное место merge PR Ticket-а, он знает
     Epic, Ticket и head и сам читает выключатель.
   - Строки: `docs/features/code-stories.md:174-176`
2. Что увидит человек на Linked machine с доступом только на чтение, когда нажмёт сборку story?
   - Ответ: ничего не начнётся: кнопка сборки неактивна с причиной, потому что сборка пишет данные Project-а, а запись
     идёт каналом `write`, который link при таком доступе отвергает.
   - Строки: `docs/features/code-stories.md:327-329`
