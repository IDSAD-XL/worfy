# Pull requests

> Перевод [английской версии](../pr-inbox.md), commit `same-pr`.

**PR inbox** Project-а: открытые pull request-ы (PR) пользователя и запросы ревью у него в репозиториях Project-а,
сгруппированные по тому, чей ход, с нитями ревью и их последними комментариями. В UI — **Pull requests**. Вид только
читает GitHub: ничего в нём не публикует, не закрывает нити и ничего не помечает там
([ADR-0105](../../adr/0105-pr-reply-only-on-the-users-click.md)). Термины — в [Concepts](concepts.md); badge-и PR и CI
у Ticket-а — на странице [Gate и GitHub](gate-and-github.md).

## Вид Pull requests

### Поведение

**Где открывается.**

- **Pull requests** в View switch toolbar-а — пятая вкладка после Canvas, Session, Pipeline и Runs. Без Project-а
  вкладка неактивна, tooltip говорит открыть Project.
- Строка **Pull requests** в Command palette, группа View, при открытом Project-е.
- Группа в разделе **Pull requests** sidebar-а: вид Project-а этой строки, прокрученный к этой группе, её рамка
  выделена. Строка другого Project-а сначала выбирает этот Project.

Вид принадлежит активному Project-у. У другого Project-а — свой inbox, и его строки открываются свёрнутыми.

**Группы.** Пять, всегда в этом порядке, у каждой — счётчик. Группа без PR показывает заголовок и 0.

| Группа | Что в ней |
|---|---|
| Needs my review | Ревью просят у пользователя — лично или через команду — или просят снова после его ревью |
| Needs my answer | Нерешённая нить, последний комментарий которой не пользователя, — на его PR или в нити, где он писал; упоминание пользователя новее его последнего комментария там |
| Needs a fix | PR пользователя с красным CI, запрошенными правками или конфликтом merge |
| Ready | PR пользователя одобрен, зелёный, без конфликта. Вливают люди: группа — напоминание тому, кто вливает |
| Waiting on others | PR пользователя, хода пользователя нет |

Группу и порядок внутри неё решает main: Needs my review — сначала старые PR, остальные — сначала старая активность.
PR без Ticket-а — такая же строка, как остальные.

**Строка.** Первая линия: точка CI, заголовок, `Draft` у черновика PR и возраст. Вторая: `owner/repo#N`, chip Ticket-а
(`<epic> <NN>`), если PR — Ticket-а, решение ревью (Approved, Changes requested, Review required), число открытых нитей
(«2 open threads»), «N new since you looked» и «via team», если ревью просят только у команды пользователя.

- **Точка CI**: зелёная — проходит, оранжевая — упал, пустое синее кольцо — идёт, пустое серое кольцо — CI нет. Её текст —
  tooltip.
- **Возраст**: у Needs my review — возраст PR; в остальных — его последнего комментария или ревью. В tooltip — время.
- **Chip Ticket-а**: Ticket, чья строка `PR:` называет этот PR, иначе Ticket, чья ветка — ветка PR (его строка `Branch:`
  или `<epic>/<NN>`).
- **N new since you looked**: комментарии других новее последнего взгляда пользователя на PR.

**Открытая строка.** Щелчок по строке открывает её, второй — закрывает. Открытая строка показывает:

- **Open on GitHub** и ветку PR;
- нити ревью — сначала открытые, потом решённые, приглушённые. У каждой — файл и строка, ссылка на комментарий на GitHub
  (там видна эта строка кода), `Outdated`, если код ушёл вперёд, и её последние три комментария с автором и возрастом.
  Удалённый аккаунт — `ghost`, как на GitHub;
- **Conversation**: последние комментарии вкладки разговора PR, если они есть;
- **Mark seen**, активна, пока у строки есть новые комментарии.

Открытие строки и **Mark seen** записывают, что пользователь посмотрел: «N new since you looked» гаснет. Закрытие строки
не записывает ничего. Ссылки открываются в браузере системы, никогда не в окне.

**Строка состояния** под заголовком:

- «Next search in 4 min» или «Next search now», когда время пришло; в tooltip — время;
- «The last read failed: <причина>», если последнее чтение GitHub упало или читатель ждёт rate limit;
- notice читателя, если он есть, например «GitHub notifications unavailable for this token — checking every 5 minutes»;
- «Mark seen failed: <причина>», если main не смог записать взгляд.

До первого ответа вид пишет «Reading pull requests…». Project, который не читает pull request-ы — переключатель выключен
в Project settings или ни один его репозиторий не на GitHub, — показывает об этом одну строку и ни одной группы. Чтение
без единого PR пишет «No open pull requests and no review requests.»

**Открытие на одном PR.** Вход может попросить один PR Project-а: открывается вид этого Project-а, строка PR раскрыта,
прокручена в поле зрения и помечена увиденной. Если в inbox такого PR нет, вид открывается и пишет «This pull request is
not in the inbox: owner/repo#N».

**Раздел sidebar.** **Pull requests**, под Pipeline. Для каждого Project-а Machine окна, у которого есть PR: его имя,
потом строка на каждую непустую группу со счётчиком. Project, который не читает pull request-ы или не имеет их, не
показывает ничего. Если нигде ничего нет, раздел пишет «No pull requests». Project, чей inbox не читается, пишет почему.

**Переключатель.** В Project settings — **Read pull requests from GitHub**, по умолчанию включён. Выключенный, worfy не
запускает gh для PR inbox этого Project-а, вид сразу говорит об этом, а sidebar его не показывает. Переключатель
применяется по Save, как остальные поля окна.

#### На Linked machine

Окно на Linked machine показывает inbox Project-а той Machine, как та его прочитала; само оно GitHub не спрашивает. С
доступом Read only строки открываются, но ничего не помечается увиденным, **Mark seen** неактивна с подсказкой read-only,
переключатель Project settings неактивен. Ссылки открываются на той Machine, где по ним щёлкнули.

### Как работает

- GitHub читает main — по Project-у, с GitHub-аккаунтом Project-а, только репозитории Project-а: поиск раз в 5 минут,
  потом детали сдвинувшихся PR. Main считает группы и счётчики и шлёт виду снимок
  ([ADR-0105](../../adr/0105-pr-reply-only-on-the-users-click.md), пункт 1). Вид его только рисует.
- Слова коллег остаются в памяти main. Что пользователь видел, идёт в папку данных Project-а — id, commit и время, без
  текстов ([ADR-0005](../../adr/0005-worfy-own-state-inventory.md) с поправкой ADR-0105).
- Renderer держит одну копию inbox каждого Project-а для вида и раздела. Он спрашивает main снова, когда main сообщает
  об изменении inbox и когда меняются настройки Project-а, — так переключатель виден сразу.
- Все входы, открывающие вид, идут через одну функцию. С PR она оставляет просьбу; вид берёт её, когда снимок пришёл, и
  стирает, поэтому возврат к виду не раскрывает эту строку снова.

### Реализация

| Что | Где |
|---|---|
| Вид: группы, строки, нити, строка состояния | `src/renderer/pr-inbox/PrInboxView.tsx`, `src/renderer/pr-inbox/pr-inbox.css` |
| Копия inbox в renderer; тексты строки; Ticket PR-а | `src/renderer/pr-inbox/usePrInbox.ts` |
| Открытие вида — на одном PR или на группе | `src/renderer/pr-inbox/open.ts` |
| Раздел sidebar | `src/renderer/shell/sidebar/PullRequestsSection.tsx` |
| Вкладка и вид в shell | `src/renderer/shell/Toolbar.tsx`, `src/renderer/shell/AppShell.tsx` |
| Строка palette | `src/renderer/palette/commands.ts` |
| Переключатель | `src/renderer/shell/ProjectSettings.tsx`; поле `prInbox` в `src/shared/projects/action-templates.ts` |
| Каналы `prInbox.get`, `prInbox.markSeen`, `prInbox.changed` | `src/shared/ipc/pr-inbox.ts`, `src/main/ipc/pr-inbox.ts` |
| Читатель и группы | `src/main/github/inbox.ts`, `src/main/github/inbox-groups.ts` |
| Что пользователь видел; переключатель, как его читает main | `src/main/projects/pr-inbox-state.ts` |

Test-ы: `test/unit/pr-inbox-view.test.tsx`, `test/unit/pr-inbox-open.test.tsx`, `test/e2e/pr-inbox.spec.ts`; читатель —
в `test/contract/pr-inbox.test.ts` и `test/unit/pr-inbox-groups.test.ts`.
