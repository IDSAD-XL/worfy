# 11 — Profile schema 2 целиком на машине: `mode`, `language.docs`, `attribution`, `mcp.allowed`, без путей Harness

Type: task
Status: done — 2026-10-07, [PR #115](https://github.com/IDSAD-XL/worfy/pull/115)
Blocked by: 06, 07, 08
Source: решения владельца 2026-10-07: Q11' и Q10 (Profile целиком на машине, правила Project-а подмешивает только Harness; заменяет ADR-0020), Q11 (поля без путей Harness, schema 1 читается на время перехода, `mcp.allowed` — в контракт, новые поля `mode`, `language.docs`, `attribution`), Q4 (состояние Harness — `~/.claude/worfy-harness/`), Q6 (`language.docs`), Q23 и Q28 (`mode`: Full mode и Silent mode), Q25 (`attribution`); [ADR-0042](../../../docs/adr/0042-profile-on-machine-full-and-silent-modes.md) (Profile на машине, Full mode и Silent mode); [ADR-0044](../../../docs/adr/0044-harness-in-english-language-from-profile.md) (Harness на английском, язык документов из Profile); [ADR-0021](../../../docs/adr/0021-mcp-servers-allowlist-in-profile.md) (список MCP-серверов агентов в Profile); [spec.md](../spec.md)

## Что происходит

- Profile (описание Project-а для Harness) лежит в `~/.claude/profiles/<имя>/`: `profile.json`,
  `rules.md`, у Atakama ещё `lessons/`, `state/`, `bin/`. Читает его один скрипт — `bin/profile`:
  пути к реестру Gate, резолверу и папке Profile-ов — `~/.claude/bin/profile:31-34`. После
  Ticket-а 02 (импорт Harness в репозиторий) это `harness/bin/profile`; Ticket 08 (перевод и пути
  `bin/`) переводит пути по умолчанию на `HARNESS_HOME`.
- Контракт полей — `~/.claude/profiles/README.md`, по-русски; Ticket 02 переносит его в
  `harness/profiles/README.md`. Место Profile-а — `README.md:20-35`, поле `schema` — `1` (`:88`).
- Четыре поля — пути к самому Harness, а не факты Project-а (Q11): `tickets.status_tool`
  (`README.md:116`), `tickets.epic_status` (`:117`), `workflow.preflight` (`:120`),
  `numbering.reserve_with` (`:125`). У worfy и Auction в них `~/.claude/bin/…`
  (`workflow.preflight` — `~/.claude/bin/preflight --epic <эпик>`), у Atakama
  `workflow.preflight` и `numbering.reserve_with` — `null`. Их читают:
  - skills epic-wave и ship-ticket (`~/.claude/skills/epic-wave/SKILL.md:55-56`, `:335-336`;
    `~/.claude/skills/ship-ticket/SKILL.md:52-53`, `:72`, `:284`) — после Ticket-а 06 (перевод
    этих skills) какие из чтений остались, исполнитель проверяет поиском;
  - `bin/preflight` (`~/.claude/bin/preflight:155` — `tickets.epic_status`; без него
    `preflight --epic` отвечает BLOCKED, `:394`; test — `bin/tests/preflight.test.sh:56-59`);
  - общие правила (`~/.claude/CLAUDE.md:221`, `:228`; после Ticket-а 02 — `harness/rules/global.md`,
    после Ticket-а 05 — части правил для hooks `SessionStart` и `SubagentStart`).
- Поля `mcp.allowed` (список MCP-серверов агентов, ADR-0021) в контракте нет, хотя worfy его уже
  читает (`src/main/workflow/profile.ts:21-26`; без поля — `qmd` и `worfy-canvas`). Полей `mode`,
  `language.docs`, `attribution` нет нигде.
- Старая строковая форма `"language": "ru"` разворачивается в `{reports, team}`
  (`~/.claude/bin/profile:221-223`).
- `rules.md` Project-а подмешивает hook `session-start.sh` из папки `_resolved.dir`, которую
  печатает `bin/profile` (`~/.claude/hooks/session-start.sh:43-51`, `:82-85`).

## Что делаем

1. **Где лежит** (Q11', Q10, Q4). Profile — `$HARNESS_HOME/projects/<имя>/` (по умолчанию
   `~/.claude/worfy-harness/projects/<имя>/`): `profile.json`, `rules.md` и необязательные
   `lessons/`, `epics/`, `state/`, `bin/` — тот же состав, что сейчас в `~/.claude/profiles/<имя>/`.
   В репозитории Project-а Profile-а нет, PR с Profile-ом нет. `rules.md` подмешивает только
   Harness (через `_resolved.dir`), не `.claude/rules/` репозитория.
2. **Как находится.** Реестр Gate — там, где его ищет `harness/bin/profile` после Ticket-а 08;
   поле `profile` записи → `$HARNESS_HOME/projects/<имя>/profile.json`. Нет там — на время
   перехода `~/.claude/profiles/<имя>/profile.json` (schema 1, Q11). Есть в обоих местах —
   берётся `$HARNESS_HOME`. `CLAUDE_PROFILES_DIR` (для test-ов) перекрывает оба места. Флаги, коды
   выхода и `_resolved` — без изменений; `_resolved.dir` — папка, где Profile найден.
3. **schema 2** — `"schema": 2` и поля:
   - `mode` — `"full"` | `"silent"` (Q23, Q28): Full mode — файлы workflow (Ticket-ы, spec Epic-а,
     HANDOFF, ADR, уроки) в репозитории; Silent mode — вне git, в Workflow folder. В schema 2
     поле обязательно: нет поля или другое значение — код 1 с причиной в stderr («сломан
     Profile»), потому что угаданный режим тихо положил бы файлы workflow не туда. В schema 1 поля
     нет, `--field mode` печатает `full`: до режимов весь Harness работал как Full mode.
   - `language.docs` — `"ru"` | `"en"` (Q6): язык документов Project-а — Ticket-ы, spec, ADR,
     HANDOFF, уроки. Нет поля — код 4; читатели держатся старого правила из строки
     `language.team` контракта (язык соседних документов).
   - `attribution` — `"on"` | `"off"` (Q25): строки атрибуции Claude в коммитах и PR. Нет поля —
     `--field attribution` печатает `on`.
   - `mcp.allowed` — список имён MCP-серверов (ADR-0021); нет поля — worfy берёт `qmd` и
     `worfy-canvas`.

   Здесь — контракт и чтение. Поведение по полям — другие Ticket-ы: Silent mode, `attribution` и
   поле пути Workflow folder — Ticket 22 (Silent mode в Harness); форма подключения Project-а,
   которая пишет `mode` (по умолчанию Silent, Q28), — Ticket 24.
4. **Четыре поля-пути уходят** (Q11).
   - В schema 2 их нет в файле и в таблице контракта; если в файле они есть — `bin/profile` их не
     берёт.
   - Чтобы не сломать читателя, который ещё спрашивает поле, `bin/profile --field` на него
     отвечает путём своего Harness — папкой, где лежит сам `bin/profile`: `<bin>/ticket`,
     `<bin>/epic-status`, `<bin>/preflight`, а `workflow.preflight` — `<bin>/preflight --epic` и
     плейсхолдер Epic-а, который подставляют skills после Ticket-а 06.
   - В schema 1 значение `~/.claude/bin/<скрипт>` заменяется тем же путём своего Harness: после
     перехода машины владельца (Ticket 16) в `~/.claude/bin/` Harness-а нет. `null` остаётся
     `null`.
   - У Atakama сейчас `workflow.preflight: null`. В schema 2 этого выбора в Profile нет (Q11):
     preflight Harness один для всех Project-ов.
   - Читатели в файлах этого Ticket-а переходят на константы Harness: `harness/bin/preflight`
     берёт `epic-status` рядом с собой, а не из Profile; skills epic-wave и ship-ticket зовут
     `ticket`, `epic-status` и `preflight` из `${CLAUDE_PLUGIN_ROOT}/bin/`, если Ticket 06 этого
     ещё не сделал.
   - Части правил Ticket-а 05 этот Ticket не правит: Ticket 05 не в Blocked by, а правила и так
     работают через ответ `bin/profile`. Если в них остались имена четырёх полей — строка в
     «Итог».
5. **Контракт** — `harness/profiles/README.md`, по-английски (Q6: Harness переводится в тех же
   Ticket-ах, что его переписывают): место (пункт 1), поиск (пункт 2), таблица schema 2 с `mode`,
   `language.docs`, `attribution`, `mcp.allowed` и без четырёх полей-путей; раздел о schema 1 —
   что читается на время перехода и как (пункты 2–4). Где сейчас `~/.claude/…`, — пути от
   plugin-а Harness или от `HARNESS_HOME`. Раздел «New project» говорит, что Profile пишется на
   машине (`$HARNESS_HOME/projects/<имя>/`), а не в репозиторий.
6. **Ничего не пишет.** `bin/profile` только читает.

ADR не нужен: решения приняты в ADR-0042 (Profile на машине, режимы) и ADR-0044 (язык); этот
Ticket их выполняет для контракта и `bin/profile`.

**Не входит:** перенос Profile-ов worfy, Auction и Atakama в schema 2 и в `$HARNESS_HOME` —
Ticket 14 (перенос); где worfy ищет `bin/profile` — Ticket 12; поведение Silent mode — Ticket 22;
коллекции qmd по Profile — Ticket 17.

## Готово, когда

- [x] `HOME=$(mktemp -d) bash harness/bin/tests/profile.test.sh` — код 0. Новые случаи — на временных `HARNESS_HOME`, реестре и Profile-ах:
  - Profile schema 2 в `$HARNESS_HOME/projects/demo/` находится: `--name` — `demo`, `--dir` и `--field _resolved.dir` — эта папка, `--field mode` — значение из файла;
  - schema 1 только в `$HOME/.claude/profiles/demo/` — находится; Profile в обоих местах — берётся `$HARNESS_HOME`;
  - schema 2 без `mode` и с `"mode": "other"` — код 1, причина в stderr; schema 1 — `--field mode` печатает `full`;
  - `--field attribution` без поля — `on`; `--field language.docs` без поля — код 4; `--field mcp.allowed` — JSON-список из файла;
  - `--field tickets.status_tool`, `tickets.epic_status`, `numbering.reserve_with`, `workflow.preflight` на schema 2 — пути рядом с `bin/profile`; на schema 1 со значением `~/.claude/bin/ticket` — тот же путь, что на schema 2; `null` в schema 1 — `null`;
  - строка `"language": "ru"` по-прежнему даёт `language.reports` и `language.team`.
- [x] Тот же test: списки файлов временных `HOME` и `HARNESS_HOME` до и после вызовов `bin/profile` одинаковы.
- [x] `HOME=$(mktemp -d) bash harness/bin/tests/preflight.test.sh` — код 0; случай «`--epic` у Profile-а без `tickets.epic_status`» (`preflight.test.sh:56-59`) теперь проверяет Epic через `epic-status` Harness-а, а не отвечает BLOCKED.
- [x] `grep -rlE 'tickets\.status_tool|tickets\.epic_status|workflow\.preflight|numbering\.reserve_with' harness/skills harness/agents harness/bin/preflight` — код 1 (совпадений нет).
- [x] `` test "$(grep -cE '^\| `(mode|language\.docs|attribution|mcp\.allowed)` ' harness/profiles/README.md)" -eq 4 `` — код 0: четыре новых поля есть в таблице контракта.
- [x] Ревью с линзой «смысл сохранён» (Q34: ревьюер сравнивает старый русский и новый английский текст `profiles/README.md`) — VERIFIED; расхождения по смыслу, кроме изменений этого Ticket-а, — находки.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0 (`pnpm test` гоняет `harness/bin/tests/*.test.sh` через `test/contract/harness-scripts.test.ts` с пустым `HOME`); CI на PR зелёный.

## Тесты

Сначала падающий test — `harness/bin/tests/profile.test.sh`, случай «Profile schema 2 в
`$HARNESS_HOME/projects/demo/` находится». На нынешнем main `bin/profile` ищет Profile-ы только в
одной папке (`~/.claude/profiles/` или `CLAUDE_PROFILES_DIR`) — код 3, test красный. В «Итог» —
как он падал.

- `harness/bin/tests/profile.test.sh` — новые случаи на временных папках; случаи «живого
  реестра» (Auction) остаются под проверкой `[ -d … ]` и в CI пропускаются, как сейчас.
- `harness/bin/tests/preflight.test.sh` — `--epic` без поля в Profile.

## Где в коде

- `harness/bin/profile` (из `~/.claude/bin/profile`)
- `harness/bin/tests/profile.test.sh` (из `~/.claude/bin/tests/profile.test.sh`)
- `harness/bin/preflight` (из `~/.claude/bin/preflight`)
- `harness/bin/tests/preflight.test.sh` (из `~/.claude/bin/tests/preflight.test.sh`)
- `harness/profiles/README.md` (из `~/.claude/profiles/README.md`)
- `harness/skills/epic-wave/SKILL.md` (из `~/.claude/skills/epic-wave/SKILL.md`) — только строки с четырьмя полями-путями, если Ticket 06 их оставил
- `harness/skills/ship-ticket/SKILL.md` (из `~/.claude/skills/ship-ticket/SKILL.md`) — то же
- `harness/agents/implementer.md` — только строка 23 (пример правила о значениях schema 1 называл
  поле `tickets.status_tool`): правка вне следа, разрешённая оркестратором 2026-10-07, — без неё
  проверка `grep … harness/agents` из «Готово, когда» не проходит

Скрипты и skills — файлы групп Ticket-ов 06 и 08, которые этот Ticket ждёт (Blocked by). Файлы
Ticket-а 05 (части правил для hooks) и `harness/hooks/session-start.sh` не меняются. Общих файлов
с Ticket-ами 09, 10 и 12 нет.

## Итог

- Красный test первым: новый случай `profile.test.sh` «Profile schema 2 в `$HARNESS_HOME/projects/demo/`
  находится» на main падал с кодом 3 — `project "demo" names profile "demo", but
  <HOME>/.claude/profiles/demo/profile.json does not exist`: `bin/profile` искал Profile-ы только
  в `~/.claude/profiles/`. Из 36 новых случаев на main краснели 28 (зелёные 8 — то, что main уже умел: schema 1 в старом месте, строка `language`, `null`, код 4, «ничего не пишет»). Новый `preflight.test.sh`
  на `preflight` с main — 4 красных из 8 (`--epic` без `tickets.epic_status` давал BLOCKED).
  Круг доработки 1 добавил случаи: 3 в `preflight.test.sh` (основная ветка `master`,
  `worktree.base: null`) и 3 в `profile.test.sh` (форма `$HOME/.claude/bin/`, `profile.json`, который
  не объект). Каждый краснеет на мутанте, убирающем свою ветку кода.
- `harness/bin/profile`: поиск `$HARNESS_HOME/projects/<имя>/`, потом `~/.claude/profiles/<имя>/`;
  `CLAUDE_PROFILES_DIR` перекрывает оба; `_resolved.dir` — папка, где Profile найден. schema 2 без
  `mode` или с другим значением — код 1. `schema`, отличная от 1 и 2, — тоже код 1 (решено без
  владельца, подтверждено владельцем 2026-10-12: чтение неизвестной схемы как schema 1 угадывало бы поля); без поля
  `schema` — читается как schema 1. Четыре поля-пути в `--field` и `--json` — скрипты рядом с
  `bin/profile`; в schema 1 подменяется и абсолютная форма `$HOME/.claude/bin/…`, не только `~/…`.
  Сводка без флагов печатает тот же нормализованный Profile (с `mode`, `attribution` и путями
  своего Harness), что и `--json`.
- `harness/bin/preflight` берёт `epic-status` рядом с собой; ветка «нет сводки Epic-а в Profile»
  убрана. Минимальный предполёт skills остаётся только для случая, когда `preflight` не
  запускается (код 2: не git, например общий каталог Atakama над тремя репозиториями). Прежний
  путь Atakama (`workflow.preflight: null` — минимальный предполёт в каждом репозитории) не
  сохранён: её репозитории теперь идут через `preflight` Harness-а. Поэтому при `worktree.base: null`
  `preflight` больше не подставляет `origin/main` вслепую. Порядок такой: `origin/<default_branch>`
  этого репозитория из `layout.repos`, затем ветка, на которую указывает `origin/HEAD`, затем
  `origin/main`. Иначе Atakama-Browser-Extension и Atakama-Browser-Server (основная ветка
  `master`) вставали на «BLOCKED: no ref origin/main» — находка ревью, круг доработки 1.
  Проверено на клонах трёх репозиториев Atakama во временном каталоге: `preflight` первого круга —
  код 1 «BLOCKED: no ref origin/main», нынешний — код 0, база `origin/master`, `GO`.
- Skills epic-wave и ship-ticket зовут `ticket`, `epic-status`, `preflight` из
  `${CLAUDE_PLUGIN_ROOT}/bin/`; правило о значениях `~/.claude/bin/` (schema 1) оставлено — его
  требует `epic-wave-ship-ticket.test.sh`.
- Части правил Ticket-а 05 (`harness/hooks/rules/`) имён четырёх полей не содержат — правки не нужно.
- Проверка на копиях живых Profile-ов worfy, Auction и Atakama (schema 1, во временном `HOME`):
  `--json` старого и нового `bin/profile` различаются только четырьмя путями (стали путями своего
  Harness; `null` у Atakama остался `null`) и добавленными `mode: full`, `attribution: on`.
- Вне Ticket-а: `src/main/workflow/profile.ts:4` в комментарии всё ещё называет место Profile-а
  `<claude home>/profiles/<имя>/` — это Ticket 12.

**Влито.** [PR #115](https://github.com/IDSAD-XL/worfy/pull/115) → squash-коммит `f3fc9e1` в `main`. Ревью —
REJECTED → VERIFIED, один круг доработки. В первом круге Atakama вставала на предполёте: `preflight`
подставлял `origin/main`, а Atakama-Browser-Extension и Atakama-Browser-Server на `master` — «BLOCKED: no ref
origin/main». Исправлено выбором базы: `layout.repos` → `origin/HEAD` → `origin/main` (`preflight:156`,
`:172-175`). Ревьюер проверил на клонах трёх репозиториев Atakama — `GO` с базами `origin/master`,
`origin/master`, `origin/main`; вывод для worfy и Auction побайтно тот же. Там же закрыты три находки [low]:
непроверенные ветки `bin/profile` (форма `$HOME/.claude/bin/`, `profile.json`, который не объект) и README.
Проверка «смысл сохранён» по `harness/profiles/README.md`: все правила старого текста на месте. Прогоны во
втором круге: `preflight.test.sh` 11/11, `profile.test.sh` зелёный, три мутанта красные, `gate fast` exit 0.
Перед мержем: rebase на `8b9eacb`, head `a59e95c`, `GATE_SCOPE=all gate full` — exit 0, CI зелёный,
`mergeStateStatus` CLEAN. Правка одной строки `harness/agents/implementer.md:23` — вне следа Ticket-а,
разрешена оркестратором.

**Долг.**
- [low] `harness/bin/preflight:173` — если репозитория нет в `layout.repos`, а `origin/HEAD` указывает на рабочую
  ветку, `preflight` молча берёт её базой. Ревьюер воспроизвёл на клоне Server без `layout.repos`: база
  `origin/feat/BPD-7741`, `GO`. Клон с GitHub ставит `origin/HEAD` на ветку по умолчанию, поэтому риск низкий.
  Идея правки: брать `origin/HEAD`, только если есть такая же локальная ветка, иначе предупреждать.
- Решения без владельца — порядок выбора базы (`layout.repos` раньше `origin/HEAD`) и правка
  `implementer.md:23` вне следа — в HANDOFF, «Ждёт владельца». Подтверждено владельцем 2026-10-12.

### Долги из HANDOFF (2026-10-08)

- [med] `harness/bin/tests/preflight.test.sh` не ставит `HOME` и `HARNESS_HOME` во временный каталог (сам
  создаёт только каталог `mktemp`, `:16`). Запущенный с настоящим `HOME`, он через `worktree-lock` пишет
  замки в настоящий `~/.claude/worfy-harness/worktree-sessions/`. Так 2026-10-07 в 19:01–19:02 появились
  17 файлов: 16 от временных каталогов test-ов (`private-var-folders-…-T-tmp-…`), один от уже удалённого
  worktree `h11`. Это нарушение запрета писать в `~/.claude`; его не поймали ни исполнитель, ни ревьюер.
  Правка: test сам ставит `HOME` и `HARNESS_HOME` в `mktemp -d`, не полагаясь на вызов
  `HOME=$(mktemp -d) bash …`. Кандидат в Ticket.
- Вопрос владельцу: удалить ли `~/.claude/worfy-harness/worktree-sessions/`. Других файлов в
  `~/.claude/worfy-harness/` 2026-10-07 не было; агенты папку не трогали. После перехода на plugin
  (Ticket 16) это живая папка `HARNESS_HOME`, и мусорные замки окажутся в ней.
