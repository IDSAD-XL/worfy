# worfy-neutral: Harness нейтрален по языку и проекту — User personalization, английский протокол, код без кириллицы

Status: по решению владельца 2026-10-19 (grilling «worfy-neutral», Q1–Q15, все приняты как
рекомендованы); «Готово, когда», файлы Ticket-ов и Wave-ы — предложение этого docs-PR
Source: решения владельца 2026-10-19 в чате с Orchestrator-ом на Mac; замер по main `07f17fa3`.
[CONTEXT.md](../../CONTEXT.md) — термины (Harness, Profile, User personalization); ADR
[0041](../../docs/adr/0041-harness-rules-via-session-hooks.md),
[0044](../../docs/adr/0044-harness-in-english-language-from-profile.md),
[0056](../../docs/adr/0056-windows-checks-and-two-sessions.md),
[0071](../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md),
[0074](../../docs/adr/0074-harness-neutral-by-language-and-project.md) (этот PR); Epic
[worfy-pipeline](../worfy-pipeline/spec.md) — формат и соглашения.
Ticket-ы: Epic `worfy-neutral`, 8 Ticket-ов, нумерация с `01`. Шапка — `Type:` / `Status:` / `Blocked by:` /
`Source:` по `harness/bin/TICKETS.md`; ожидание чужого Epic-а — `Status: blocked` с `Blocked reason:` и
`Waits:`, его пишет `bin/ticket block`.

## Откуда

ADR-0044 перевёл прозу Harness на английский и взял языки из Profile, но оставил русскими то, что
читают программы и что пишет сам worfy. Подробности с `file:line` — в ADR-0074, «Контекст». Коротко:

- **Языковые правила в plugin.** «Writing in Russian: the term stays in Latin»
  (`harness/hooks/rules/common.md:12-20`) и разделы `## Terms` (`harness/agents/implementer.md:274-283`,
  `harness/agents/reviewer.md:258-267`, `harness/agents/scout.md:68-77`) получает каждая Session любого
  пользователя.
- **Русский протокол.** Метки блока статуса (`harness/hooks/rules/orchestrator.md:118-129`,
  `src/shared/agent/status-block.ts:20,23`), строки Gate (`harness/hooks/gate.mjs`, `harness/hooks/gate.sh:184`,
  `harness/bin/wave-gate:452-459`, `src/main/gate/state.ts:186-193`), слова в `bin/ticket`, `bin/epic-status`,
  `bin/silent-check`, `## Источники` в `harness/hooks/session-start.mjs:183`.
- **Русские тексты агентам.** `src/main/autopilot/limits-wait.ts:25-29`, `src/main/autopilot/run.ts:126`,
  `src/shared/projects/action-templates.ts:44`.
- **Названия разделов — литералы кода.** `scripts/check-handoff.mjs:23`, `scripts/check-lessons.mjs:25`,
  `src/main/workflow/reader.ts:179`, `src/shared/workflow/manual-checks.ts:6,10`, `src/main/docs/watch.ts:121`.
- **Следы владельца в plugin** (`harness/` без test-ов): Auction и Atakama — 41 строка в 16 файлах,
  `/Users/` — 10 строк в 4 файлах, имена и учётные записи владельца — 10 строк в 4 файлах, ссылки на ADR —
  67 строк в 31 файле, пути `src/main/` — 10 строк в 5 файлах.
- **Кириллица в коде:** `harness/` без `.md` — 525 строк в 30 файлах (в `hooks/gate.mjs` — 85) и 1004 строки
  в test-ах и eval-кейсах; `src/` — 93 строки в 44 файлах (76 — комментарии); `scripts/` — 35 строк
  (7 — комментарии); `test/` вне `test/fixtures/` — 16 строк комментариев; `test/fixtures/` — 56 файлов
  данных. В `harness/` кириллица есть в 29 из 66 файлов `.md`.

Что уже есть и годится:

- Profile уже знает `language.team` и `language.docs` (`harness/profiles/README.md:120-122`) и раздел следа
  Ticket-а `tickets.trail_section` (у worfy — `## Где в коде`).
- Вердикт Gate для приложения — JSON-файл (ADR-0044, пункт 5); строки `[gate] …` — запасной путь.
- Правила подмешивает `harness/hooks/inject-rules.mjs` — в `SessionStart` и `SubagentStart`
  (`harness/hooks/hooks.json`).
- Команда Wave для plugin уже английская: `/worfy:epic-wave tickets {tickets} of epic {epic}`
  (`src/shared/projects/action-templates.ts:54-58`).

## Цель

Plugin годится любому пользователю: английский, без следов владельца и репозитория worfy, язык
общения и личные правила — у пользователя, протокол — английский, код репозитория — без кириллицы.

Epic готов, когда:

1. Язык отчётов берётся из `~/.claude/worfy-harness/user.json`, личные правила — из
   `~/.claude/worfy-harness/user/rules.md`; языковых правил в plugin нет; у владельца — свои файлы,
   отчёты по-прежнему русские (Ticket 01).
2. В `harness/` нет Auction, Atakama, имён и путей владельца, ссылок на номера ADR и Ticket-ов и путей
   `src/main/...`; примеры общие (Ticket 02).
3. Метки блока статуса — `Stage / Now / Next / Waiting`; приложение читает и их, и старые (Ticket 03).
4. Строки Gate и слова протокола скриптов Harness — английские; читатели принимают и старые (Ticket 04).
5. Тексты, которые worfy шлёт агенту, — английские (Ticket 05).
6. Названия разделов документов код берёт из настроек Project-а (Ticket 06).
7. Комментарии кода — английские; правило lint ловит кириллицу вне разрешённых мест (Ticket 07).
8. После следующего релиза разбор старых русских слов удалён (Ticket 08).

## Решения владельца

2026-10-19, grilling «worfy-neutral». Все пункты приняты как рекомендованы; заново не решаются.

1. **Q1. Plugin целиком английский и нейтральный.** `harness/` (hooks, `bin/`, правила, skills, agents,
   README, eval-кейсы) — ничего о конкретном владельце, Mac, внутренностях репозитория worfy, Auction
   или Atakama; примеры — `demo`, `acme`; пути — из Profile.
2. **Q2. Язык отчётов — настройка пользователя** в `~/.claude/worfy-harness/user.json`, для всех Project-ов.
   `team` и `docs` — в Profile. Ничего не задано — английский везде.
3. **Q3. Языковые правила уходят из plugin** в `~/.claude/worfy-harness/user/rules.md`; hook подмешивает
   файл, если он есть, и не знает его содержания. Владельцу — `user.json` с `reports: ru` и `rules.md`
   с перенесёнными правилами: для него ничего не переходит на английский.
4. **Q4. Метки протокола — английские:** блок статуса `— Stage / Now / Next / Waiting`; строки Gate
   `[gate] green / red / not verified` и строка «nothing ran»; слова протокола в `bin/ticket`,
   `bin/epic-status`, `bin/silent-check`, `## Sources` в `session-start`. Старые русские слова читатели
   принимают один релиз.
5. **Q5. Документы Project-а — на его языке** (`docs: ru` у worfy). «Только английский» — для plugin и кода.
6. **Q6. Без кириллицы в коде** `src/`, `scripts/`, `test/`, `harness/`. Исключения: текст интерфейса — в
   файлах перевода; данные test-ов на русский ввод — с английским комментарием, зачем. Правило lint.
7. **Q7. Имя `worfy` остаётся.** Ссылки на ADR и Ticket-ы, пути `src/main/...`, Auction и Atakama, пути
   владельца уходят из поставляемых файлов plugin; правило объясняет себя само.
8. **Q8. Метки блока статуса всегда английские,** текст после них — на языке пользователя
   (`— Stage: worfy-windows 65, ревью круг 1`).
9. **Q9. Всё, что worfy шлёт агенту, — английское;** skill `epic-wave` ещё один релиз принимает старую
   русскую форму команды.
10. **Q10. Названия разделов, которые разбирает код, — из настроек Project-а** (Profile или небольшой
    конфиг репозитория). Для worfy настройка держит сегодняшние русские заголовки.
11. **Q11. Русские данные `test/fixtures/` (56 файлов) остаются;** переводятся 16 комментариев test-ов и
    строки протокола, которые меняет Q4. Lint разрешает кириллицу в `test/fixtures/**` и в строках данных
    test-ов, не в комментариях.
12. **Q12. ADR-0074** «Harness нейтрален по языку и проекту» дополняет ADR-0044; термин User personalization —
    в `CONTEXT.md`.
13. **Q13. Новый Epic `worfy-neutral`** — этот spec и Ticket-ы.
14. **Q14. Ticket-ы и порядок:** 01 и 02 — сейчас; 03–06 — после того, как Session на Windows-ПК закончит
    срезы `worfy-windows` 14, которые трогают test-ы скриптов Harness; 07 — последним; 08 — после
    следующего релиза.
15. **Q15. Реализуют Session-и на Mac, по одному Ticket-у.** Ticket-ы, которые трогают скрипты Harness или
    код для Windows, ждут вердикта Windows с ПК (владелец назвал 02, 04, 06, 07; см. «Соглашения» о 01).

## Не в этом Epic-е

- **Перевод документов Project-а** (Ticket-ы, ADR, HANDOFF, `CONTEXT.md`) — остаются на `language.docs` (Q5).
- **Перевод данных `test/fixtures/`** — это русский ввод, который проверяют test-ы (Q11).
- **Файлы перевода интерфейса (i18n) как система.** Интерфейс worfy английский (`docs/design/BRIEF.md`);
  русская строка интерфейса в коде переводится на английский (Ticket 07), каталог переводов не заводится.
- **Profile и `rules.md` Profile-а worfy** — вне репозитория; их правка — шаг Orchestrator-а после мержа,
  diff — в «Итог» Ticket-а.

## Риски

- **Владелец без `user.json` получит английские отчёты.** Файлы владельца создаются в том же шаге, что
  удаление правил из plugin (Ticket 01), до `pnpm install:stable`.
- **Окно одного релиза.** Транскрипты, Ticket-ы и Session-и со старыми словами живут дольше релиза. После
  08 приложение читает вердикт Gate только из JSON-файла; старые блоки статуса в старых транскриптах не
  разбираются — это принято (Q4).
- **Скрипты Harness читают русский ввод проектов.** `bin/ticket migrate` узнаёт русские слова старых шапок
  (`harness/bin/ticket:342-344`), `epic-status` — русские слова отрицания в `Blocked by`
  (`harness/bin/epic-status:208-210`), `silent-check` — слово «Тикет» (`harness/bin/silent-check:156`). Это
  не протокол, а данные о языке ввода. Предложение этого docs-PR (не решение владельца): Ticket 04 выносит
  такие списки слов в отдельный файл данных с английским комментарием, и правило lint 07 разрешает
  кириллицу только в нём. Если владелец решит иначе — правка Ticket-ов 04 и 07.
- **Большой текстовый diff Ticket-а 02** (ссылки на ADR в 46 файлах с test-ами) может потерять правило:
  ревью проверяет, что вместо каждой ссылки стоит само правило, а не пустое место.
- **Общие файлы с `worfy-windows` 14.** Срезы 14 правят test-ы скриптов Harness (`harness/bin/tests/*`,
  `harness/hooks/tests/*`); 03–06 ждут их окончания (Q14), иначе конфликты в тех же test-ах.
- **Предел правил в hook.** Часть правил — не больше 10 000 символов (ADR-0041); `user/rules.md` подчиняется
  тому же пределу, длиннее — обрезка с указанием пути.

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-pipeline](../worfy-pipeline/spec.md), раздел «Соглашения для Ticket-ов этого Epic-а»: сначала
падающий test, только чтение чужих файлов, ручные пункты «(вручную)», без `gh auth switch`, мерж в main —
Orchestrator, по очереди или набором `wave-gate` (ADR-0065). Отличия:

- **Кто ведёт.** Session на Mac, один Ticket за раз (Q15); не Autopilot.
- **Платформенные PR** (ADR-0056, пункт 2; ADR-0071). Владелец назвал 02, 04, 06, 07. По ADR-0056, пункт 2,
  платформенный и 01: он меняет скрипты Harness (`harness/bin/profile`, `harness/hooks/inject-rules.mjs`).
  03 — платформенный, если его diff трогает `harness/bin/` или `harness/hooks/` (включая их test-ы). 05 и 08 —
  по списку путей ADR-0071, пункт 5.
- **Конец Ticket-а** — PR; CI на PR нет (`workflow.ci: batch`, ADR-0068); gate full — шаг Orchestrator-а
  перед merge; мерж — Orchestrator.
- **Когда правка Harness действует.** После `pnpm install:stable` (ADR-0047). Файлы User personalization
  владельца (Ticket 01) и правка Profile-а worfy — шаг Orchestrator-а после мержа, вне PR.
- **Test-ы с `~/.claude`** — только в песочнице: `HOME` и `HARNESS_HOME` во временной папке.
- **Ветки** — `worfy-neutral/<NN>`; worktree — `.claude/worktrees/<NN>`, если путь занят — `.claude/worktrees/nt-<NN>`.
- **ADR.** ADR-0074 — этот PR. Ticket-ам новый ADR не нужен. Принятые ADR не правятся.
- **Один релиз старых слов.** Каждое место, которое принимает старое русское слово, помечено комментарием
  `shortcut: accepts the old Russian token, remove after the next release (worfy-neutral 08)` — по нему 08
  находит всё.
- **Язык.** Документы — русские, термины — латиницей, из `CONTEXT.md`; код, комментарии, коммиты, PR и
  текст plugin — английские.

## Порядок

ADR-0074 и термин User personalization — этот PR. Первым — 01: пока правила о русском не перенесены к
владельцу, 02 удалил бы их из plugin без замены. 02 — после 01: общие файлы `harness/agents/*.md` и
`harness/hooks/rules/common.md`. 03–06 — после срезов `worfy-windows` 14 о test-ах скриптов Harness (Q14) и
после 02: 02 переписывает те же тексты skills и agents. 04 — после 03: оба правят `epic-wave` и
`overnight-fix-loop`. 06 — после 01: оба правят `harness/bin/profile` и `harness/profiles/README.md`. 07 —
последним, после 03–06: тогда правилу lint не нужны исключения для протокола. 08 — после следующего
релиза и после 07.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `harness/hooks/inject-rules.mjs`, `harness/hooks/rules/common.md`, `harness/agents/implementer.md`, `harness/agents/reviewer.md`, `harness/agents/scout.md`, `harness/bin/profile`, `harness/profiles/README.md`, `harness/profiles/draft.schema.json`, `harness/hooks/tests/rules-hooks.test.sh`, `harness/bin/tests/profile.test.sh`, `harness/bin/tests/agents-text.test.sh` | 1 |
| 02 | `harness/README.md`, `harness/agents/*.md`, `harness/hooks/rules/*.md`, `harness/skills/*/SKILL.md`, `harness/bin/*`, `harness/hooks/*.mjs`, `harness/hooks/*.sh`, `harness/profiles/README.md`, `harness/evals/**`, `harness/bin/tests/*.test.sh`, `harness/hooks/tests/*.test.sh`, `harness/bin/tests/plugin-neutral.test.sh` | 2 |
| 03 | `harness/hooks/rules/orchestrator.md`, `harness/skills/epic-wave/SKILL.md`, `harness/skills/continuous-audit/SKILL.md`, `harness/skills/overnight-fix-loop/SKILL.md`, `harness/evals/status-block/**`, `harness/hooks/tests/rules-hooks.test.sh`, `harness/bin/tests/epic-wave-ship-ticket.test.sh`, `src/shared/agent/status-block.ts`, `test/unit/status-block.test.ts` | 3 |
| 04 | `harness/hooks/gate.mjs`, `harness/hooks/gate.sh`, `harness/hooks/gate-resolve.mjs`, `harness/bin/wave-gate`, `harness/bin/ticket`, `harness/bin/epic-status`, `harness/bin/silent-check`, `harness/bin/lib/input-words.json`, `harness/hooks/session-start.mjs`, `harness/hooks/rules/common.md`, `harness/agents/implementer.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/skills/epic-wave/SKILL.md`, `harness/skills/overnight-fix-loop/SKILL.md`, `harness/hooks/tests/*.test.sh`, `harness/bin/tests/*.test.sh`, `src/main/gate/state.ts`, `test/unit/gate-state.test.ts` | 4 |
| 05 | `src/main/autopilot/limits-wait.ts`, `src/main/autopilot/run.ts`, `src/shared/projects/action-templates.ts`, `test/contract/autopilot-limits.test.ts`, `test/unit/autopilot-run.test.ts`, `test/unit/action-templates.test.ts` | 3 |
| 06 | `harness/bin/profile`, `harness/profiles/README.md`, `harness/profiles/draft.schema.json`, `harness/bin/tests/profile.test.sh`, `scripts/check-handoff.mjs`, `scripts/check-lessons.mjs`, `scripts/doc-headings.json`, `src/main/workflow/reader.ts`, `src/main/workflow/profile.ts`, `src/shared/workflow/manual-checks.ts`, `src/main/docs/watch.ts`, `test/unit/check-handoff.test.ts`, `test/unit/check-lessons.test.ts`, `test/unit/manual-checks.test.ts`, `test/contract/workflow-reader.test.ts`, `test/contract/docs.test.ts` | 3 |
| 07 | `eslint.config.js`, `package.json`, `scripts/check-cyrillic.mjs`, `test/unit/check-cyrillic.test.ts`, `src/**` (комментарии), `scripts/**` (комментарии и сообщения), `test/**` вне `test/fixtures/` (комментарии), `harness/**` (комментарии), `src/main/workflow/waits-notify.ts` | 5 |
| 08 | `src/shared/agent/status-block.ts`, `src/main/gate/state.ts`, `harness/bin/wave-gate`, `harness/bin/profile`, `harness/skills/epic-wave/SKILL.md`, `src/shared/projects/action-templates.ts`, `harness/hooks/session-start.mjs`, `eslint.config.js`, `scripts/check-cyrillic.mjs`, их test-ы и все места с пометкой `remove after the next release (worfy-neutral 08)` | 6 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01.** Блокеров нет.
- **Wave 2 — 02.** `Blocked by: 01`: общие `harness/agents/*.md` и `harness/hooks/rules/common.md`.
- **Wave 3 — 03, 05, 06.** Все ждут срезов `worfy-windows` 14 (`Status: blocked`); 03 — `Blocked by: 02`,
  05 — `Blocked by: —`, 06 — `Blocked by: 01`. Общих файлов нет.
- **Wave 4 — 04.** `Blocked by: 02, 03`: общие с 03 `epic-wave` и `overnight-fix-loop`.
- **Wave 5 — 07.** `Blocked by: 03, 04, 05, 06`.
- **Wave 6 — 08.** `Blocked by: 07` и следующий релиз (`Status: blocked`).

Пересечения проверены правилом `filesOverlap` (`src/shared/workflow/waves.ts`) вручную, по таблице.
Файлы вне репозитория (`user.json`, `user/rules.md` владельца, Profile worfy) в таблицу не входят. Если
исполнителю нужен файл вне своего списка, он дописывает его в «Где в коде» при claim.
