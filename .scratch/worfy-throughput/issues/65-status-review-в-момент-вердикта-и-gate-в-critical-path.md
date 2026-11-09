# 65 — Status `review` ставится в момент вердикта ревью, а не перед merge; потом `critical-path` читает его как Gate

Type: task
Status: claimed 2026-11-09T12:21Z
Branch: worfy-throughput/65
Blocked by: 62
Source: «Итог» Ticket-а [62](62-merge-queue-или-ci-пачками.md), часть 6 и продолжение 5 из части 5; решение
владельца 2026-11-09 (Q1–Q6 «да», вариант B).

## Что происходит

- Skill-ы велят ставить commit status `review` в момент вердикта: `review pending` перед ревью, `review success` или
  `review failure`, когда вердикт записан (`epic-wave`, «The review mark»; `ship-ticket`, шаг 7).
- На деле, по замеру Ticket-а 62, `review` ставится за 10–15 s до merge: у 67 PR от `review` до merge медиана
  0,2 min. Время самого вердикта нигде, кроме комментария `VERIFIED`, не записано.
- `scripts/critical-path.mjs` берёт Gate из последнего комментария `VERIFIED`. У 60 из 222 PR такого комментария нет:
  для них шаг Gate пустой. Читать `review` как Gate сейчас нельзя: Gate → merge и Green → merge схлопнулись бы в 0
  («Итог» Ticket-а 62, часть 6; правка первого круга в PR #1725 отозвана ревью).

## Что делаем

1. Найти, почему `review` ставится перед merge, а не в момент вердикта: кто вызывает `ticket mark … review success`
   и в какой момент (транскрипты Orchestrator-а последних Wave, порядок действий в `epic-wave`). Ответ — в «Итог».
2. Исправить источник: `review success` или `review failure` ставится тем же шагом, что записывает вердикт. Если
   нужен скрипт — он, если только текст skill-а — текст.
3. После того как `review` ставится в момент вердикта: `critical-path` читает время status `review` `success` на head
   как отметку Gate, когда нет комментария `VERIFIED` (или вместо него — решить по данным и записать в «Итог»).
   Unit test на fixture PR с `review` и без `VERIFIED`.
4. Шаг без данных — по-прежнему пустая ячейка с причиной: `review`, поставленный позже вердикта, Gate не даёт.

## Готово, когда

- [x] «Итог»: кто и когда ставит `review` сейчас — с примерами PR и временем.
  - evidence: commit pass · critical-path takes the Gate from the head's review mark when a PR has no VERIFIED (worfy-throughput 65) · - - · 697969367181753b9789aba9685cae5992f2ced2
- [ ] `review` ставится в момент вердикта: на PR после правки от `review` до merge — не секунды (пример в «Итог»).
  Пример — после следующего PR: правка источника сделана Orchestrator-ом вне репозитория (часть 2 «Итог»).
- [x] `critical-path` берёт Gate из status `review` — unit test в `test/unit/critical-path.test.ts`.
  - evidence: test-run pass · `pnpm vitest run test/unit/critical-path.test.ts` exit 0 · mac - · 697969367181753b9789aba9685cae5992f2ced2
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 697969367181753b9789aba9685cae5992f2ced2
  - evidence: gate pass · `gate fast` exit 0 · mac - · 697969367181753b9789aba9685cae5992f2ced2

## Где в коде

- `harness/skills/epic-wave/SKILL.md:534-550` — «The review mark» и блок `ticket mark … review`.
- `harness/skills/ship-ticket/step-7-review.md:100-115` — то же для `ship-ticket`.
- `harness/bin/ticket:948` — `mark()`: запись отметки.
- `harness/bin/land:305-321` — `reviewed`: перенос `review` на новый head (не постановка вердикта).
- `scripts/critical-path.mjs:336-341` — `measure`: Gate из `verdicts(pr)`, то есть из комментария `VERIFIED`.
- `scripts/critical-path.mjs:302-318` — `budgetOf`: `headMarks` (`review`, `check/windows`) делят время после green.
- `src/shared/flight-recorder/pr-facts.mjs:91` — `headMarks`; `:137` — `verdicts`.
- `test/unit/critical-path.test.ts`, `test/fixtures/critical-path/`.

## Вне скоупа

- Обязательный status `review` в branch protection GitHub — не меняется (условие Harness-а, не GitHub).

## Итог

### 1. Кто и когда ставит `review` и `VERIFIED`

- Ставил Orchestrator, своим shell-скриптом вне репозитория: обёрткой над `land` (`dolandb.sh` в его scratchpad,
  строки 12–13 до правки 2026-11-09). Обёртка запускалась после зелёного `ci-ok` и прямо перед `land` публиковала **оба**
  следа вердикта: комментарий `VERIFIED` (`gh pr comment … --body-file <файл вердикта>`) и
  `ticket mark … review success`. Следом шёл `check/windows success`, потом `land`.
- Текст skill-ов был верным: `epic-wave`, «The review mark», и `ship-ticket`, шаг 7 (`step-7-review.md`), велят ставить
  `review success`/`failure`, когда вердикт записан, а `epic-wave` велит записывать каждый вердикт комментарием сразу по
  ответу verifier-а. Обёртка Orchestrator-а этот порядок не соблюдала.
- Поэтому поздний не только `review`, но и `VERIFIED`. Замер по GitHub (`gh`, только чтение), 2026-11-09:

  | PR | `VERIFIED` | `review` | `check/windows` | merge |
  | --- | --- | --- | --- | --- |
  | #1724 | 10:02:29 | 10:02:30 | 10:02:32 | 10:02:42 |
  | #1726 | 10:27:29 | 10:27:30 | 10:27:32 | 10:27:42 |
  | #1730 | 10:36:17 | 10:36:18 | 10:36:20 | 10:36:31 |
  | #1731 | 12:06:04 | 12:06:05 | 12:06:06 | 12:06:16 |
  | #1733 | 11:59:08 | 11:59:09 | 11:59:11 | 11:59:21 |

  - 30 последних merged PR (#1702–#1733), из них 17 с `VERIFIED`: от `VERIFIED` до merge 11–14 s, медиана 12 s; от
    `review` до merge 10–13 s, медиана 11 s.
  - 120 merged PR (#1612–#1733): у 58 на head есть status `review`. У 51 из них есть и `VERIFIED`: от последнего
    `VERIFIED` до merge медиана 12 s, `review` позже `VERIFIED` на 1 s (медиана; от 0 до 23 s). От самого раннего
    `review success` до merge медиана 11 s, максимум 17 s. На каждом из 58 head-ов ровно один `review success`; ни
    одного `review pending` (skill велит ставить его перед verifier-ом), ни одного `review failure`, ни одной копии от
    `land` («carried from …»).
  - У 7 из 58 (#1684, #1685, #1688, #1689, #1692, #1695, #1696) комментарий вердикта начинается с `PR #N (…) round …:
    VERIFIED`, а не с `VERIFIED`: `verdictComments` (`src/shared/flight-recorder/pr-facts.mjs`) такой не узнаёт, и Gate
    у этих PR в отчёте был пустым.
- Что это значит для шага Gate, который `critical-path` показывал до сих пор. Отметка Gate — это не вердикт, а запуск
  `land` Orchestrator-ом. Время самого ревью и ожидание, пока Orchestrator дойдёт до `land`, сидят внутри
  «CI → Gate». «Gate → merge» (около 12 s) — время работы `land`, а не очередь merge. «Green → merge» по тем же
  причинам почти всегда равно этим секундам. Разбивка «после green: gate / merge queue» для таких PR смысла не имеет.
  Верные числа Gate начнутся с PR, где вердикт опубликован в момент вердикта (часть 2).

### 2. Источник: правка Orchestrator-а, вне репозитория

- 2026-11-09 Orchestrator поправил свои скрипты (вне репозитория, в своём scratchpad):
  - новый `mark-verdict.sh` публикует комментарий вердикта и `ticket mark … review success` в момент, когда вердикт
    записан, и оставляет метку «опубликовано для этого head»;
  - `dolandb.sh` пропускает оба шага, если для этого head они уже опубликованы (строки 12–15 после правки).
- Текст skill-ов не меняется: `epic-wave` («The review mark», блок записи вердикта `gh pr comment <N> --body
  "VERIFIED"`) и `ship-ticket` (`step-7-review.md`, «The review mark») уже велят ставить отметку и писать вердикт в
  момент вердикта.
- Пример PR, где от `review` до merge не секунды, — после следующего PR с вердиктом через `mark-verdict.sh`.

### 3–4. `critical-path`: Gate из `review`

- Решение по данным: Gate — последний комментарий `VERIFIED`, как раньше; **без него** — `review` `success` на head
  PR (какой именно — ниже). Не «вместо»: где есть оба (51 PR), они расходятся на 1 s (медиана), так что замена значения не
  меняет. Зато стоит одного вызова `gh api` на каждый PR и ломает отчёты, сверенные байт в байт
  (`test/fixtures/flight-recorder/critical-path-before.json`). Запасной путь даёт Gate 7 из 58 PR с `review` (12%), у
  которых он был пустым. После правки части 2 оба следа публикует один скрипт в один момент, так что расходиться они не
  должны; если разойдутся — вернуться к выбору.
- Как читается `review`:
  - только из `gh api --paginate --slurp repos/<owner>/<repo>/commits/<head>/statuses` (все status-ы head, новые
    первыми, все страницы, не только первые 100). Head — `headRefOid` PR (`critical-path` добавляет это поле к
    `GH_FIELDS`); без него — последний из `commits`, а gh отдаёт не больше 100 коммитов. `statusCheckRollup` хранит лишь
    последний status каждого контекста и без описания: по нему нельзя взять самый ранний и нельзя отличить копию
    `land`. `critical-path` спрашивает status-ы только у PR без `VERIFIED`; в файле `--prs` — необязательное поле
    `statuses` у PR;
  - берётся самый ранний `review` `success` **после последнего** `review` `failure` или `error` на этом head.
    Повторная публикация того же вердикта позже Gate не двигает. Успех, который отменил более поздний `failure`, не
    считается. `pending` и status-ы других контекстов (`check/windows`) вердиктом не считаются. Если после последнего
    `success` был `failure` — пустая ячейка «review failure on the PR head after its last review success»;
  - `review`, который `land` перенёс на новый head после rebase (`harness/bin/land`, `reviewed`, описание
    `carried from <sha>: …`), пропускается: время копии — время запуска `land`, не вердикта. Если на head только копия —
    пустая ячейка «review on the PR head only carried by land». Искать исходную отметку на старом head не стали: в
    описании только короткий SHA, а в данных таких копий 0 из 58 (с #1730 `land` вливает PR позади `main` без rebase);
  - `review` позже merge Gate не даёт: пустая ячейка «no VERIFIED comment on the PR, review success after the merge».
    Без status-ов head причина прежняя — «no VERIFIED comment on the PR».
- Проверка на реальных PR (`critical-path --epic worfy-scrub --tickets 01,02,03 --repo IDSAD-XL/worfy`): у #1685,
  #1689, #1688 (без `VERIFIED` в начале комментария) «Gate → merge» теперь 11 s, 11 s и 13 s вместо пустой ячейки.
- Код: `reviewMark`, `gateMark`, `headSha` в `src/shared/flight-recorder/pr-facts.mjs` (типы — `pr-facts.d.mts`),
  вызов и запрос status-ов в `scripts/critical-path.mjs`. Tests: `test/unit/critical-path.test.ts`, describe «the Gate
  from the review mark of the head when there is no VERIFIED comment»; fixture
  `test/fixtures/critical-path/prs-review.json` — PR с `review` без `VERIFIED`; PR с `success` 02:30, `failure` 02:45,
  `pending` 02:46, `check/windows` `success` 02:48 и `review` `success` 02:50 и 02:57 (Gate — 02:50); PR с `review`
  позже merge (пустая ячейка). Через поддельный `gh`: status-ы запрашиваются только без `VERIFIED`; копия `land`
  пропускается; читаются все страницы `--slurp`; head берётся из `headRefOid`; `failure` после последнего `success` и
  `failure` без `success` дают пустую ячейку. Mutation testing на копии в `/tmp`: 12 мутантов — без фильтра контекста
  `review`, любой state вместо `success`, `state !== 'pending'`, без правила «после последнего failure», `failure` не
  считается отказом, максимум вместо минимума, без проверки «после merge», без фильтра копий, без `headRefOid`, без
  разбора страниц, без `--paginate --slurp`, без запасного пути — все убиты.
- Приложение (Flight Recorder, `src/shared/flight-recorder/from-github.ts`) по-прежнему берёт Gate только из
  `VERIFIED`: этот Ticket его не трогает.
