# Code story — worfy-acceptance 09: Документация Acceptance: страница Feature en и ru, правки соседних страниц, термин в CONTEXT.md, инвентарь ADR-0005

Kind: pr · Epic: worfy-acceptance · Ticket: 09 · PR: - · Language: ru

## 1. Что было не так

Ticket-ы 01–08 дописывали английскую страницу `docs/features/acceptance.md` по частям, каждый свой раздел, а Ticket-ы
06 и 07 добавили входы в вид и Linked machine отдельными абзацами. Русской страницы не было, переводы шести соседних
страниц отставали от английских, термина Acceptance в `CONTEXT.md` не было, а файл отметок «Sent» не был записан в
инвентарь собственного состояния worfy (ADR-0005).

- Требование: [Что происходит](../issues/09-документация-acceptance-en-и-ru.md#что-происходит)

## 2. Строка решения на английской странице сверена с кодом

Code: `docs/features/acceptance.md:79-87` · key lines: 82, 83, 84, 86

```markdown
- **Pass** and **Fail**. A click sends "Record owner check" ([Projects](projects.md), "Project settings…"): the
  Project's template with the item, the verdict, the platform, the copy and the commit, and the owner's words after it,
  to the Project's Orchestrator, into its queue while a turn runs. The item's text as the view shows it goes too: main
  refuses a decision on an item whose text has changed since ("… has changed since you looked at it: reload the
  Acceptance view"). While main has not answered, both buttons are inactive with the tooltip "Sending…". Once it has,
  the row reads **Sent · waits for the line (pass)** (or `fail`) and the next row is selected. While the item is Sent,
  its Pass and Fail stay inactive ("Sent: the decision waits for its line in the Ticket"), so a second decision is never
  sent by mistake. After 24 hours without the line, the row reads **Not recorded yet (pass)**, with **Send again**, and
  Pass and Fail are active again. A refusal of main stays under the buttons: an empty template, Autopilot, an item that
```

- Что делает: описывает, что видит владелец после Pass или Fail: отказ main при изменённом тексте пункта, tooltip
  «Sending…», строку «Sent · waits for the line» с вердиктом в скобках, «Not recorded yet» через 24 часа и Send again.
- Почему здесь: Ticket, «Что делаем», пункт 1: страницу проверить по коду и свести в один текст. Прежний текст цитировал
  строки без вердикта и не называл «Sending…»; код — `src/renderer/acceptance/AcceptanceView.tsx` (строка решения) и
  `src/main/acceptance/service.ts` (`checkDecision`).
- Без него: страница расходилась бы с экраном, а линза `documentation` считает такое расхождение ошибкой.
- Требование: [Что делаем, пункт 1](../issues/09-документация-acceptance-en-и-ru.md#что-делаем)
- Риски и пробелы test-ов: страницу проверяет только `scripts/check-feature-docs.mjs` (пути существуют); слова против
  кода никто автоматически не сверяет, сверка сделана чтением кода.

## 3. Термин Acceptance в словаре

Code: `CONTEXT.md:171-173` · key lines: 172, 173

```markdown
**Acceptance**:
Вид ручных пунктов Ticket-ов всех Project-ов Machine, которые ждут проверки владельца, и Ticket-ов, которые ждут его решения, с их Evidence и Stable copy; решение Pass или Fail уходит Orchestrator-у Project-а, и строку `owner-check` в Ticket пишет skill `owner-check` Harness-а, не worfy. Вкладка Acceptance окна, её tooltip — «Checks that wait for you». Не Human review: та Stage ждёт решения ревью на GitHub до merge, Acceptance читает Evidence ручных пунктов, обычно после merge ([страница Feature](docs/features/acceptance.md)).
_Avoid_: приёмка (как имя вида), review queue, inbox; accepted (так говорят о принятом владельцем spec-е Epic-а)
```

- Что делает: вводит Acceptance как имя вида и отделяет его от Stage Human review и от слова «accepted» у spec-а Epic-а.
- Почему здесь: текст термина и список _Avoid_ дан в Ticket-е, «Что делаем», пункт 3, и в spec-е, «Термин в CONTEXT.md»;
  отличие от Human review записано в spec-е, «Acceptance — не Human review». Место после Agent review выбрано без записанной
  причины: not recorded.
- Без него: агенты и документы называли бы вид «приёмкой», «review queue» или «inbox» и путали его с PR inbox.
- Требование: [Что делаем, пункт 3](../issues/09-документация-acceptance-en-и-ru.md#что-делаем)
- Риски и пробелы test-ов: словарь test-ом не проверяется.

## 4. Хранилище «Sent» в инвентаре ADR-0005

Code: `docs/adr/0005-worfy-own-state-inventory.md:71-79` · key lines: 72, 74, 75, 76, 78

```markdown
- 2026-11-24 — Epic `worfy-acceptance`, Ticket 09 (место добавил Ticket 01, запись в него — Ticket 03): отметки «Sent»
  вида Acceptance, `<Project data folder>/acceptance-sent.json` в `WORFY_DATA_DIR`, рядом с `pr-inbox.json`. Одна
  запись на пункт: Project, Epic, номер Ticket-а, номер пункта, hash его текста (16 знаков SHA-256), вердикт `pass` или
  `fail`, время отправки и число строк `owner-check` с этим вердиктом у пункта в тот момент. Слов владельца и текста
  пункта там нет. Пишет main (`src/main/acceptance/sent-store.ts`) через временный файл и rename: запись появляется,
  когда текст решения ушёл Orchestrator-у по каналу `actions.ownerCheck` (`'project', 'write'`), второе решение на тот
  же пункт заменяет первое, а запись удаляется, когда в checkout-е появилась новая строка `owner-check` с тем же
  вердиктом, пункт больше не ждёт владельца или его текст переписан. В Ticket и в репозиторий Project-а worfy ничего
  не пишет: строку пишет skill `owner-check` Harness-а (ADR-0002).
```

- Что делает: записывает в инвентарь файл `acceptance-sent.json`: что в нём лежит (без слов владельца и текста пункта),
  кто его пишет, когда запись появляется и когда уходит.
- Почему здесь: Ticket, «Что делаем», пункт 4, и spec, «ADR не нужен новый»: Ticket документации дописывает инвентарь.
  Форма — датированная поправка в конце файла, как требует правило проекта об ADR.
- Без него: инвентарь ADR-0005 не называл бы одно из мест, куда worfy пишет, и проверка «worfy не пишет в репозиторий
  Project-а» опиралась бы на неполный список.
- Требование: [Что делаем, пункт 4](../issues/09-документация-acceptance-en-и-ru.md#что-делаем)
- Риски и пробелы test-ов: поля сверены с `src/main/acceptance/sent-store.ts` чтением; test-а на текст ADR нет.

## 5. Что сознательно не меняли

- Заголовок перевода `docs/features/ru/README.md`: в индексы обоих языков добавлена только строка Acceptance (по просьбе
  Orchestrator-а), а прежнее отставание русского индекса от английского этот PR не догоняет.
- Английские страницы app-shell, notifications, link, projects и evidence: их абзацы об Acceptance написали Ticket-ы
  03, 04, 06 и 07; этот Ticket только переводит их. Исключение — `docs/features/workflow.md`: строка Manual check там
  ещё говорила «Picking it goes to the Ticket», а после Ticket-а 06 она открывает вид Acceptance.

## 6. Как проверено

- `node scripts/check-feature-docs.mjs` — exit 0; `node scripts/feature-docs-lag.mjs` — exit 0, ни одной из семи страниц
  в списке отстающих.
- `pnpm lint` — exit 0 (с `evidence-check`).

## Проверить себя

1. Как worfy отличает новую строку `owner-check` от старой с тем же вердиктом, не храня текст Ticket-а?
   - Ответ: запись держит число строк `owner-check` с этим вердиктом у пункта в момент отправки; строка пришла, когда их
     стало больше.
   - Строки: `docs/adr/0005-worfy-own-state-inventory.md:74-77`
2. Чем Acceptance отличается от Stage Human review, по словарю?
   - Ответ: Human review ждёт ревью на GitHub до merge, Acceptance читает Evidence ручных пунктов, обычно после merge.
   - Строки: `CONTEXT.md:172`
3. Когда запись в `acceptance-sent.json` удаляется, кроме прихода строки `owner-check`?
   - Ответ: когда пункт больше не ждёт владельца или его текст переписан.
   - Строки: `docs/adr/0005-worfy-own-state-inventory.md:77-78`

## 7. Что нашёл review и что осталось

> VERIFIED — worfy-acceptance 09 (Acceptance documentation: the Feature page in English and Russian, the neighbouring pages, the term in CONTEXT.md, the ADR-0005 inventory), head e2acde9dbbbafdff86a20dfbde9b5baa40402c17
>
> Gate (depth low, one round): reviewer (lens: documentation accuracy) — MERGE with lows; the two lows fixed by the Orchestrator (e2acde9db).
>
> - What it gives: docs/features/acceptance.md as one text for the whole Epic (queue and groups, the Stable copy line and its reasons, Pass and Fail with Sent / Not recorded yet / Send again, the owner-check line, the Linked machine rules, the ways in: sidebar section, rail badge, palette rows, notification click with the Pipeline fallback); a new docs/features/ru/acceptance.md; the Russian pages projects, evidence, app-shell, notifications, link and workflow brought fully up to date with their English pages; the Acceptance row in both README indexes; the term Acceptance in CONTEXT.md; a dated amendment of ADR-0005 (acceptance-sent.json written through a temporary file and rename, the Sent mark kept only after the send).
> - Reviewer: 30 claims of the English page checked against the code at c4023c2f9, all hold (exact UI strings, the Stable copy kinds and reasons, 24 h / 60 s / 5 min / 14 days, the acceptance-sent.json fields, the Linked machine rules, the refusals); the Russian page matches the English one section by section, UI names in exact English text, no banned metaphors; three sections of each of the six other Russian pages match their English pages.
> - Fixed by the Orchestrator: a Linked build with uncommitted changes gives no commit (`-`) — en and ru pages; the CONTEXT.md term also names the Tickets that wait for the owner's decision; the story fragments follow.
> - Evidence: check-feature-docs EXIT=0; feature-docs-lag EXIT=0 (none of the seven pages behind); story-check EXIT=0; evidence-check --changed EXIT=0; pnpm lint EXIT=0 (implementer); gate fast «nothing ran» on the documents-only diff — not counted as green; full pnpm test EXIT=0 before the rebase.
> - Debt (low): docs/features/ru/README.md translation header names an older commit (feature-docs-lag lists 15 other translations behind).
> - Not verified: screenshots or a run of the app (documents only).
>
> Decided without the owner (to confirm): the ADR-0005 amendment written by the implementer (the file is in the ticket's list); docs/features/workflow.md corrected outside the ticket's file list (after ticket 06 a Manual check row opens the Acceptance view); the term Acceptance placed after Agent review in CONTEXT.md, «accepted» added to Avoid; the README index rows added.
