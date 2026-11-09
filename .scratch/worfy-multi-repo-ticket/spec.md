# worfy-multi-repo-ticket: один Ticket на несколько репозиториев

Status: принят владельцем 2026-11-09 (ответы Q0–Q8 — в разделе «Решения владельца»)
Critic: [docs/product/critic/worfy-multi-repo-ticket-2026-11-09.md](../../docs/product/critic/worfy-multi-repo-ticket-2026-11-09.md) — Split; владелец выбрал Split (Q0), ответ — раздел «Ответ на критику»
Source: [Ticket 80 Epic-а worfy-polish](../worfy-polish/issues/80-один-ticket-на-несколько-репозиториев.md) — список мест, которые
считают один репозиторий на Ticket (строки сверены с `main` `964061f9a`; до `74d0e7f58` менялись только документы);
решение владельца 2026-11-09 («да»: заменить пункт 1 ADR-0045) и его ответы Q0–Q8 того же дня;
[ADR-0045](../../docs/adr/0045-one-ticket-one-repository.md) (один Ticket — один репозиторий; Project над несколькими
репозиториями — всегда Silent mode); [ADR-0042](../../docs/adr/0042-profile-on-machine-full-and-silent-modes.md) (Silent
mode: ветки, commit-ы и PR без следов workflow); [ADR-0104](../../docs/adr/0104-one-ticket-several-repositories.md)
(принят 2026-11-09); [TICKETS.md](../../harness/bin/TICKETS.md); [profiles/README.md](../../harness/profiles/README.md).
Ticket-ы: Epic `worfy-multi-repo-ticket`, 8 Ticket-ов, нумерация с `01`. Шапка — `Type:` / `Status:` / `Blocked by:` /
`Source:`. Ticket-ы — `issues/01`–`issues/08`.

## Цель

Правка, которая задевает два репозитория одного Project-а (общую библиотеку и её потребителя), сегодня — два Ticket-а
со связью `Blocked by`. После Epic-а это один Ticket: несколько строк `Repo:`, своя ветка и свой PR в каждом
репозитории, один verdict ревью на всю правку, один шаг «release библиотеки и подъём версии у потребителя», одна
карточка на Pipeline board, и `done`, когда влиты все PR.

Два PR неизбежны: у GitHub нет PR через несколько репозиториев. Два Ticket-а — выбор worfy, и он хуже:

1. **Ревью видит половину правки.** Ревьюер ветки библиотеки не видит, как её новый API зовёт потребитель. Ревьюер
   потребителя видит библиотеку уже влитой и выпущенной: поправить её API — третий Ticket.
2. **API подгоняют вслепую.** Первый Ticket фиксирует API до того, как кто-то написал вызывающий код.
3. **«Готово, когда» режется пополам.** Пользователь видит результат только после второго Ticket-а; доказательства
   функции целиком (`ticket evidence`) лежат во втором.
4. **Pipeline board показывает две карточки одной правки**, и владелец сам держит в голове, что они — одно.

Чего Epic не даёт: выигрыша во времени до merge-а потребителя. Потребитель видит библиотеку только через выпущенную
версию, поэтому между merge-ем библиотеки и merge-ем потребителя всегда стоят release и подъём версии (критика,
возражение 3). Выигрыш — в том, что implementer пишет обе стороны в одном контексте и ревью видит стык до merge-а.

## Для какого Project-а

Единственный сегодня Project над несколькими репозиториями — рабочий проект из нескольких репозиториев (библиотека и
её потребители). Его процесс (Profile и `rules.md` вне этого репозитория, критика, возражения 1–2):

- `parallel: single`: одна рабочая папка, worktree нет, один Ticket за раз; каждый репозиторий — свой main checkout;
- PR открываются только после `review success` агентов (Pipeline `queued → implementing → agent-review → ci → …`);
- `workflow.merge: null`: вливают люди команды, никогда не агент и не worfy;
- Silent mode: в ветках, commit-ах и PR нет следов workflow.

Epic делает один Ticket на несколько репозиториев для этого процесса. Режим `parallel: worktrees` через несколько
репозиториев и merge через `land` — позже (раздел «Не в этом Epic-е»).

## Что видит пользователь

1. Ticket правки через два репозитория пишется одним файлом: две строки `Repo:`, библиотека первой.
2. Implementer работает в main checkout-е каждого репозитория из строк `Repo:`, в одной и той же ветке.
3. Ревью агентов смотрит head-ы веток всех репозиториев вместе и даёт один verdict.
4. После `review success` открываются PR — по одному в каждом репозитории, вместе. PR друг о друге ничего не
   говорят. PR потребителя несёт подъём версии библиотеки и остаётся draft, пока release с этой версией не вышел.
5. На Pipeline board — одна карточка: список PR с репозиториями, «1/2 merged», а пока release нет — «waits for release
   <version>». Стадия карточки — по самому отстающему репозиторию.
6. Люди вливают PR библиотеки, команда делает release. worfy замечает release (tag или опубликованную версию), и PR
   потребителя выходит из draft. Люди вливают его; Ticket — `done`, когда влиты все PR.
7. Ticket с одной строкой `Repo:` или без неё работает как сегодня.

## Как работает

### Шапка Ticket-а (Ticket 01; Q1, Q2)

```
Status: claimed 2026-11-10T09:00Z
Branch: fix/lot-withdraw-flag
Repo: lib
Repo: app
PR: lib#41
PR: app#118
Release: lib tag lib-v1.4.0
```

- **`Repo:` — по строке на репозиторий**, имя из `_resolved.repos` Profile-а. Порядок строк — порядок merge-а:
  библиотека первой, потребители после неё (Q3).
- **`Branch:` — одна строка, одно имя во всех репозиториях** (Q2). Ветку называет правка
  (`harness/skills/ship-ticket/step-2-silent-branch.md`); `silent-check` проверяет её в каждом репозитории. Ключ ветки
  — пара (repo, branch); `branchOfTicket` (`src/main/workflow/stages.ts:82`) не меняется.
- **`PR:` — по строке на PR, с именем репозитория**: `PR: <repo>#N`. Номера PR в разных репозиториях совпадают,
  поэтому голый `#N` у Ticket-а с несколькими `Repo:` — ошибка формата. Ticket с одним репозиторием пишет `PR: #N`,
  как сегодня.
- **`Release:` — чего ждёт потребитель**: `Release: <repo> tag <tag>` или `Release: <repo> package <name>@<version>`.
  Строку пишет implementer, когда поднимает версию у потребителя. Строк может быть несколько (библиотека выпускает
  несколько пакетов).
- Связь PR между собой живёт только здесь, в файле Ticket-а в Workflow folder, и на Pipeline board (Q6). В описаниях
  PR о соседних PR нет ни ссылки, ни фразы.
- CLI: `ticket claim … --repo A --repo B` пишет обе строки; `ticket pr <epic> <NN> <repo>#N` дописывает строку `PR:`,
  когда PR открыт; `ticket release <epic> <NN> <repo> tag <tag>` (или `package <name>@<version>`) — строку `Release:`;
  `ticket done --pr <repo>#N` повторяется на каждый PR и отказывает (exit 2), если в наборе нет PR какого-то `Repo:`.
  `ticket evidence … --sha S` получает `--repo R`. `markRepo` (`harness/bin/ticket:976`) отмечает статус в Workflow
  folder, как сейчас.
- Пути в `## Где в коде` у такого Ticket-а начинаются с имени репозитория (`app/src/lots.ts`): иначе два `src/index.ts`
  разных репозиториев выглядят общим файлом для `filesOverlap` (`src/shared/workflow/waves.ts`).

### Работа implementer-а и ревью (Ticket 07; Q5)

- В `parallel: single` worktree нет (`harness/skills/ship-ticket/SKILL.md:155`): implementer создаёт ветку в main
  checkout-е каждого репозитория из строк `Repo:` (пути — `_resolved.repos`) и работает в них. Один Ticket за раз —
  правило Project-а, и он держится: Ticket занимает все свои checkout-ы.
- Gate fast — в каждом checkout-е: у каждого репозитория своя запись в Gate (ADR-0018).
- **Каждый PR безопасен сам по себе** (Q7). Изменение библиотеки обратно совместимо: старые потребители после её
  merge-а и release работают. Implementer делает его таким, ревьюер это проверяет.
- **Один verdict ревью на Ticket** (Q5) — на набор head-ов веток всех `Repo:`. Ревьюер получает diff-ы всех
  репозиториев и проверяет каждый и стык: совпадают ли вызовы с API, совместима ли библиотека со старыми
  потребителями. Отметка `review` ставится на head каждой ветки. Новый head любой ветки снимает verdict всего Ticket-а:
  новое ревью смотрит дельту и стык.
- После `review success` PR открываются вместе, в порядке строк `Repo:`, и записываются `ticket pr`. Описания PR — о
  своей правке; `silent-check` проверяет каждое.

### Release и подъём версии — стадия Ticket-а (Ticket-ы 04, 05; Q3)

Потребитель видит библиотеку только через выпущенную версию: зависимость — диапазон версий в `package.json`, а
публикацию запускает tag в репозитории библиотеки. Поэтому:

1. Ветка потребителя уже несёт подъём версии библиотеки (диапазон в `package.json`). Implementer пишет строку
   `Release:` — какой tag или какая опубликованная версия нужна.
2. PR потребителя открывается draft. Его CI до release может быть красным: версии ещё нет. Это ожидаемо, и Pipeline
   не считает такой CI провалом, пока строка `Release:` не выполнена.
3. Люди вливают PR библиотеки; команда делает release. worfy release не делает — только ждёт и замечает:
   - `tag` — tag есть в remote репозитория библиотеки (`git ls-remote --tags`);
   - `package` — версия опубликована (`npm view <name>@<version> version` в checkout-е потребителя, с его настройками
     registry).
4. Когда release замечен, Orchestrator выводит PR потребителя из draft (`gh pr ready`). Если lockfile потребителя
   нужно обновить под выпущенную версию, это новый head: verdict снимается, ревью смотрит только эту дельту.
5. Люди вливают PR потребителя.

На Pipeline это новая стадия `release` в каталоге стадий (`src/shared/workflow/pipeline.ts:15`,
`harness/lib/pipeline.cjs`, `harness/profiles/README.md`, строка `workflow.pipeline`): Ticket стоит на ней, пока
хоть одна строка `Release:` не выполнена; карточка показывает «waits for release <version>». Project без строк
`Release:` эту стадию проходит сразу; Project, который её не включил в `workflow.pipeline`, её не видит.

### Половина влита (Q4, Q7)

- PR библиотеки влит, потребитель ещё нет — обычное состояние, а не авария: библиотека совместима со старыми
  потребителями. Ticket остаётся в работе (`claimed`); Board показывает «1/2 merged».
- Потребитель красный или ревью его отвергло — Ticket чинят вперёд в том же Ticket-е.
- worfy никогда не предлагает revert влитого PR. Это решение владельца или команды.
- Нового статуса нет. `done` — только когда влиты все PR из строк `Repo:`.

### epic-status, wave-brief, Pipeline board (Ticket-ы 02, 03, 04, 06)

- **epic-status** (`harness/bin/epic-status:224`, :283, :337): `Repo:`, `PR:` и `Release:` — списки, порядок файла;
  `Branch:` — одна строка. Строка Ticket-а: `PR lib#41 ✓, app#118 · waits for release lib-v1.4.0`. Ticket считается
  один раз.
- **wave-brief** (`harness/bin/wave-brief:208–209`): `byBranch` — по паре (repo, branch), `byPr` — по паре (repo, N).
- **Модель в worfy** (`src/shared/workflow/types.ts:47`, :56, :58): `repos: string[]`, `prs: {repo, number}[]`,
  `releases: {repo, kind, ref}[]`; старые `repo` и `pr` остаются для Ticket-а с одним репозиторием.
- **Стадии в main** (`src/main/workflow/stages.ts:152`, :180, :205–206; `src/shared/workflow/pipeline.ts:149–152`):
  факты — по каждому репозиторию. До PR стадия берётся по head-ам веток всех `Repo:` (критика, возражение 2), после —
  по паре (repo, PR). Стадия Ticket-а — самая ранняя из стадий его репозиториев; `merged` — число влитых PR.
  `src/main/workflow/reader.ts:422` ищет ветку Ticket-а по паре (repo, branch) в каждом checkout-е.
- **Pipeline board и Ticket Node** (`src/renderer/pipeline/PipelineBoard.tsx`; места, которых нет в списке Ticket-а 80:
  `src/renderer/canvas/nodes/TicketNode.tsx`, `src/renderer/canvas/badges/use-checks.ts`,
  `src/shared/ipc/checks.ts:121–149`): одна карточка, PR по одному на строку с именем репозитория, «1/2 merged»,
  «waits for release <version>»; chip Ticket Node называет все репозитории; badge-и проверок запрашивают PR ветки в
  каждом репозитории. Ticket с одним PR выглядит как сегодня.

## Что остаётся как есть

- Один путь — один Project. Project над несколькими репозиториями — папка над ними, всегда Silent mode (ADR-0045,
  пункты 2–4 в силе).
- Ticket с одной строкой `Repo:` или без неё (Project из одного репозитория, в том числе сам worfy) — как сегодня.
- Связь `Blocked by` между Ticket-ами остаётся допустимой.
- `bin/evidence-check` не меняется: он проверяет папку Ticket-ов в ветке (privacy) и с PR не связан.
- Merge — как в Project-е сегодня: в рабочем проекте вливают люди.

## Решено без владельца

- `Release:` знает два вида: `tag` и `package`. Другие (release на GitHub без tag-а, своя registry без `npm`) —
  отдельным Ticket-ом, когда встретятся.
- CI потребителя, красный до release, не красит Ticket, пока строка `Release:` не выполнена; после release красный CI
  — обычный красный.
- PR потребителя из draft выводит Orchestrator после release; если команда хочет делать это сама, `rules.md` Project-а
  так и пишет, и Orchestrator только сообщает.
- Пути в `## Где в коде` Ticket-а с несколькими `Repo:` начинаются с имени репозитория.
- Новых терминов в `CONTEXT.md` нет, кроме стадии `release` (Ticket 05 добавляет её в описание Pipeline).

## Ticket-ы

| Ticket | Что | Глубина ревью | Платформенный | Blocked by |
| --- | --- | --- | --- | --- |
| 01 | `ticket`: несколько `--repo`, `PR: <repo>#N`, `ticket pr`, `ticket release`, `done` только с полным набором, `evidence --repo`; TICKETS.md | `high` | да | — |
| 02 | `epic-status` и `wave-brief`: списки `Repo:`, `PR:`, `Release:`; ключи (repo, branch) и (repo, N) | `medium` | да | — |
| 03 | Модель Ticket-а в worfy: `repos`, `prs`, `releases`; ветка по паре (repo, branch) | `medium` | нет | — |
| 04 | Стадии в main: факты по каждому репозиторию, стадия до PR по head-ам веток, `merged` | `high` | нет | 03 |
| 05 | Стадия `release`: каталог стадий, проверка tag-а и опубликованной версии | `high` | да | 04 |
| 06 | Pipeline board и Ticket Node: одна карточка, N PR, «1/2 merged», «waits for release», chip всех репозиториев | `medium` | нет | 05 |
| 07 | Тексты skill-ов для `parallel: single` через несколько checkout-ов: ветка в каждом, одно ревью, PR вместе после ревью, draft потребителя до release, merge — люди | `medium` | нет | 01 |
| 08 | Приёмка: fixture-проект из двух репозиториев со stub `gh` и `npm`; один настоящий Ticket в рабочем проекте ведёт владелец | `low` | нет | 02, 06, 07 |

Платформенный Ticket — скрипт Harness, hook или путь ОС: PR ждёт Windows verdict до merge (ADR-0056).

## Волны

| Тикет | Файлы из «Где в коде» (Ticket 80 и этот spec) | Волна |
| --- | --- | --- |
| 01 | `harness/bin/ticket`, `harness/bin/TICKETS.md`, `harness/bin/tests/ticket-header.test.sh`, `harness/bin/tests/ticket-mark.test.sh`, `harness/bin/tests/ticket-evidence.test.sh` | 1 |
| 02 | `harness/bin/epic-status`, `harness/bin/wave-brief`, `harness/bin/tests/epic-status.test.sh`, `harness/bin/tests/wave-brief.test.sh` | 1 |
| 03 | `src/shared/workflow/types.ts`, `src/shared/workflow/ticket-ref.ts`, `src/main/workflow/reader.ts`, `test/contract/workflow-reader.test.ts`, `test/unit/ticket-ref.test.ts` | 1 |
| 04 | `src/main/workflow/stages.ts`, `src/shared/workflow/pipeline.ts`, `test/contract/workflow-stages.test.ts`, `test/unit/pipeline.test.ts` | 2 |
| 07 | `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md` (раздел 2), `harness/skills/ship-ticket/implementer-silent-mode.md`, `harness/skills/ship-ticket/step-2-silent-branch.md`, `harness/skills/ship-ticket/step-9-merge.md` | 2 |
| 05 | `src/shared/workflow/pipeline.ts`, `src/main/workflow/stages.ts`, `src/main/workflow/release.ts` (новый), `harness/lib/pipeline.cjs`, `harness/profiles/README.md`, `CONTEXT.md`, `test/unit/pipeline.test.ts`, `test/contract/workflow-release.test.ts` (новый) | 3 |
| 06 | `src/renderer/pipeline/PipelineBoard.tsx`, `src/renderer/canvas/nodes/TicketNode.tsx`, `src/renderer/canvas/badges/use-checks.ts`, `src/shared/ipc/checks.ts`, `test/unit/pipeline-board.test.tsx`, `docs/features/projects.md` | 4 |
| 08 | `harness/bin/tests/fixtures/multi-repo/**`, `.scratch/worfy-multi-repo-ticket/evidence/08-*` | 5 |

- **Wave 1 — 01, 02, 03.** Формат шапки задан этим spec-ом, поэтому читатели (02, 03) не ждут писателя (01).
- **Wave 2 — 04, 07.** 04 ждёт модель из 03; 07 описывает команды `ticket` из 01. Общих файлов нет.
- **Wave 3 — 05.** Правит те же `pipeline.ts` и `stages.ts`, что 04.
- **Wave 4 — 06.** Board показывает факты из 04 и стадию из 05.
- **Wave 5 — 08.** Приёмка по готовому.

Ни один Ticket с несколькими `Repo:` не пишется, пока не влиты 01–03: старые `epic-status` и worfy берут последнюю
строку `Repo:` и первую `PR:` и показали бы Ticket неверно. Имена новых файлов — предложение; implementer сверяет их с
`main`.

## Не в этом Epic-е

- **`land` через несколько репозиториев и merge в порядке `Repo:` силами worfy** (бывший Ticket 06 черновика). Позже —
  отдельный Epic, когда появится Project над несколькими репозиториями, где вливает агент (`workflow.merge` не `null`).
- **`parallel: worktrees` через несколько репозиториев** (worktree на репозиторий на Ticket) — тогда же.
- Сам release библиотеки: это шаг команды.
- Ссылки между PR в их описаниях — решение владельца Q6: связь только в файле Ticket-а и на Board.
- PR через несколько репозиториев на стороне GitHub и атомарный merge: их нет.
- Full mode для Project над несколькими репозиториями (ADR-0045, пункт 3 в силе).

## Риски

- **Несовместимое изменение библиотеки.** Если ревьюер пропустил поломку старых потребителей, `main` потребителя
  ломается после release. Закрывает правило «каждый PR безопасен сам по себе» и его проверка в ревью; дальше —
  правило красного `main` самого Project-а. worfy revert не предлагает.
- **Release не приходит.** Команда не выпустила версию — Ticket стоит на `release`; `stuck_after` стадии
  (`workflow.pipeline`) подсвечивает его как застрявший.
- **`npm view` не видит частную registry.** Проверка `package` идёт в checkout-е потребителя с его `.npmrc`; если
  registry недоступна, стадия пишет «release not checked», а не «released».
- **Совпадение номеров PR.** Закрыто форматом `<repo>#N` и отказом CLI на голый `#N`.
- **Старый читатель.** Stable copy worfy или Harness старше Ticket-ов 01–03 покажет один репозиторий Ticket-а.
  Закрыто порядком: Ticket-ы с несколькими `Repo:` пишутся только после Wave 1.
- **Второй head потребителя.** Обновление lockfile после release — новый head и новое ревью дельты. Это цена release
  через опубликованную версию, Epic её не убирает.

## Ответ на критику

Критика: [docs/product/critic/worfy-multi-repo-ticket-2026-11-09.md](../../docs/product/critic/worfy-multi-repo-ticket-2026-11-09.md),
verdict Split. Владелец 2026-11-09 выбрал Split (Q0 (б)).

1. **`land` через несколько репозиториев — без пользователя.** Принято. Бывший Ticket 06 (`land`, порядок merge-а
   силами worfy) вынесен в «Не в этом Epic-е»: в единственном Project-е над несколькими репозиториями вливают люди.
   `wave-brief` остался (Ticket 02): ему нужны ключи (repo, N) и без `land`.
2. **Skill-ы описывали worktree и PR от implementer-а.** Принято. Ticket 07 переписан под `parallel: single`: ветка в
   main checkout-е каждого репозитория, одно ревью на head-ах веток до PR, PR вместе после `review success`, merge —
   люди. Ticket 04 берёт стадию до PR по head-ам веток всех `Repo:`.
3. **Release между двумя merge-ами.** Принято. Release и подъём версии — стадия Ticket-а (Ticket 05, строка
   `Release:`): PR потребителя draft до release, Board показывает «waits for release <version>», worfy только ждёт и
   замечает tag или опубликованную версию. Обещание «одна Wave вместо двух» снято (раздел «Цель»).
4. **Ссылки между PR** (критик не знал, примет ли их команда). Владелец отказался (Q6): связь только в файле Ticket-а
   и на Board.

## Решения владельца 2026-11-09

- **Q0 — (б) Split.** Сейчас — шапка, `epic-status`, модель, стадии, Board, приёмка и skill-ы под процесс рабочего
  проекта; плюс стадия release. `land` через репозитории — позже.
- **Q1 — да.** Несколько строк `Repo:`, одна `Branch:`, `PR: <repo>#N`.
- **Q2 — да.** Одно имя ветки во всех репозиториях.
- **Q3 — да.** Порядок merge-а — порядок строк `Repo:`, библиотека первой. PR потребителя несёт подъём версии и
  остаётся draft, пока нет release с этой версией; Board показывает «waits for release <version>»; worfy только ждёт и
  замечает release (tag или опубликованная версия), сам release — шаг команды.
- **Q4 — да.** Нового статуса нет; «1/2 merged» на Board; `done` — только когда влиты все PR.
- **Q5 — да.** Один verdict ревью на Ticket по head-ам всех его веток и PR; новый head любого снимает его.
- **Q6 — нет.** Ссылка между PR в описаниях «подозрительна и ненадёжна — лучше держать на машине». PR ничего не
  говорят друг о друге; связь — только строки `PR:` файла Ticket-а в Workflow folder и Board worfy.
- **Q7 — да.** Частично влитый Ticket остаётся в работе и чинится вперёд в том же Ticket-е; worfy никогда не
  предлагает revert влитого PR — это решение владельца или команды; каждый PR безопасен сам по себе (изменение
  библиотеки обратно совместимо), implementer делает так, ревьюер проверяет.
- **Q8 — да.** Fixture test-ы на stub-проекте из двух репозиториев и один настоящий Ticket в рабочем проекте, который
  ведёт владелец.

## Готово, когда

- [x] Владелец принял spec и ADR-0104; строка `Status:` — `принят владельцем YYYY-MM-DD`.
- [x] Заведены Ticket-ы 01–08 с разделами «Где в коде» из таблицы Волн.
- [x] Ticket 80 Epic-а `worfy-polish` закрыт со ссылкой на этот spec.
