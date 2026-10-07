# 11 — Profile schema 2 целиком на машине: `mode`, `language.docs`, `attribution`, `mcp.allowed`, без путей Harness

Type: task
Status: open
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

- [ ] `HOME=$(mktemp -d) bash harness/bin/tests/profile.test.sh` — код 0. Новые случаи — на временных `HARNESS_HOME`, реестре и Profile-ах:
  - Profile schema 2 в `$HARNESS_HOME/projects/demo/` находится: `--name` — `demo`, `--dir` и `--field _resolved.dir` — эта папка, `--field mode` — значение из файла;
  - schema 1 только в `$HOME/.claude/profiles/demo/` — находится; Profile в обоих местах — берётся `$HARNESS_HOME`;
  - schema 2 без `mode` и с `"mode": "other"` — код 1, причина в stderr; schema 1 — `--field mode` печатает `full`;
  - `--field attribution` без поля — `on`; `--field language.docs` без поля — код 4; `--field mcp.allowed` — JSON-список из файла;
  - `--field tickets.status_tool`, `tickets.epic_status`, `numbering.reserve_with`, `workflow.preflight` на schema 2 — пути рядом с `bin/profile`; на schema 1 со значением `~/.claude/bin/ticket` — тот же путь, что на schema 2; `null` в schema 1 — `null`;
  - строка `"language": "ru"` по-прежнему даёт `language.reports` и `language.team`.
- [ ] Тот же test: списки файлов временных `HOME` и `HARNESS_HOME` до и после вызовов `bin/profile` одинаковы.
- [ ] `HOME=$(mktemp -d) bash harness/bin/tests/preflight.test.sh` — код 0; случай «`--epic` у Profile-а без `tickets.epic_status`» (`preflight.test.sh:56-59`) теперь проверяет Epic через `epic-status` Harness-а, а не отвечает BLOCKED.
- [ ] `grep -rlE 'tickets\.status_tool|tickets\.epic_status|workflow\.preflight|numbering\.reserve_with' harness/skills harness/agents harness/bin/preflight` — код 1 (совпадений нет).
- [ ] `` test "$(grep -cE '^\| `(mode|language\.docs|attribution|mcp\.allowed)` ' harness/profiles/README.md)" -eq 4 `` — код 0: четыре новых поля есть в таблице контракта.
- [ ] Ревью с линзой «смысл сохранён» (Q34: ревьюер сравнивает старый русский и новый английский текст `profiles/README.md`) — VERIFIED; расхождения по смыслу, кроме изменений этого Ticket-а, — находки.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0 (`pnpm test` гоняет `harness/bin/tests/*.test.sh` через `test/contract/harness-scripts.test.ts` с пустым `HOME`); CI на PR зелёный.

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

Скрипты и skills — файлы групп Ticket-ов 06 и 08, которые этот Ticket ждёт (Blocked by). Файлы
Ticket-а 05 (части правил для hooks) и `harness/hooks/session-start.sh` не меняются. Общих файлов
с Ticket-ами 09, 10 и 12 нет.

## Итог

Заполняется при закрытии.
