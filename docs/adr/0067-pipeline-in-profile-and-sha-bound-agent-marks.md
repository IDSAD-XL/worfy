# 0067 — Pipeline в Profile из каталога Stage и отметки агентов, привязанные к SHA
Дата: 2026-10-17. Статус: принят.

**Контекст.** worfy показывает Ticket статусом из его файла: `open`, `claimed`, `blocked`, `done`
(CONTEXT.md, термин Ticket). Статус не говорит, где работа: один и тот же `claimed` — это и
implementer до PR, и красный CI, и ревью агентом, и ожидание gate full на Windows-ПК, и ожидание
мержа. Владелец хочет одним взглядом видеть, на каком Stage каждый Ticket и кого он ждёт
(решение владельца 2026-10-17, grilling о Pipeline; Epic `worfy-pipeline`).

Порядок шагов у Project-ов разный. У worfy — CI, ревью агентом, вердикт Windows (ADR-0056, пункт 2),
gate и мерж агентом, выкатка в Stable copy. У Project-а Atakama в Silent mode ревью агентом идёт до
PR, потому что открытый PR передаёт работу людям, а мержат люди. Значит, список Stage — свой у
каждого Project-а (CONTEXT.md, термин Pipeline).

Вердикт ревью агентом сегодня — текст. В Full mode это комментарий в PR, первая строка которого
начинается с `VERIFIED` или `REJECTED` (skill `epic-wave`, раздел 3); worfy находит его регулярным
выражением (`src/main/github/prs.ts`, `verdictOf`). С `local-green` вердикт — пустой commit
`gate: VERIFIED` в ветке, в Silent mode — строка в конце файла Ticket-а. Вердикт Windows — строка
отчёта Session на ПК. Ни один из этих вердиктов не привязан к коммиту: после нового push старый
`VERIFIED` выглядит действующим.

Stage вычисляется и нигде не хранится (CONTEXT.md, термин Stage): worfy только читает workflow
(ADR-0002), а своё держит в папке данных приложения (ADR-0005).

**Решение.**

1. **Pipeline — поле Profile-а `workflow.pipeline`, собранное из фиксированного каталога видов
   Stage.** У каждого вида — предикат в коде: worfy и Harness проверяют одно и то же. Profile
   включает виды, задаёт их порядок, переименовывает (`label`) и задаёт порог «застрял»
   (`stuck_after`). Своих выражений, скриптов и условий Profile не задаёт. Каталог:
   - **Queued** — Status `open`;
   - **Implementing** — `claimed`, PR нет; пометка «rework», если на текущем SHA есть отметка
     с вердиктом `failure`;
   - **CI** — check-и PR идут или красные;
   - **Agent review** — отметка агента `review`;
   - **Human review** — `reviewDecision` PR на GitHub, его ставят люди;
   - **Check «<name>»** — отметка агента с именем из Profile-а (у worfy — `windows`: правило
     ADR-0056, пункт 2, становится этим Stage);
   - **Gate & merge** — мержит агент;
   - **Awaiting merge** — всё зелёное, мержит человек;
   - **Deploy** — отметка на merge-коммите: GitHub Deployment окружения из Profile-а или commit
     status `deploy`, его ставит скрипт деплоя (у worfy — `pnpm install:stable`);
   - **Closing** — PR влит, Status не `done`;
   - **Done**.

   Без поля Pipeline — Queued, Implementing, CI, Agent review, Gate & merge, Closing, Done.
   `blocked` — не Stage, а пометка на любом Stage с причиной. Сначала Pipeline правится в
   `profile.json` руками или через `bin/profile`; редактор в Settings — позже.
2. **Отметки агентов (`review`, Check) — один интерфейс, два хранилища по режиму Project-а.**
   Пишет их только `bin/ticket mark <epic> <NN> <kind> <verdict> --sha <sha>`.
   - Full mode — GitHub **commit status** на head-коммите PR: context — нейтральное имя вида
     (`review`, `check/windows`), state — `success`, `failure` или `pending`.
   - Silent mode — локальный JSON в `~/.claude/worfy-harness/runs/<project>/marks/`, один файл на
     Ticket. Он не коммитится и на GitHub не попадает: в репозитории Project-а не остаётся следа
     workflow.

   Обе отметки привязаны к SHA. Новый коммит делает отметку устаревшей, и Ticket возвращается на
   ранний Stage. worfy больше не разбирает текст комментариев PR ради вердикта; комментарии
   остаются для людей. Метки PR (labels) для Stage не используются.
3. **Известный предел Silent mode.** Отметки лежат на одной Machine. Linked machine (ADR-0052) их
   не видит, пока Epic `worfy-link` не начнёт их читать.

Этот ADR не меняет ADR-0056: какие PR платформенные, решает его пункт 2. Меняется только то, как
Harness ждёт вердикта Windows: отметкой `check/windows` на SHA, а не текстом в skill-е и правилах.
Правку `rules.md` и `profile.json` Profile-а worfy делает Orchestrator после мержа Ticket-ов Epic-а.

**Последствия.**

- Ревью, вердикт Windows и выкатка привязаны к коммиту. Push после `VERIFIED` возвращает Ticket на
  CI и ревью — и на доске, и в Harness.
- В Full mode отметки видят все, кто смотрит PR: строка `review` или `check/windows` в списке
  check-ов. Имена нейтральные, без worfy и Ticket-ов. `gh pr checks` их тоже показывает, поэтому
  проверка CI в Harness и в worfy исключает имена отметок.
- Silent mode оставляет на GitHub только то, что делают люди и CI. Цена — отметки видны на одной
  Machine (пункт 3).
- Новый вид Stage — это правка кода worfy и Harness, а не Profile-а. Это намеренно: предикат
  проверен test-ом и одинаков в обоих местах.
- Переход однократный: пока Harness не пишет отметки, Ticket-ы старых PR показывают Agent review без
  вердикта. Старые `VERIFIED` в отметки не переносятся.

## Considered Options

- **Разбор текста комментариев PR (как сейчас).** Ничего не надо писать заново. Но вердикт не
  привязан к коммиту, в Silent mode комментария нет вовсе (там вердикт — строка в файле Ticket-а
  или пустой commit), а формат первой строки — договорённость, которую ломает любая правка skill-а.
  Отвергнуто.
- **Метки PR (labels).** Видны в списке PR и дёшевы в чтении. Но метка не привязана к SHA и
  переживает push, её снимают руками, а в Silent mode она — след workflow на GitHub. Отвергнуто.
- **Только журнал Autopilot.** Журнал уже пишет каждый шаг прогона. Но работа вне Autopilot —
  Session Orchestrator-а, Session на Windows-ПК, человек — в журнал не попадает, и Stage врал бы
  ровно тогда, когда нужнее всего. Отвергнуто.
- **Поле Stage в файле Ticket-а.** Просто читать. Но это второе хранимое состояние рядом с фактами,
  из которых Stage следует (PR, CI, отметки), и оно отстаёт от них при каждом забытом обновлении —
  то, что ADR-0002 запрещает. Отвергнуто.
- **Pipeline свободными выражениями или скриптами в Profile.** Гибко. Но предикат без test-а в коде
  worfy и Harness понимали бы по-разному, а скрипт из Profile — исполнение чужого кода при каждом
  чтении доски. Отвергнуто в пользу каталога.
- **Каталог Stage в Profile, отметки — commit status в Full mode и локальный JSON в Silent mode
  (выбрано).** Предикаты проверены test-ами, отметки привязаны к SHA, Silent mode не оставляет
  следа.
