# 80 — Один ticket на несколько репозиториев

Type: task
Status: done 2026-11-09T18:48Z
Blocked by: —
Source: просьба владельца 2026-11-09: правка, которая затрагивает два репозитория одного Project-а, сейчас — два
ticket-а. Строки перечитаны по main `964061f9a`.

> Самый большой из ticket-ов 76–80. Перед реализацией — короткий spec (или разбиение на ticket-ы: Harness, main,
> renderer, skill-ы) и **новый ADR, который заменяет ADR-0045 в пункте 1**: этот вариант ADR-0045 прямо отверг.
> Решение — за владельцем.

Spec — новый Epic [worfy-multi-repo-ticket](../../worfy-multi-repo-ticket/spec.md) (принят владельцем 2026-11-09) и
[ADR-0104](../../../docs/adr/0104-one-ticket-several-repositories.md) (принят 2026-11-09).

## Что происходит

Правило записано в ADR-0045 (`docs/adr/0045-one-ticket-one-repository.md:28–30`): «Один Ticket — один репозиторий…
У Ticket-а одна ветка, одно worktree и не больше одного PR». Функция через несколько репозиториев — цепочка ticket-ов
со связью `Blocked by` (:53–54). Вариант «Один Ticket — несколько PR» отвергнут владельцем (:70–72): на одну строку
`Status:` приходилось бы несколько веток, вердиктов Gate и CI; `ticket done --pr N` принимает один PR; ticket
закрывался бы только после merge-ей в разных репозиториях.

Два PR неизбежны: у GitHub нет PR через несколько репозиториев. Два ticket-а — выбор worfy. Просьба владельца — снять
его: ticket с несколькими строками `Repo:`, по одной ветке и одному PR в каждом репозитории; ticket `done`, когда
влиты все его PR.

## Что делаем

Решения, которые должен закрыть spec:

1. Форма заголовка: несколько строк `Repo:` и к каждой своя `Branch:` и `PR:` (пары строк по порядку, или одна строка
   `Repo: <name> · Branch: <b> · PR: #N`).
2. Имя ветки в каждом репозитории: один `<epic>/<NN>` везде (проще: `branchOfTicket` не меняется, ключ — пара
   (repo, branch)).
3. Что такое `done`: все PR влиты; частично влитый ticket — новое промежуточное состояние или `claimed` с пометкой.
4. Вердикт Gate и CI ticket-а — сумма по PR: красный любой — красный ticket.
5. Порядок merge-а: независимые PR или «сначала библиотека, потом потребитель» (порядок строк `Repo:`).

Места, которые считают один репозиторий на ticket:

- **CLI ticket-а.** `harness/bin/ticket:577` — `Branch:` и `Repo:` по одной строке, существующая заменяется на месте;
  :13 — `--repo` пишет одну `Repo: R`; :541 — `PR` одно значение `#N`; :10 — `ticket done --pr N` один номер;
  :976 — `markRepo`: первый `Repo:` → один каталог для отметки статуса. Документ — `harness/bin/TICKETS.md`.
- **epic-status.** `harness/bin/epic-status:224` — «the LAST Blocked by / Branch / Repo line wins»; :283 — берёт
  первый `PR:`; :337 — Branch и Repo одним словом.
- **Модель ticket-а в worfy.** `src/shared/workflow/types.ts:47` — `pr` одно число; :56 — `branch` одна строка; :58 —
  `repo` одна строка.
- **Worktree и ветки.** Worktree создаёт агент по тексту skill-а (`harness/skills/ship-ticket/SKILL.md`, раздел 2).
  `src/main/workflow/reader.ts:422` — worktree Project-а, чья ветка называет ticket; `src/shared/workflow/ticket-ref.ts:32`
  — `parseTicketBranch`: ветка → один ticket; `src/main/workflow/stages.ts:82` — `branchOfTicket` одна ветка.
- **Стадии Pipeline в main.** `src/main/workflow/stages.ts:152` — `repoOf(ticket)` один репозиторий из `ticket.repo`;
  :180 — `prs.read(repo, branches)` по репозиторию; :205–206 — `pullOf(...)` один PR ticket-а. Главное место правки:
  факты ticket-а — по каждой паре (repo, PR).
- **Pipeline board.** `src/shared/workflow/pipeline.ts:149–152` — у фактов один `headSha` и один `pr` («The Ticket's
  PR»); стадия считается по нему (`src/renderer/pipeline/PipelineBoard.tsx` показывает то, что дал main).
- **land.** `harness/bin/land:82` — состояние уже список PR с `epic`/`ticket`, но `:198` — один `repo`, checkout, в
  котором работают `gh` и `git`: один запуск land — один репозиторий. `:609–614` (`docsEntry`) — PR документов берёт
  каждый влитый PR с ticket-ом; проверки «влиты все PR ticket-а» перед `ticket done` нет.
- **wave-brief.** `harness/bin/wave-brief:208–209` — `byBranch` и `byPr`: ветка → ticket, PR → ticket, по одному.
- **evidence-check.** `harness/bin/evidence-check` проверяет, что ветка добавляет в папку ticket-ов (privacy), с PR и
  репозиторием ticket-а не связан — правки не ждём. Evidence пишется на head SHA одного PR (`land` зовёт
  `ticket evidence` по PR) — у ticket-а с двумя PR их будет два.
- **Текст skill-ов.** `harness/skills/epic-wave/SKILL.md:106–107` — «each ticket works in the repository of its `Repo:`
  line (one ticket — one repository…)»; `harness/skills/ship-ticket/implementer-silent-mode.md:19` — «you work in the
  repository of the ticket's `Repo:` line only»; `harness/skills/ship-ticket/step-9-merge.md:37` — merge ticket-а —
  «a set of one PR … `PRS=(<N>)`».

## Готово, когда

- [x] Spec ticket-а с несколькими репозиториями принят владельцем; новый ADR заменяет пункт 1 ADR-0045.
- [x] По spec-у заведены ticket-ы реализации (или этот ticket уточнён до одного шага).

## Тесты

Нет: этот ticket даёт spec и ADR. Тесты — в ticket-ах реализации.

## Где в коде

- `docs/adr/0045-one-ticket-one-repository.md:28–30`, :53–54, :70–72 — действующее правило и отвергнутый вариант.
- `harness/bin/ticket:10`, :13, :541, :577, :976; `harness/bin/TICKETS.md`.
- `harness/bin/epic-status:224`, :283, :337.
- `harness/bin/land:82`, :198, :609–614; `harness/bin/wave-brief:208–209`; `harness/bin/evidence-check`.
- `src/shared/workflow/types.ts:47`, :56, :58; `src/shared/workflow/ticket-ref.ts:32`;
  `src/shared/workflow/pipeline.ts:149–152`.
- `src/main/workflow/stages.ts:82`, :152, :180, :205–206; `src/main/workflow/reader.ts:422`.
- `src/renderer/pipeline/PipelineBoard.tsx`.
- `harness/skills/epic-wave/SKILL.md:106–107`; `harness/skills/ship-ticket/implementer-silent-mode.md:19`;
  `harness/skills/ship-ticket/step-9-merge.md:37`; `harness/skills/ship-ticket/SKILL.md` (раздел 2).

## Вне скоупа

- PR через несколько репозиториев на стороне GitHub: его нет.
- Project в одном репозитории: у него `Repo:` нет, поведение то же.

## Итог

Стал Epic-ом `worfy-multi-repo-ticket` (spec принят 2026-11-09, ADR-0104): Ticket-ы 01–08 в
`.scratch/worfy-multi-repo-ticket/issues/`.
