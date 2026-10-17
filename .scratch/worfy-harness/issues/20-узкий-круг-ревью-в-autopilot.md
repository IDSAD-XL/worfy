# 20 — Autopilot делает один узкий круг ревью без владельца, если находки только med и low

Type: task
Status: done 2026-10-08
PR: #144
Blocked by: 16
Source: решение владельца 2026-10-07, вопрос Q7 ([spec.md](../spec.md)); [ADR-0046](../../../docs/adr/0046-autopilot-narrow-round-without-owner.md) — узкий круг в Autopilot; [ADR-0024](../../../docs/adr/0024-autopilot-wave-end-and-keep-awake.md) — worfy не знает протокола skill-а; [ADR-0033](../../../docs/adr/0033-autopilot-names-wave-tickets.md) — остановка прогона с `blocked-tickets`; урок «Узкий круг исправления» в `docs/lessons/process.md:22-28`

## Что происходит

- **Узкий круг уже есть в epic-wave.** Узкий круг исправления — ещё один круг доработки ровно по
  подтверждённым находкам второго ревью. Исходник — `~/.claude/skills/epic-wave/SKILL.md:244-254`;
  в `harness/` после Ticket-а 06 — тот же абзац на английском. Правило сейчас:
  - второй `REJECTED` выводит Ticket из Wave;
  - исключение — Ticket на критическом пути: у него ≥ 3 транзитивно зависимых не-`done` Ticket-а по
    `blockedNums` из `epic-status --json`;
  - находки второго круга не уровня high и устояли перед агентами-скептиками (по `reviewer` на
    находку);
  - вердикты — `NARROW: <находки>`, затем `NARROW: VERIFIED` или `NARROW: REJECTED`;
  - листовому Ticket-у узкий круг — только по решению владельца.

  Вердикт записывается так, чтобы пережить перерыв Session: комментарием в PR, а при финише без PR
  (`local-green`) — пустым коммитом `gate: …` в ветке Ticket-а (`SKILL.md:213-227`).
- **Чего правило не говорит.** Оно не говорит, как вести себя без человека.
  - В Autopilot вопрос владельцу отклоняется автоматически (`SKILL.md:123-126`).
  - Q7 называет то, что делается сейчас, «пропуск с отчётом». Ticket выходит из Wave строкой
    `blocked`, прогон кончается `run-stopped` с `blocked-tickets` и номерами Ticket-ов
    (`src/main/autopilot/run.ts:630-639`, ADR-0033).
  - Предел записан в `docs/roadmap.md` («Перенесено из E2»), пример — Ticket 15 `worfy-daily`.
- **Журнал прогона не знает узкого круга.** Журнал прогона — JSONL-файл
  `<WORFY_DATA_DIR>/autopilot/<run>.jsonl`. В его видах событий узкого круга нет
  (`src/shared/autopilot/journal.ts:81-95`; спецификация формата — комментарий в начале файла).
  Строки неизвестного вида старые читатели пропускают и считают (`:73-75`).
- **Маркер в ответе Orchestrator-а запрещён.** ADR-0024 отверг маркер в ответе Orchestrator-а: с
  ним worfy знал бы формат skill-а. ADR-0046 (пункт 5) оставляет этому Ticket-у выбрать, как worfy
  узнаёт об узком круге, не зная формата skill-а.
- **Что worfy уже читает.** Он уже читает комментарии PR веток Ticket-ов: `gh pr list` с полем
  `comments` (`src/main/github/prs.ts:31`). Оттуда он берёт вердикт ревью для chip-а:
  `/^(VERIFIED|REJECTED)\b/` (`:162-170`, тип — `src/shared/ipc/checks.ts:55-65`).
  - Комментарий `NARROW: VERIFIED` вердиктом не считается, и chip показывает прошлый `REJECTED`.
  - Ticket 10 переделывает разбор вердиктов. Исполнитель сверяет на момент взятия, понимает ли
    разбор уже `NARROW:`.
  - `PrTracker` создаёт `appPrTracker` (`src/main/ipc/checks.ts:50-64`). Autopilot собирается в
    `src/main/ipc/autopilot.ts:50-72`.

## Что делаем

1. **Правило epic-wave для Session без человека** (Q7). Ticket на критическом пути получил второй
   `REJECTED`.
   - **Узкий круг.** Все находки, устоявшие перед скептиками, уровня med или low (ни одной high).
     Тогда Ticket получает ровно один узкий круг по этим находкам, без вопроса владельцу и без
     ожидания.
   - **Блок и отчёт.** Ticket-у — `ticket block` с причиной, в отчёте Wave — строка `blocked`. Так
     бывает в трёх случаях:
     - есть находка high — узкого круга нет;
     - узкий круг кончился `NARROW: REJECTED`;
     - нужен второй узкий круг тому же Ticket-у.
   - **Листовой Ticket** в Autopilot узкого круга не получает. Ему — блок и отчёт со строкой в «Ждёт
     владельца»: «узкий круг листовому Ticket-у — решение владельца». Так и было.
   - Определение критического пути, скептики, три основания `REJECTED` узкого круга и запись
     вердиктов `NARROW: …` не меняются. Нового протокола со skill-ом для worfy нет (ADR-0024).
   - Текст — в `harness/skills/epic-wave/SKILL.md`, по-английски (после Ticket-а 06).
2. **worfy узнаёт об узком круге из комментариев PR**, которые он уже читает (ADR-0024: только то,
   что worfy и так видит).
   - Новая `narrowOf(comments)` в `src/main/github/prs.ts`. Её ответ — последнее состояние узкого
     круга PR или `null`:
     - `started` — комментарий `NARROW: <находки>`;
     - `verified` — `NARROW: VERIFIED`;
     - `rejected` — `NARROW: REJECTED…`.
   - Вместе с состоянием — первая строка того комментария, обрезанная, как `lastText`. Находки worfy
     не разбирает.
   - `verdictOf` понимает `NARROW: VERIFIED` как `VERIFIED`, а `NARROW: REJECTED` как `REJECTED` —
     если Ticket 10 этого ещё не сделал.
3. **Журнал: новый вид `narrow-round`.**
   - Поля: `ticket` (номер строкой, как в `tickets`); `outcome` — `started`, `verified` или
     `rejected`; `text` — первая строка комментария.
   - Пока идёт Wave, прогон читает PR веток её Ticket-ов через тот же `PrTracker`, что бейджи PR. Он
     не чаще раза в 60 с (`src/main/github/prs.ts:3`) и лишних вызовов `gh` не делает. Ветку
     Ticket-а находит так же, как бейджи (`parseTicketBranch`,
     `src/shared/workflow/ticket-ref.ts:26`).
   - Новое состояние — одна строка журнала. Пара `ticket` + `outcome` за прогон пишется один раз.
   - **Без PR строки нет.** Это финиш `local-green` и случай, когда `gh` недоступен. Спецификация в
     комментарии `journal.ts` говорит это прямо: этот комментарий и есть формат файла.
4. **Отчёт Wave.** В таблице отчёта epic-wave колонка «Доработка» показывает узкий круг. Пример:
   `1 круг + узкий`. Пример таблицы — `SKILL.md:359-362`.

ADR не нужен: правило — в ADR-0046. Способ узнать об узком круге выбран в рамках ADR-0024 и
записывается в «Итог».

**Не входит:**
- узкий круг вне Autopilot — правило для Session с человеком не меняется;
- определение критического пути;
- журнал для финиша `local-green` — worfy не читает коммиты веток;
- экран журнала в worfy.

## Готово, когда

- [x] Contract test `test/contract/github-prs.test.ts`, `narrowOf`:
  - `NARROW: [med] …` → `started`;
  - затем `NARROW: VERIFIED` → `verified`;
  - `NARROW: REJECTED: …` → `rejected`;
  - без `NARROW:` → `null`.
- [x] Тот же test, `verdictOf`: последний комментарий `NARROW: VERIFIED` → `VERIFIED`, `NARROW: REJECTED: …` → `REJECTED`.
- [x] Unit `test/unit/autopilot-journal.test.ts`:
  - строка `narrow-round` с верными полями читается;
  - неверный `outcome` — строка пропущена и посчитана;
  - журнал без `narrow-round` читается как раньше.
- [x] Unit `test/unit/autopilot-run.test.ts`, читатель PR подменён:
  - смена состояния PR Ticket-а Wave → строка `narrow-round`;
  - то же состояние при следующем чтении → строки нет;
  - Ticket не из Wave → строки нет;
  - сбой чтения PR → строки нет, прогон идёт.
- [x] e2e `test/e2e/autopilot.spec.ts`. Подменённый `gh` (`WORFY_GH`) отдаёт PR ветки Ticket-а 02 с комментариями `NARROW: [med] …` и `NARROW: REJECTED: …`; подменённый агент — новый скрипт `test/fixtures/agent-scripts/autopilot-narrow.jsonl`. В файле журнала прогона:
  - строки `narrow-round` `started` и `rejected` Ticket-а 02;
  - `run-stopped` с `blocked-tickets` и `["02"]`.
- [x] `grep -n 'NARROW' harness/skills/epic-wave/SKILL.md` — код 0, а `grep -n 'worfy-narrow\|WAVE DONE' harness/skills/epic-wave/SKILL.md` — код 1: правило есть, маркера для worfy нет.
- [x] e2e — локально, `gate full` на ветке после rebase: код 0 и строка вердикта «зелено». Команда — из `rules.md` Profile на момент взятия: после Ticket-а 16 `gate.sh` лежит в plugin.

## Тесты

Сначала падающий test — `test/contract/github-prs.test.ts`, случай «`NARROW: VERIFIED` после
`REJECTED` → `VERIFIED`»: на main `verdictOf` отдаёт `REJECTED`, test красный. Если Ticket 10 это
уже исправил, первым падает случай `narrowOf`. Как он падал — в «Итог».

- `test/contract/github-prs.test.ts` — `narrowOf` и `verdictOf` с `NARROW:`.
- `test/unit/autopilot-journal.test.ts` — вид `narrow-round`.
- `test/unit/autopilot-run.test.ts` — строки журнала по состояниям PR.
- `test/e2e/autopilot.spec.ts` и `test/fixtures/agent-scripts/autopilot-narrow.jsonl` — прогон
  целиком.
- Правило skill проверяет reviewer с линзой «смысл сохранён» и ADR-0046 в брифе. Он сверяет, что
  правило для Session с человеком не изменилось, а для Autopilot совпадает с Q7.

## Где в коде

- `harness/skills/epic-wave/SKILL.md` (исходник — `~/.claude/skills/epic-wave/SKILL.md`)
- `src/main/github/prs.ts`
- `src/shared/ipc/checks.ts`
- `src/main/ipc/checks.ts` — один `PrTracker` на приложение для бейджей и Autopilot
- `src/main/ipc/autopilot.ts`
- `src/shared/autopilot/journal.ts`
- `src/main/autopilot/run.ts`
- `test/contract/github-prs.test.ts`
- `test/unit/autopilot-journal.test.ts`
- `test/contract/autopilot-journal.test.ts` — полный список видов строк
- `harness/bin/tests/epic-wave-ship-ticket.test.sh` — одна строка в allowlist кириллицы для примера строки «Ждёт владельца»
- `test/unit/autopilot-run.test.ts`
- `test/e2e/autopilot.spec.ts`
- `test/fixtures/agent-scripts/autopilot-narrow.jsonl` — новый

Общие файлы с соседями:
- `harness/skills/epic-wave/SKILL.md` — Ticket-ы 18 и 22;
- `src/main/autopilot/run.ts`, `src/main/ipc/autopilot.ts`, `src/shared/autopilot/journal.ts`,
  `test/unit/autopilot-run.test.ts`, `test/unit/autopilot-journal.test.ts` — Ticket 21: пометка
  «Harness в main новее» в журнале прогона. По плану Ticket 21 идёт после этого Ticket-а
  (spec.md, раздел «Волны», сдвиги), но вычисление Wave в момент запуска может взять его раньше,
  пока Ticket 16 стоит `blocked`. Кто идёт вторым, делает rebase на общих файлах.

В одной Wave такие Ticket-ы идут последовательно. `src/main/github/prs.ts` и
`src/shared/ipc/checks.ts` правит и Ticket 10 — он без блокеров и к этому времени влит.

## Итог

PR #144, ветка `worfy-harness/20`.

- **Как падал первый test.** `test/contract/github-prs.test.ts`, случай «`REJECTED`, `REJECTED`, затем
  `NARROW: VERIFIED`». На main `verdictOf` отдавал `REJECTED`: «AssertionError: expected 'REJECTED' to be
  'VERIFIED'». Ticket 10 `NARROW:` не разбирал. Случаи `narrowOf` падали с «narrowOf is not a function».
- **Как worfy узнаёт об узком круге** (в рамках ADR-0024). worfy читает вердикты `NARROW:` из комментариев
  PR Ticket-ов своих Wave-ов. Читает через тот же `PrTracker`, что и бейджи PR: один на приложение,
  `sharedPrTracker()` в `src/main/ipc/checks.ts`. gh по-прежнему вызывается не чаще раза в 60 с. Маркера в
  ответе Orchestrator-а нет, нового протокола со skill-ом тоже нет. Прогон читает PR при `wave-started`,
  раз в минуту, пока идёт, и ещё раз перед `run-stopped`. При Force stop и выходе из приложения
  последнего чтения нет. Комментарии, сделанные до старта прогона (`createdAt` от gh раньше часов
  worfy на старте), строк не дают: это прошлые прогоны и закрытые PR. Комментарий без `createdAt`
  берётся — решено без владельца, подтверждено владельцем 2026-10-12.
- **Отступление: `narrowRoundsOf` вместо одного «последнего состояния»** — решено без владельца,
  подтверждено владельцем 2026-10-12.
  - `narrowOf` сделана как в тикете: отдаёт последнее состояние, по ней contract test.
  - Но PR несёт все состояния узкого круга (`narrowRoundsOf`). Прогон пишет каждое ещё не записанное
    состояние, по порядку комментариев.
  - Почему так. e2e тикета хочет две строки, `started` и `rejected`, из одного ответа gh, где уже лежат
    оба комментария. По одному последнему состоянию вышла бы только `rejected`. Второе чтение gh
    возможно не раньше чем через 60 с.
  - Цена. В `PullRequest` появилось необязательное поле `narrow`: состояния с текстом и временем
    комментария. Комментарии до старта прогона отсекаются по этому времени (круг доработки 1).
- **Ограничение.** Комментарий `NARROW:`, оставленный меньше чем за минуту до конца прогона, может не
  попасть в журнал: `PrTracker` отдаёт кэш, пока не прошёл его интервал. Так же теряется ответ gh,
  который не успел за 1 с последнего чтения. Это записано в спецификации формата, в комментарии
  `journal.ts`. На живом gh не проверено.
- **Задержка `run-stopped`.** Последнее чтение PR перед `run-stopped` ждёт не больше `END_READ_MS` = 1 с
  (`src/main/autopilot/run.ts`). Force stop и выход из приложения обрывают это ожидание сразу:
  выход ждёт конца прогонов только 3 с. В первом круге ожидание было ничем не ограничено: gh делает
  несколько вызовов, у каждого свой timeout. Ревью круга 1 это нашло. Покрыто unit test-ами
  `test/unit/autopilot-run.test.ts` (медленный читатель PR против `stopAll`, Force stop и предела).
- **SKILL.md.** Пример строки для «Ждёт владельца» по-русски («узкий круг листовому Ticket-у — решение
  владельца») стоит рядом с английской формулировкой. Для него в allowlist кириллицы test-а
  `harness/bin/tests/epic-wave-ship-ticket.test.sh` добавлена одна строка — с разрешения
  orchestrator-а. Раздел «How to resume a wave» и подсказка у команд подсчёта кругов говорят, что
  комментарий или коммит `NARROW:` значит «узкий круг уже был», а последний `NARROW: VERIFIED` или
  `NARROW: REJECTED` — вердикт; для `pr-green-ci` и для `local-green`.
- `test/contract/autopilot-journal.test.ts` добавлен в «Где в коде»: в нём полный список видов строк.

Гейт волны 8: `REJECTED` (2 med, 5 low: ожидание `gh` перед `run-stopped` против 3 с выхода из приложения; счётчик
кругов в «How to resume a wave» не видел `NARROW:`; граница «до 30 с»; старые `NARROW:` в журнале нового прогона;
три правки текста) → доработка `7aeecba..47d23f4` → `VERIFIED` во втором круге (PR #144, влит `50b6c0d`). Выход за
след — одна строка `ALLOWED` в `harness/bin/tests/epic-wave-ship-ticket.test.sh` — разрешил оркестратор. Долги
ревьюера (не блокируют):
- [low] `src/main/autopilot/run.ts:1084` — старт прогона по часам Mac, `createdAt` — по часам GitHub, запаса нет:
  если часы Mac спешат, `NARROW:` из первых секунд прогона молча не попадёт в журнал.
- [low] `src/main/autopilot/run.ts:921-922` против `:534` — `stopAll` берёт список прогонов с фоновыми задачами в
  момент вызова; обычный конец прогона, застигнутый выходом на последнем чтении, встаёт в список позже, и строки
  `tasks-killed app-quit` для живых фоновых задач не будет (было и до Ticket-а).
