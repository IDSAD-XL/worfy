# 07 — Agents implementer, reviewer и scout по-английски, с путями plugin и префиксом `worfy:`

Type: task
Status: open
Blocked by: 02
Source: решения владельца 2026-10-07, вопросы Q6, Q34, Q2, Q15 и Q32; [ADR-0044](../../../docs/adr/0044-harness-in-english-language-from-profile.md) (Harness на английском, машинные строки), [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) (plugin `worfy`, `${CLAUDE_PLUGIN_ROOT}`), [ADR-0043](../../../docs/adr/0043-qmd-is-part-of-harness.md) (имена инструментов qmd); [spec.md](../spec.md)

Пути Harness ниже — нынешние, в `~/.claude`. После Ticket-а 02 (импорт Harness с историей) те же
файлы лежат в `harness/` по тем же относительным путям, а `~/.claude` заморожен (ADR-0047): правки —
только в `harness/`.

## Что происходит

- Agents — `~/.claude/agents/implementer.md` (157 строк, 17 060 байт), `reviewer.md` (121, 14 786),
  `scout.md` (71, 8 078). Текст и `description` — по-русски.
- Первое действие каждого — Profile: `~/.claude/bin/profile -C <путь>` (`implementer.md:9`,
  `reviewer.md:10`, `scout.md:10`); `description` называет `~/.claude/bin/profile` (`:3` у всех
  трёх). Gate — `bash ~/.claude/hooks/gate.sh fast` (`implementer.md:96`). Подстановку
  `${CLAUDE_PLUGIN_ROOT}` в текст agents обещает документация Claude Code; spike 2026-10-07 проверил
  её только в SKILL.md.
- В plugin имя Subagent-а — `worfy:implementer`, `worfy:reviewer`, `worfy:scout` (ADR-0040); поле
  `name:` во frontmatter (`:2`) остаётся коротким, namespace даёт plugin. Ссылки на skills: skill
  Ticket-а из `workflow.ticket_skill` (`implementer.md:86`), «скилл `ship-ticket`, шаг 8» (`:106`).
- Номера шагов implementer-а (раздел «Порядок», шаги 1–6, `implementer.md:84-123`) названы в
  Profile Atakama: `workflow.implementer_steps` — «шаги 1–6 агента implementer без скилла».
- Машинные строки:
  - `echo "КОД=$?"` — `implementer.md:95-96`, `reviewer.md:94`;
  - слова вердикта Gate «зелено», «ПРОВЕРИТЬ НЕ УДАЛОСЬ», «ничего не прогналось» —
    `implementer.md:99-103`; новый текст задаёт Ticket 09;
  - JSON-отчёт implementer-а с английскими ключами `ticket`, `branch`, `pr`, `worktree`,
    `files_changed`, `commands`, `claims`, `removed`, `not_verified`, `out_of_scope`
    (`implementer.md:124-134`) — его разбирает Orchestrator по skill-у `epic-wave`.
- Agents ссылаются на строки брифа, который пишет skill `epic-wave` (Ticket 06): «Запись в
  ~/.claude» (`implementer.md:74-76`, `reviewer.md:97-99`), «GitHub:» (`implementer.md:77-79`,
  `reviewer.md:99-100`).
- Язык: отчёт — на `language.reports` (`reviewer.md:13`). Раздел «Лексика» (`implementer.md:149-155`,
  `reviewer.md:113`, `scout.md:63`) — правило для отчётов по-русски: рабочие термины латиницей,
  русские метафоры-примеры не писать.
- `tools:` у reviewer и scout — `mcp__qmd__query`, `mcp__qmd__get`, `mcp__qmd__multi_get`,
  `mcp__qmd__status` (`reviewer.md:4`, `scout.md:4`). В plugin инструменты qmd называются
  `mcp__plugin_worfy_qmd__…` (ADR-0043); сервер qmd в plugin появляется в Ticket-е 17.
- `GH_TOKEN=$(gh auth token -u <github.account>)` вручную — `implementer.md:79`, `reviewer.md:100`.
- worfy показывает тип Subagent-а и вердикт ревьюера по первой строке `VERIFIED` / `REJECTED`
  (`src/shared/transcript/subagents.ts:144-146`, `:415`). Префикс `worfy:` в показе — Ticket 10.

## Что делаем

1. **Перевод** (Q6, Q34). Три файла, включая `description`, — по-английски, без потери правил.
   - Номера шагов implementer-а (1–6) и названия разделов по смыслу сохраняются: на шаги ссылается
     Profile Atakama.
   - Язык ответа: пользователю и Orchestrator-у — `language.reports`; команде (коммиты, PR,
     комментарии в коде и ревью) — `language.team`; документы Project — `language.docs`. Поле
     `language.docs` вносит Ticket 11; пока его нет — язык уже написанных документов Project.
   - «Лексика» → английский раздел о терминах: он действует, когда отчёт пишется по-русски.
     Русские примеры метафор в нём остаются.
2. **Пути** (Q1, ADR-0040). `~/.claude/bin/profile` → `${CLAUDE_PLUGIN_ROOT}/bin/profile`, Gate →
   `${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh`, в `description` тоже. Значение поля Profile, которое
   начинается с `~/.claude/bin/` (schema 1), читается как `${CLAUDE_PLUGIN_ROOT}/bin/` и остаток —
   то же правило, что в skills Ticket-а 06. Остаются `~/.claude/projects` (транскрипты) и строка
   брифа о записи в `~/.claude`.
3. **Префикс `worfy:`** (Q2). Skill Ticket-а — `/worfy:ship-ticket`; голое `ship-ticket` в
   `workflow.ticket_skill` (schema 1) значит `/worfy:ship-ticket`. Другие agents — `worfy:…`. Поле
   `name:` не меняется.
4. **Машинные строки** (Q6, ADR-0044).
   - `echo "КОД=$?"` → `echo "EXIT=$?"` (так же в Ticket-ах 05, 06 и 08).
   - Не меняются: ключи JSON-отчёта implementer-а, `VERIFIED` / `REJECTED`, слова вердикта Gate в
     цитатах (их новый текст и правку цитат делает Ticket 09), плейсхолдеры в значениях Profile
     (`<эпик>`, `<NN>`, `<что-ревьюишь>` — контракт Profile, Ticket 11).
5. **Подписи брифа** — те же, что пишет skill `epic-wave` после Ticket-а 06:

   | Было | Стало |
   |---|---|
   | `Репозиторий:` | `Repository:` |
   | `Запись в ~/.claude: разрешена \| запрещена` | `Write to ~/.claude: allowed \| forbidden` |
   | `GitHub:` | `GitHub:` |
   | `GUI-проверки: тебе \| не тебе` | `GUI checks: yours \| not yours` |
   | `Scratchpad:` | `Scratchpad:` |

   Полная таблица — в Ticket-е 06, «Что делаем», пункт 6. Если agents ссылаются на другую строку
   брифа — её английская подпись берётся оттуда.

**Не входит.**
- Имена инструментов qmd в `tools:` (`reviewer.md:4`, `scout.md:4`) — Ticket 17 по таблице плана:
  сервер qmd plugin-а появляется там. ADR-0043 называет Ticket-ы 07 и 17; здесь `tools:` не
  меняется, чтобы agents не ссылались на сервер, которого ещё нет.
- `GH_TOKEN` без ручного `export` — Ticket 18.
- Skills — Ticket-ы 06 и 08. Показ `worfy:` в worfy — Ticket 10.

## Готово, когда

- [ ] В трёх файлах нет `~/.claude/bin`, `~/.claude/hooks`, `$HOME/.claude`; `~/.claude` встречается только как `~/.claude/projects` и в подписи брифа `Write to ~/.claude`. Проверяет `harness/bin/tests/agents-text.test.sh`.
- [ ] Profile — через `${CLAUDE_PLUGIN_ROOT}/bin/profile`, Gate — через `${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh`; правило про значения Profile с `~/.claude/bin/` есть у implementer-а и reviewer-а. Тот же test.
- [ ] `name:` — `implementer`, `reviewer`, `scout`; в `description` нет кириллицы; skill — `/worfy:ship-ticket`, вызовов `/ship-ticket` без `worfy:` нет. Тот же test.
- [ ] Нет `КОД=`; код выхода — `EXIT=$?`. Тот же test.
- [ ] Пример JSON-отчёта implementer-а разбирается `jq` и несёт те же десять ключей, что раньше (список — в test-е). Шаги «1.» … «6.» раздела о порядке работы на месте. Тот же test.
- [ ] Подписи брифа — по таблице пункта 5 «Что делаем». `tools:` у reviewer и scout — прежний список `mcp__qmd__…`. Тот же test.
- [ ] Кириллица — только в разрешённых местах: слова вердикта Gate, плейсхолдеры Profile, русские примеры раздела о терминах. Test держит список разрешённых подстрок, вырезает их и другой кириллицы не находит.
- [ ] (локально) `${CLAUDE_PLUGIN_ROOT}` подставляется в текст agent-а: `claude -p --plugin-dir "$PWD/harness" 'Run the worfy:scout agent with this brief: "Run nothing. Reply with the exact command your instructions give for reading the project profile." Print only its answer.' | grep -cF "$PWD/harness/bin/profile"` — не меньше `1`. Если `0` — это в «Итог» и в HANDOFF, раздел «Ждёт владельца»: запасной вариант (голое имя `profile` из `bin/` plugin в PATH) выбирает владелец.
- [ ] `claude plugin validate harness; echo "EXIT=$?"` — код 0, в выводе нет строк про `agents/` (локально, `claude` из терминала).
- [ ] Ревьюер с линзой «смысл сохранён» (Q34; Orchestrator даёт её явно) сравнил старый и новый текст трёх agents: `gh pr view <N> --json comments --jq '[.comments[].body | select(startswith("VERIFIED"))] | length'` — не меньше `1`.
- [ ] CI на PR зелёный. Перед мержем — `GATE_SCOPE=all bash ~/.claude/hooks/gate.sh full` под замком `/tmp/worfy-e2e.lock`: код 0 и строка `[gate] зелено`.

## Тесты

Сначала падающий test — `harness/bin/tests/agents-text.test.sh`. На базе ветки (после Ticket-а 02) в
agents есть `~/.claude/bin/profile` и `КОД=` — test красный. В «Итог» — как он падал.

- `harness/bin/tests/agents-text.test.sh` (новый) — пункты «Готово, когда» с первого по седьмой.
  Стиль — как у `skill-blocks.test.sh`: bash, `ok` / `FAIL`, код 0 — всё прошло; путь к `harness/` —
  от своего файла. В CI его гоняет job, который завёл Ticket 02 для `harness/bin/tests/`.
- Поведение agents на plugin проверяет первая Wave после перехода (Ticket 16; ADR-0044, пункт 6).

## Где в коде

- `harness/agents/implementer.md` (после Ticket-а 02; исходный `~/.claude/agents/implementer.md`)
- `harness/agents/reviewer.md` (после Ticket-а 02; исходный `~/.claude/agents/reviewer.md`)
- `harness/agents/scout.md` (после Ticket-а 02; исходный `~/.claude/agents/scout.md`)
- `harness/bin/tests/agents-text.test.sh` (новый)

Не меняются: skills (Ticket-ы 06 и 08), скрипты (Ticket 08), код worfy, `~/.claude` (заморожен,
ADR-0047). Общих файлов с Ticket-ами 05, 06 и 08 нет.

## Итог

- **Падающий test** — `harness/bin/tests/agents-text.test.sh` на базе ветки (31bc642): `passed 13, failed 33`,
  код 1. Падали все проверки новых строк: нет `${CLAUDE_PLUGIN_ROOT}/bin/profile` и `…/hooks/gate.sh`, в
  agents есть `~/.claude/bin/profile` и `КОД=`, нет `/worfy:ship-ticket`, пример отчёта не разбирается `jq`
  (`"pr": <N>`), кириллица в `description` и в тексте. После перевода — `passed 46, failed 0`.
- **Мутанты** (копия agents в scratchpad, `AGENTS_DIR`): возврат `~/.claude/hooks/gate.sh`, `КОД=` вместо
  `EXIT=`, удалённый ключ `removed`, пропавший шаг «4.», `mcp__plugin_worfy_qmd__status` в `tools:`,
  `/ship-ticket` без `worfy:`, кириллица в `description` и в тексте, `$HOME/.claude`, `"pr": <N>`, пропавший
  пример «ложная зелень» — test краснеет на каждом.
- **Разделы** сохранены по смыслу и по порядку: «Где работать» → `Where to work`, «Границы» → `Boundaries`,
  «Порядок» → `Order` (шаги 1–6 с прежними номерами), «Отчёт — JSON и ничего больше» → `Report — JSON and
  nothing else`, «Лексика» → `Terms` (действует, когда текст пишется по-русски; русские примеры метафор на
  месте); у scout «Порядок работы» → `Order of work` (шаги 1–7), «Формат ответа» → `Answer format`.
- **Добавлено** к переводу: абзац о языке (`language.reports` / `language.team` / `language.docs`, пока поля
  нет — язык уже написанных документов) у implementer и reviewer; правило «значение Profile с
  `~/.claude/bin/` (schema 1) читается как `${CLAUDE_PLUGIN_ROOT}/bin/`» и строка о плейсхолдерах Profile
  (`<эпик>`, `<ветка>`, `<NN>`, `<что-ревьюишь>` — подставлять, не переводить) у implementer и reviewer;
  подписи брифа `Repository:` / `Worktree:` у первого действия всех трёх agents; `worfy:reviewer` у
  implementer и `worfy:implementer` у reviewer.
- **Кириллица вне списка тикета** — заголовок `## Обязательное чтение исполнителя`: его ищет implementer в
  `rules.md`, и так его называет контракт Profile (`harness/profiles/README.md:189`, `rules.md` Auction и
  Atakama). Перевод сломал бы поиск, заголовок оставлен по-русски с английским пояснением и внесён в список
  разрешённых подстрок test-а. Решено без владельца, подтвердить; заголовок меняет Ticket 11 вместе с
  контрактом Profile.
- **Пример JSON-отчёта** — теперь настоящий JSON в блоке ```json: `"pr": 123` вместо `<N>` (строка ниже
  поясняет: номер PR), `"<epic>/<NN>"` вместо `"<эпик>/<NN>"`. Ключи те же десять.
- **`description` implementer-а** — `parallel: single` в YAML без кавычек не разбирается строгим парсером
  (Ruby `YAML.safe_load`: «mapping values are not allowed», и в исходном файле тоже); теперь «`parallel` set
  to `single`». Frontmatter трёх файлов разбирается.
- **Не проверено локально** (бриф запретил запускать настоящий Claude Code): подстановка
  `${CLAUDE_PLUGIN_ROOT}` в текст agent-а (`claude -p --plugin-dir …`) и `claude plugin validate harness`.
  Оба пункта «Готово, когда» — за владельцем или Orchestrator-ом в песочнице (`HOME` и `CLAUDE_CONFIG_DIR`
  во временной папке).
