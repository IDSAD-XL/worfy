# Code stories

> Перевод [английской версии](../code-stories.md), commit `same-pr`.

**Code story** — короткий рассказ о готовом изменении для того, кто отвечает за код. Он состоит из **шагов** (Story
step): ключевой фрагмент diff-а с отмеченными главными строками, что делает код, зачем он здесь, что сломается без него,
какому требованию он служит и чего не проверяют test-ы. Видов три: **story PR**, которую implementer Ticket-а пишет в
свой же PR; **story Epic-а**, которую Subagent Orchestrator-а пишет перед merge последнего PR Epic-а с кодом; и **story
по кнопке**, которую worfy собирает по запросу для PR или Epic-а, у которых story нет. Любой вид worfy показывает в
**виде Story**: там можно спросить о строках, проверить своё понимание и увидеть, какие шаги уже прочитаны. Термины
объяснены в [Concepts](concepts.md). Карточка Ticket-а, рамка Epic-а и то, как worfy читает Epic, — на странице
[Workflow](workflow.md); story лежит рядом с [Evidence](evidence.md) Ticket-а. План и причины — в spec Epic-а
[worfy-code-stories](../../../.scratch/worfy-code-stories/spec.md).

Шаг — не Card: Card — Node Canvas-а ([Cards](cards.md)), а шаг — часть story.

## Code story

### Behaviour

**Файл.** Story — Markdown, который человек читает на GitHub, а worfy — в виде Story:

````markdown
# Code story — orders-export 04: Totals in cents

Kind: pr · Epic: orders-export · Ticket: 04 · PR: #212 · Language: en

## 1. What was wrong
…
- Requirement: [What happens](../issues/04-totals-in-cents.md#what-happens)

## 2. The total is summed in cents
Code: `src/cart.ts:12-19` · key lines: 15, 16
```ts
…
```
- What it does: …
- Why here: …
- Without it: not recorded
- Requirement: [What we do, item 1](../issues/04-totals-in-cents.md#what-we-do)
- Risks and test gaps: …
````

- **Заголовок** — `Code story — <epic> <NN>: <title>` у PR Ticket-а, `Code story — PR #<N>: <title>` у PR вне
  Ticket-а и `Code story — <epic>` у Epic-а.
- **Шапка** — поля `Kind:` (`pr` или `epic`), `Epic:`, `Ticket:` (две цифры), `PR:` (`#<N>` или `-`, пока PR не
  открыт) и `Language:` — код `language.reports` из Profile. Story, закоммиченная в ветку, commit не называет. У story PR
  по кнопке есть `Commit:` — head её PR; story Epic-а по кнопке вместо него называет head PR каждой главы.
- **Code-шаг** — один фрагмент (строка `` Code: `<path>:<from>-<to>` · key lines: <n> `` и эти строки файла, скопированные
  точно) и пять полей, каждое — пункт списка `- <label>: <text>`: **What it does**, **Why here**, **Without it**,
  **Requirement** (ссылка на раздел Ticket-а или spec-а) и **Risks and test gaps**. Поле, причину которого никто не
  записал, говорит `not recorded` и никогда не угадывает.
- **Frame-шаг** — текст под постоянным заголовком: **What was wrong** (первый, с Requirement), **What was deliberately
  not changed**, **How it was checked**, **What review found and what remains** (последний) и в story Epic-а **Seams
  between tickets**. Фрагменты цитирует только шаг review.
- **Порядок** — порядок объяснения, а не файлов: сначала что было не так, потом code-шаги, потом что не меняли и как
  проверено, шаг review — последним.
- **Check yourself** в конце — по желанию: два-три вопроса, у каждого `Answer:` и `Lines:`, на которые он опирается.
  От ответов ничего не зависит.
- **Язык.** При `Language: ru` подписи русские, при любом другом языке — английские. `Code:`, `key lines:`, `done:` и
  `Ready:` остаются английскими в любом языке.
- **Размер** — ориентир для автора: один-три code-шага у маленького PR, до десяти у большого, пять-десять главных шагов у
  Epic-а. По размеру story никто не отвергает.

**Story Epic-а** состоит из разделов `Start` (что Epic взялся исправить, со ссылкой на его `spec.md`), по главе на PR с
заголовком `## PR #<N> · <NN> — <ticket title>`, шага `Seams between tickets`, `Summary` и `Check`. Шаги нумеруются
сквозь всю story. У главы, чей PR не влит, в заголовке `PR -`, а в теле только `Ready: no — <why>`. Шаг Seams
перечисляет, что Ticket-ы передали друг другу, по пункту на передачу: `- <NN> → <NN>: <what> · done: yes` или
`· done: no — <why>` для той, которую никто не сделал.

**Три вида.**

| Вид | Кто пишет | Когда | Где |
|---|---|---|---|
| Story PR | Implementer Ticket-а | Последним шагом перед `gh pr create`, после Evidence-строк | `<tickets root>/<epic>/stories/<NN>-<slug>.md`, в том же PR |
| Story Epic-а | Subagent Orchestrator-а, видный на Canvas, как любой другой | Перед тем как `land` вливает последний PR Epic-а с кодом | `<tickets root>/<epic>/story.md`, в documents PR этого merge |
| Story по кнопке | Невидимый запрос worfy | Когда человек нажимает **Code story** там, где файла story нет | `stories.json` в папке данных worfy этого Project-а, на Machine Project-а |

У implementer-а просят решения и доказательства к ним, а не запись хода рассуждений. **Why here** содержит только то, что
записано в Ticket-е, spec-е, ADR или diff-е: когда Ticket называет файл среди своих файлов, шаг так и говорит, а причина
правила остаётся `not recorded`, пока её нигде не записали. Кто ещё вызывает код и мотив никогда не угадываются.

**Full mode и Silent mode** ([Projects](projects.md)).

- **Full mode.** Story PR коммитится в PR Ticket-а. Сразу после `gh pr create` описание PR получает раздел
  `## Code story` с путём story и ссылкой на неё в ветке. Story Epic-а попадает в main branch с documents PR, поэтому в
  Full mode она читается на GitHub, в том числе с телефона.
- **Silent mode.** Story лежат в Workflow folder, ветка ничего не получает. Описание PR ссылки не получает. `land` не
  дописывает шаг review — его дописывает Orchestrator в Workflow folder. Story Epic-а `land` копирует в Workflow folder.

**`story-check`.** Script Harness-а проверяет story перед commit-ом и перед merge:

```text
story-check [--head <commit>] [--pr-head <N>=<commit>]... [--repo <dir>] <story>...
```

- Он проверяет заголовок и шапку, нумерацию шагов, один фрагмент и все поля каждого code-шага, что Requirement — ссылка
  или `not recorded`, порядок разделов story Epic-а и форму каждой передачи, и каждый фрагмент построчно с кодом. Ещё он
  ищет личные данные по правилам privacy check со страницы [Evidence](evidence.md#privacy-check) — имя машины, имя
  пользователя в пути, email или token. Каждая строка его вывода маскируется.
- **С каким кодом он сверяет.** `--head` называет commit для всех фрагментов. Без него story, ещё не закоммиченная,
  читается против рабочего дерева, а закоммиченная — против `HEAD`. `--pr-head <N>=<commit>` читает главу `## PR #<N>`
  story Epic-а против этого commit-а, по одному на главу.
- Без `--head` на main branch он отказывается: story проверяется по head своего PR, поэтому на main branch этот head
  называют через `--head`, как делает `land`. Ещё он отказывает закоммиченной story, у которой
  в цитируемом файле есть незакоммиченные изменения: «commit the code first, then check the story».
- **Вывод.** По строке на проблему, `<story>:<step>: <what is wrong>`, затем `<story>: <N> fragments checked against
  <anchor>`, затем `<story>: ok` или `<story>: <N> problems`. Exit 0 — зелёно, 2 — красно, с перечнем, 1 — проверить
  не удалось (причина в stderr) или ошибка вызова.

**Выключатель `code_stories.pr`.** Story PR включена по умолчанию: поле Profile `code_stories.pr` — `"on"` или `"off"`,
а Profile без него или с `null` читается как включённый; любое другое значение тоже читается как `on`, с
предупреждением. В **Project settings…** тумблер **Code stories for PRs** пишет поле сразу, а не по Save («The
implementer writes a short step-by-step story of each ticket's PR. Saved in the Project's Profile at once; applies to
the next ticket.»). Как тумблер пишет Profile — на странице [Projects](projects.md). Когда выключено, implementer пишет
«Code story skipped: code_stories.pr is off», а `land` story не требует. С финишем `local-green` нет ни PR, ни story.

**Guard на merge.** При включённом выключателе `land` не вливает PR своего state-файла, который называет Epic и Ticket,
пока в его head нет ровно одной story этого Ticket-а и `story-check --repo <repo> --head <head>` на ней не зелёный.

| Что находит `land` | Что происходит |
|---|---|
| В head нет story | PR ждёт красным: `no Code story of ticket <epic> <NN>: <dir>/<NN>-<slug>.md is not in the head <short sha> (code_stories.pr is on)`; в Silent mode — `is not in the tickets folder` |
| У Ticket-а две story | PR ждёт красным: `ticket <epic> <NN> has <n> Code stories` |
| `story-check` вернул 2 | PR ждёт красным, с первой проблемой |
| Profile не читается (`bin/profile` exit 1) или `story-check` не может проверить | PR ждёт и не вливается |
| У checkout-а нет Profile (`bin/profile` exit 3) | Story не требуется |
| PR без Ticket-а; documents PR | Не проверяется |

Story читается из head PR, никогда из рабочего дерева checkout-а; в Silent mode — из папки, которую печатает
`ticket root`. В Full mode story, зелёная на этом head, повторно на нём не проверяется.

**Verifier.** Линза «отчёт implementer-а» у reviewer-а считает story тоже утверждением: каждое её высказывание верно по
коду, `story-check --repo <the PR's worktree> --head <head>` возвращает 0, и ни одно поле не называет вместо
`not recorded` причину, которой нет ни в Ticket-е, ни в spec-е, ни в diff-е, ни в отчёте. Неверное высказывание —
находка того же веса, что дефект в коде.

**What review found and what remains.** После merge documents PR от `land` дописывает этот шаг последним в story PR в
main branch — из файла вердикта, который даёт ему Orchestrator (`prs[].verdict`), без модели: вердикт цитируется как
есть, а для каждого `path:<line>`, который он называет, — эти строки влитого head, если там всё ещё то, что проверило
review. Фрагмент с личными данными не цитируется. Story без вердикта, story, где шаг уже есть, и story, уже красная на
влитом head, ничего не получают. Затем на story идёт `story-check --head <merged head>`; если красно, documents PR ждёт
красным. В Silent mode `land` печатает `review step of #N is the orchestrator's (tickets outside the repository)`, и
шаг дописывает Orchestrator в Workflow folder.

**Story Epic-а и `land`.** `land` вливает PR, открывает его documents PR и вливает и его за один run, поэтому
Orchestrator спрашивает заранее: `land <state file> --epic-story` ничего не вливает и не пишет, а печатает для каждого
Epic-а `epic story of <epic> is due: #N (<epic> NN) is its last PR with code` или `is not due: tickets with code still
open: NN, NN`; exit 3 значит, что Ticket-ы не прочитались, и тогда `land` идёт без story. Ticket с кодом — любой
Ticket, кроме того, у которого первая строка `Who:` называет владельца (приёмка владельца). Когда story пора, Subagent
Orchestrator-а читает story PR, spec, вердикты и head-ы PR, пишет story и проверяет её через
`story-check --pr-head <N>=<head>…`. PR, влитый раньше, чем Epic начал писать story, берётся из своего diff-а, и
`Start` об этом говорит. Зелёный файл Orchestrator отдаёт последнему PR Epic-а с кодом полем `prs[].files` state-файла.
`land` копирует его в `<epic>/story.md` того же documents PR, где `Status: done` Ticket-а, до privacy check
`evidence-check`, который при находке держит documents PR красным. Story ждёт, пока не влит другой PR Epic-а из
state-файла. Другой `story.md`, который уже лежит там, или symbolic link на этом пути никогда не перезаписываются:
documents PR ждёт красным.

### How it works

- **Автор пишет story, пока решения у него в контексте.** Implementer пишет её последним шагом перед PR. Инструкция
  просит решения и доказательства, потому что на просьбу записать ход мыслей модели API отвечает отказом
  (`reasoning_extraction`).
- **Пять правил держат story честной.** Решения и доказательства вместо рассуждений; `story-check` сверяет фрагменты с
  кодом; verifier проверяет высказывания; шаг review дописывается из вердикта; правки по review идут в ту же ветку, а
  story обновляется и проверяется заново.
- **Закоммиченная story не называет commit.** Она коммитится в тот PR, который описывает, поэтому свой commit знать не
  может; правки по review его меняют, а squash merge оставляет head PR вне main branch. Её фрагменты сверяются с head
  PR. В main branch commit — тот, что добавил story:
  `git log --first-parent --follow --diff-filter=A --format=%H -1 <main> -- <story path>`.
- **Guard — в `land`, а не в gate.** Gate идёт на каждом head ветки, в том числе до того, как implementer написал
  story; `land` — единственное место, где вливается PR Ticket-а: он знает Epic, Ticket и head PR и читает выключатель
  сам, поэтому Orchestrator не может о нём забыть (Ticket 05 Epic-а).
- **Выключатель — поле Profile.** Harness читает только Profile; собственные настройки Project-а в worfy до него не
  доходят.
- **worfy story только читает.** Файлы принадлежат workflow, и worfy не пишет ни один из них
  ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md)); то, что он собирает сам, остаётся в его папке
  данных ([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)).

### Implementation

| Что | Где |
|---|---|
| Формат, anchor, Ticket с кодом | `harness/bin/TICKETS.md`, разделы «Code story», «Story anchor» и «Ticket with code» |
| Общие fixture-файлы формата | `harness/bin/tests/fixtures/code-story/` |
| Проверка | `harness/bin/story-check`, с правилами `harness/lib/privacy.cjs` |
| Шаг implementer-а | `harness/skills/ship-ticket/story-pr.md`; его называют `harness/agents/implementer.md`, `harness/skills/ship-ticket/implementer-finish.md`, `harness/skills/ship-ticket/implementer-silent-mode.md` |
| Раздел `## Code story` в описании PR | `harness/skills/ship-ticket/step-8-pr-and-ci.md` |
| Поле `code_stories.pr` | `harness/bin/profile`, `harness/profiles/draft.schema.json` |
| Тумблер в Project settings | `src/renderer/shell/ProjectSettings.tsx`, `src/main/ipc/code-stories-setting.ts`, `src/shared/ipc/code-stories-setting.ts` |
| Guard, шаг review, `--epic-story`, `prs[].files` | `harness/bin/land` |
| Пункт verifier-а | `harness/agents/reviewer.md` |
| Агент story Epic-а и шаг review в Silent mode | `harness/skills/epic-wave/SKILL.md` |
| Eval story implementer-а | `harness/evals/implementer-story/` |

**Поток данных.** Implementer пишет story, прогоняет `story-check` и коммитит её в свой PR; шаг 8 ставит на неё ссылку
в описании PR. Verifier проверяет её вместе с кодом. `land` проверяет её ещё раз перед merge, дописывает шаг review в
documents PR и для последнего PR Epic-а с кодом кладёт туда же story Epic-а. worfy читает файлы из main branch, а в
Silent mode — из Workflow folder.

**Главные test-ы.**

- `harness/bin/tests/story-check.test.sh`: все проверки формата, несовпавший фрагмент, anchor-ы, `--pr-head`, отказы на
  main branch и для незакоммиченного цитируемого файла, маскировка личных данных.
- `harness/bin/tests/land-story.test.sh`: guard (on, off, нет story, красная, Silent, нет Profile, нечитаемый) и шаг
  review.
- `harness/bin/tests/land-epic-story.test.sh`: `--epic-story`, `prs[].files` байт в байт, privacy check, чужая story не
  перезаписывается, Silent mode.
- `harness/bin/tests/profile.test.sh`, `harness/bin/tests/profile-set.test.sh`,
  `test/contract/code-stories-setting.test.ts`, `test/unit/project-settings-shell.test.tsx`: поле, его значение по
  умолчанию, тумблер и его UI, в том числе только на чтение.
- `harness/evals/implementer-story/` — запуск руками, не в CI: implementer на учебном Ticket-е пишет story, которая
  проходит `story-check`, не придумывает причин и не получает отказа API; `test/contract/harness-evals-story.test.ts`
  держит его форму.

## Story view

### Behaviour

**Где открывается.** Вид Story занимает всю основную область окна, как Run history
([Flight Recorder](flight-recorder.md)). Esc возвращает на Canvas, как и выбор другого Project-а в sidebar. Когда story
не открыта, он говорит «No Code story is open. A story opens from an Epic, a Ticket or a pull request.»

**Входы.**

| Где | Что делает |
|---|---|
| **Code story** на рамке Epic-а, рядом с кнопкой его архивных Session-ов | Открывает `story.md` Epic-а; без него собирает по кнопке story Epic-а на сейчас |
| **Code story** в **⋯** рамки Epic-а | Открывает `story.md`; есть, только пока он у Epic-а есть |
| **Code story** на карточке Ticket-а, справа от **Open PR** | Открывает story PR Ticket-а; без неё и при строке `PR:` собирает её по кнопке. Неактивна, с причиной, у done Ticket-а без PR; нет кнопки у Ticket-а, который не done и у которого нет ни PR, ни story |
| **Code story** у pull request в [Pull requests](pr-inbox.md) | Открывает story Ticket-а этого PR, когда она есть в Tickets root; иначе собирает story PR по кнопке или открывает сохранённую раньше. **Rebuild story**, когда story сохранена, собирает её заново |
| **Open code story** в Command palette (группа View) | По строке на каждый Epic со `story.md` и на каждый Ticket со story PR |
| Toast «The Code story of Epic <epic> is ready» с **Open** | Открывает story Epic-а |

Toast появляется, когда worfy впервые видит `story.md` Epic-а, один раз на Epic, и остаётся, пока его не закроют. Epic-и,
для которых он уже был, хранятся в local storage окна, поэтому после перезапуска он не повторяется. Когда worfy впервые
читает Project, он только запоминает story, которые уже есть. Story PR toast-а не даёт. Если story не читается,
**Open** показывает причину в toast-е ошибки.

**Экраны.** Story показывает один шаг на экран.

- Полоска сегментов сверху — по сегменту на экран: текущий, прочитанный или непрочитанный; клик по сегменту переходит
  на этот экран.
- Клик по правой половине экрана листает вперёд, по левой — назад. Клик по ссылке, кнопке, вкладке полей, блоку кода,
  схеме шага Seams или «Check yourself» экран не листает, как и клик, которым заканчивается выделение текста.
- Листают и стрелки клавиатуры, и кнопки по краям **Previous screen** и **Next screen**. Подсказка — «← → · Esc Canvas».
- При ширине от 760 px код слева, текст справа; уже — одна колонка, сначала текст.

**Code-шаг** показывает блок кода и поля на языке story: What it does под заголовком, остальные четыре — вкладками. Блок
кода нумерует строки и отмечает главные жирным номером и полосой у края, так что отметка — не только цвет. Подсветки
синтаксиса нет. Код берётся из git, когда шаг показывается:

- **Где читается код.** У закоммиченной story в Full mode — commit, который добавил story в main branch (`HEAD` папки
  Tickets, когда main branch origin-а не находится). В Silent mode — merge commit PR story или его head до merge; story,
  в шапке которой ещё `PR -`, берёт PR из строки `PR:` Ticket-а. У story по кнопке — head её PR или head каждой главы.
- Фрагмент ищется по своему коду в этом commit-е, ближайший к номерам строк story, и показывается с номерами строк этого
  commit-а.
- Когда commit больше не содержит фрагмент в таком виде, вид показывает код самой story: «The code of the PR head: the
  main branch no longer holds it in this form.» Когда git не может прочитать этот commit: «The code as the story quotes
  it: git cannot read the code at this story's commit.» Когда чтение сломалось: «The code could not be read (<error>):
  shown as the story quotes it.»

**Story Epic-а** над экранами показывает ряд глав: Start, по главе на PR (`#<N>` или `PR -` у неготовой), Seams between
tickets, Summary, Check и Check yourself, если в story есть вопросы. Неготовая глава — один экран «Not ready» с
`Ready: no` и причиной.

**Seams between tickets** показывает маленькую схему: по прямоугольнику на каждый Ticket, который называют передачи, и по
стрелке на передачу; прямые стрелки идут над прямоугольниками, обратные — под ними. Передача, которую никто не сделал, —
красная пунктирная стрелка. У схемы нет панорамы и масштаба. Под ней — список передач, каждая кончается на «done» или
«dropped — <why>».

**Story по кнопке.** Где файла story нет, **Code story** её собирает.

- **Из чего собирается.** Для PR — его diff и текст, прочитанные через `gh`; файл его Ticket-а, когда строка `PR:`
  Ticket-а называет этот PR; вердикты review собственного GitHub-аккаунта Project-а (логина Pull requests, если Project
  аккаунта не называет), последние 20. Для Epic-а до его конца — его spec и по каждому Ticket-у по порядку story его
  влитого PR с head этого PR; Ticket без PR или без story — неготовая глава, а `Start` заканчивается списком таких
  Ticket-ов. Пустой diff отвергается: `PR #N changes nothing: its diff is empty.`
- **Progress bar.** На Canvas — панель под кнопкой, поверх рамки и карточек; в Pull requests он встаёт на место кнопки.
  Он показывает «Building story…», последние три строки того, что читает агент («Starting…» до первой), и **Stop**.
  Сборка кончается как «Stopped» («No story was written.»), «Not available» с причиной Vendor-а или «Failed» с причиной;
  **Close** убирает полоску. На Canvas Esc останавливает идущую сборку; уход с экрана останавливает её везде. Когда
  сборка готова, вид Story открывается на этой story.
- **Хранится.** Story хранится в `stories.json` папки данных Project-а под ключом `owner/name#N` для PR и
  `epic:<name>` для Epic-а. Повторное нажатие **Code story** открывает её без запроса. Остановленная или упавшая сборка
  ничего не хранит.
- **PR коллеги.** Агент читает текст коллеги в своём запросе, а worfy ничего из него не хранит: ни текста PR, ни его
  комментариев, ни заголовка — он становится `PR #<N>`. PR считается своим, когда его автор — логин
  [Pull requests](pr-inbox.md) или, если этот логин неизвестен, аккаунт Project-а; неизвестный автор считается
  коллегой.
- **На Project-е с Codex** сборка не начинается: полоска показывает причину «One-off requests (the Project profile draft,
  Terminal AI, a Code story) run on Claude Code only.» ([Vendors](vendors.md)).

**Вопрос к строкам.** Строки, выделенные мышью в блоке кода, или весь фрагмент через **Ask a question** открывают после
себя поле: «Question about line N» или «Question about lines A–B», с **Cancel** и **Ask** (⌘↩ или Ctrl+↩). Esc
закрывает поле, вид остаётся.

- Пока агент отвечает, на месте поля стоит progress bar с «Answering…», последними строками агента и **Stop**.
- Ответ появляется после последней строки, о которой спросили: вопрос, на что опирается ответ — **Code**, **Story**,
  **PR text**, **Review verdict** или «no support» словами story, — текст агента и строки, которые он цитирует, в виде
  `path:line`, с commit-ом в tooltip.
- Агент получает story, diff PR, его текст и вердикты, файл Ticket-а, выделенные строки и вопрос — не длиннее 2 000
  символов. То, что не прочиталось, не передаётся, и вопрос идёт без него.
- Ответы хранятся в `stories.json` вместе со story и появляются снова, когда её открывают. Ответ на более ранний текст
  story помечен «Asked about an earlier text of the story». Остановленный или упавший вопрос ничего не хранит. На
  Project-е с Codex вопрос тоже не начинается.

**Check yourself.** Story с вопросами заканчивается экраном «Check yourself» с пометкой «Optional»: «Nothing depends on
the answers.» У каждого вопроса — поле для ответа своими словами, **I don't know** и **Check** (⌘↩ или Ctrl+↩).
Правильный ответ скрыт, пока не дан один из них, потом показывается со строками, на которые опирается; строка, которую
показывает шаг story, открывает этот шаг. У story без вопросов такого экрана нет.

**Отметки «прочитано».** Каждый показанный экран отмечается прочитанным в полоске сегментов. С Project-ом отметки и
ответы «Check yourself» хранятся в `stories.json` данных worfy, никогда в репозитории, поэтому после перезапуска story
открывается с отмеченными прочитанными экранами. Отметка шага называет его Ticket и номер в главе этого Ticket-а, поэтому
глава story Epic-а, которая станет готовой позже, отметок не сдвигает. От отметок ничего не зависит.

#### On a Linked machine

Окно, которое показывает Project Linked machine ([Link](link.md)), отправляет каждый вызов вида Story на ту Machine:
story, `stories.json`, `gh`, Vendor и checkout — её. Открыть и прочитать story, её код, ответы и отметки — чтение, оно
открыто при доступе только на чтение. Собрать story, спросить о строках, сохранить отметку «прочитано» или ответ «Check
yourself» и Stop — запись: при доступе только на чтение link их отвергает. Кнопки сборки тогда неактивны с причиной, как
и тумблер **Code stories for PRs**, который всё равно показывает значение.

### How it works

- **Невидимый агент — `oneShot` Vendor-а Project-а**, а не Session ([ADR-0094](../../adr/0094-vendor-seam.md)). Он идёт
  в собственной папке worfy вне всех Project-ов, `<WORFY_DATA_DIR>/terminal-ai`: запрос, рабочая папка которого внутри
  Project-а, стал бы Session этого Project-а и Session Node на Canvas. Он не оставляет transcript-а, читает checkout PR
  как дополнительную папку только через Read, Glob и Grep (driver Claude отвергает чтение вне неё и вне своей папки), не
  может запускать git, поэтому diff приходит в тексте запроса, и идёт без plugin-а Harness-а. Ответ — по JSON Schema;
  каждая строка того, что он делает, питает progress bar.
- **Материал — не инструкции.** Diff, текст PR и вердикты пишет автор PR; запрос называет их тем, что нужно объяснить, и
  не читает ничего вне checkout-а и своей папки.
- **Слова коллеги не хранятся.** Для PR коллеги `stories.json` держит story агента с фрагментами кода, но не текст PR,
  его комментарии и заголовок — так же, как PR inbox не хранит на диске текстов коллег
  ([ADR-0105](../../adr/0105-pr-reply-only-on-the-users-click.md)).
- **Один файл на Project.** `stories.json` держит story по кнопке, ответы, отметки «прочитано» и ответы «Check
  yourself». Каждая запись читается отдельно, поэтому запись, которую эта сборка worfy прочитать не может, хранится, но
  не показывается; каждая запись в файл атомарна. Ответы и отметки хранятся под тем, что называет story, — её файлом
  или её PR или Epic-ом, — поэтому правка story или новая сборка их сохраняет.

### Implementation

| Что | Где |
|---|---|
| Чтение story вместе с Epic-ом | `src/main/workflow/watch.ts`, `src/main/workflow/reader.ts`, `src/shared/workflow/types.ts` |
| Разбор формата, подписи обоих языков, ответ агента | `src/shared/stories/parse.ts`, `src/shared/stories/labels.json`, `src/shared/stories/schema.ts` |
| Код фрагмента из git | `src/main/stories/code.ts` |
| `stories.json` | `src/main/stories/store.ts` |
| Невидимый агент | `src/main/stories/one-shot.ts`, поверх `src/main/vendors/one-shot.ts` и `src/main/vendors/claude/one-shot.ts` driver-а Claude; причина отказа Codex — в `src/main/vendors/codex/capabilities.ts` |
| Story по кнопке | `src/main/stories/by-button.ts`, `src/main/stories/not-ready.json` |
| Вопрос к строкам | `src/main/stories/ask.ts`, `src/renderer/stories/LineQuestion.tsx`, `src/renderer/stories/story-answers.ts` |
| Каналы | `src/shared/ipc/stories.ts`, `src/main/ipc/stories.ts` |
| Вид, его экраны и схема Seams | `src/renderer/shell/AppShell.tsx` (монтирует вид), `src/renderer/stories/StoryView.tsx`, `src/renderer/stories/JunctionsDiagram.tsx`, `src/renderer/stories/stories.css`, `src/renderer/stories/open.ts` |
| Блок кода | `src/renderer/markdown/Markdown.tsx`, `src/renderer/markdown/markdown.css` |
| Входы и toast | `src/renderer/canvas/actions/EpicStory.tsx`, `src/renderer/canvas/actions/TicketStory.tsx`, `src/renderer/canvas/actions/AutopilotAction.tsx`, `src/renderer/pr-inbox/PrInboxView.tsx`, `src/renderer/palette/commands.ts`, `src/renderer/stories/story-toast.ts`, `src/renderer/stories/use-story-toasts.ts` |
| Кнопка сборки и её progress bar | `src/renderer/stories/StoryBuildButton.tsx`, `src/renderer/stories/StoryProgress.tsx`, `src/renderer/stories/story-build.ts` |
| Check yourself и отметки «прочитано» | `src/renderer/stories/SelfCheck.tsx`, `src/renderer/stories/story-marks.ts` |

**Поток данных.** Watcher пропускает `story.md` и `stories/*.md` Epic-а, а reader перечисляет их вместе с Epic-ом: где
лежит каждый и hash его текста. Вход открывает файл через `stories.read`, который его разбирает; вид просит у
`stories.code` код каждого шага, который показывает. **Code story** без файла вызывает `stories.make`: main читает
материал, запускает `oneShot`, сохраняет ответ и возвращает его, и вид его открывает. Вопрос идёт через `stories.ask`,
отметка «прочитано» — через `stories.markRead`, ответ «Check yourself» — через `stories.selfCheck`, и всё хранится в
`stories.json`.

**Главные test-ы.**

- `test/unit/story-parse.test.ts` и `test/contract/workflow-reader.test.ts`, на общих fixture-файлах Harness-а: разбор,
  оба языка, причины, по которым файл не подходит; story в списке Epic-а.
- `test/unit/tickets-watch.test.ts`: какие файлы story пропускает watcher.
- `test/contract/story-code.test.ts`: код фрагмента в настоящих git-репозиториях, Full и Silent mode, изменившийся
  фрагмент и отсутствие anchor-а.
- `test/contract/story-one-shot.test.ts`: невидимая сборка — нет Session Node, её папка, нет transcript-а, tools только на
  чтение, Codex недоступен.
- `test/contract/story-by-button.test.ts`, `test/contract/stories-handler.test.ts`, `test/contract/story-store.test.ts`:
  материал PR и Epic-а, PR коллеги, сохранённая story и пересборка, Stop, папки, которые сборке можно читать,
  `stories.json`.
- `test/contract/story-ask.test.ts`, `test/unit/story-ask.test.ts`, `test/unit/line-question.test.tsx`: вопрос к
  строкам.
- `test/unit/story-view.test.tsx`, `test/unit/story-entries.test.tsx`, `test/unit/story-toast.test.ts`,
  `test/unit/story-progress.test.tsx`, `test/unit/story-self-check.test.tsx`, `test/unit/markdown.test.tsx`,
  `test/unit/palette-commands.test.tsx`: вид, входы, toast, progress bar, Check yourself и отметки «прочитано», блок
  кода, строки Command palette.
- `test/unit/link-access.test.ts`: какие каналы Linked machine достаёт при доступе только на чтение.
- `test/e2e/code-story.spec.ts` с fake агентом и `test/e2e/a11y.spec.ts`: вид на fixture-Epic-е, все входы, вопрос к
  строке и отметки после перезапуска, story по кнопке без нового Session Node.

## What is not there

- **Story изменений без PR.** worfy собирает story только для PR или Epic-а: изменения, которые ещё не в PR, её не
  получают.
- **«Ask the author».** Кнопки, которая продолжает implementer-а, чтобы он ответил на вопрос, нет. Замер задал пять
  вопросов к строкам story PR: новый запрос набрал 19 из 20, продолженный implementer — 19 из 20, автор оказался не
  лучше ([замер](../../../.scratch/worfy-code-stories/measure-ask-author.md)). Вопрос идёт новому запросу.
- **Отметки «прочитано» как условие.** Никакая приёмка их не требует.
- **Story в приложении на телефоне.** В Full mode story Epic-а читается на GitHub.
- **Публикация story PR коллеги.** Она остаётся в `stories.json`; на GitHub из неё ничего не уходит.
- **Подсветка синтаксиса и редактор кода.**
- **Story по кнопке и вопрос на Project-е с Codex.**
