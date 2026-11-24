# Code story — worfy-acceptance 09: Документация Acceptance: страница Feature en и ru, правки соседних страниц, термин в CONTEXT.md, инвентарь ADR-0005

Kind: pr · Epic: worfy-acceptance · Ticket: 09 · PR: - · Language: ru

## 1. Что было не так

Ticket-ы 01–08 дописывали английскую страницу `docs/features/acceptance.md` по частям, каждый свой раздел, а Ticket-ы
06 и 07 добавили входы в вид и Linked machine отдельными абзацами. Русской страницы не было, переводы шести соседних
страниц отставали от английских, термина Acceptance в `CONTEXT.md` не было, а файл отметок «Sent» не был записан в
инвентарь собственного состояния worfy (ADR-0005).

- Требование: [Что происходит](../issues/09-документация-acceptance-en-и-ru.md#что-происходит)

## 2. Строка решения на английской странице сверена с кодом

Code: `docs/features/acceptance.md:78-86` · key lines: 81, 82, 83, 85

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
Вид ручных пунктов Ticket-ов всех Project-ов Machine, которые ждут проверки владельца, с их Evidence и Stable copy; решение Pass или Fail уходит Orchestrator-у Project-а, и строку `owner-check` в Ticket пишет skill `owner-check` Harness-а, не worfy. Вкладка Acceptance окна, её tooltip — «Checks that wait for you». Не Human review: та Stage ждёт решения ревью на GitHub до merge, Acceptance читает Evidence ручных пунктов, обычно после merge ([страница Feature](docs/features/acceptance.md)).
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

- Индекс страниц `docs/features/README.md` и `docs/features/ru/README.md`: Ticket их не называет, а строки Acceptance там
  нет; вопрос передан Orchestrator-у.
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
