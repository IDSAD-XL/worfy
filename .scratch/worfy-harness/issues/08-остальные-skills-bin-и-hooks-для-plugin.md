# 08 — Остальные пять skills, скрипты `bin/` и `hooks/` по-английски; состояние Harness — в `~/.claude/worfy-harness/`

Type: task
Status: done 2026-10-07
PR: #112
Blocked by: 02
Source: решения владельца 2026-10-07, вопросы Q4, Q6, Q34, Q2, Q15 и Q32; [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) (состояние Harness на машине, plugin `worfy`), [ADR-0044](../../../docs/adr/0044-harness-in-english-language-from-profile.md) (Harness на английском, машинные строки), [ADR-0043](../../../docs/adr/0043-qmd-is-part-of-harness.md) (qmd в plugin — граница с Ticket-ом 17); [spec.md](../spec.md)

Пути Harness ниже — нынешние, в `~/.claude`. После Ticket-а 02 (импорт Harness с историей) те же
файлы лежат в `harness/` по тем же относительным путям, а `~/.claude` заморожен (ADR-0047): правки —
только в `harness/`.

## Что происходит

- Пять skills вне цикла Epic/Wave — в `~/.claude/skills/`: `retro` (96 строк; по-английски,
  кириллица в 3 строках), `tickets-to-tasks` (132; по-английски, 2), `qmd` (82; по-русски, 56),
  `continuous-audit` (225; 147), `overnight-fix-loop` (359; 214).
- Пути `~/.claude` в них: `retro/SKILL.md:10`, `:19-21`; `tickets-to-tasks/SKILL.md:15-22`, `:40`,
  `:110`, `:129`; `qmd/SKILL.md:10-11`, `:15`, `:24-28`, `:78`; `continuous-audit/SKILL.md:20-52`,
  `:76`, `:124`, `:183`, `:195-198`; `overnight-fix-loop/SKILL.md:17-22`, `:69`, `:85`, `:154`,
  `:214`, `:303`, `:331`. `echo "КОД=$?"` — `retro:19-20`, `tickets-to-tasks:20`,
  `continuous-audit:26`, `overnight-fix-loop:22`, `:214`. Слова вердикта Gate — `overnight-fix-loop:205-208`.
  Ссылки на skills чужого plugin `/to-tickets` и `/wayfinder` — `tickets-to-tasks:3`, `:8`, `:126`;
  `continuous-audit:198`.
- Скрипты: `bin/profile`, `ticket`, `epic-status`, `preflight`, `worktree-lock`, `epic-board`,
  `qmd-mcp`, `qmd-refresh`, `qmd-sync-main` и словарь `bin/ТИКЕТЫ.md`; `hooks/gate.sh`,
  `gate-resolve.mjs`, `guard.mjs`, `stop.sh`, `session-start.sh`, `session-end.sh`; test-ы
  `bin/tests/` (7 файлов) и `hooks/tests/` (3). Комментарии, справка и сообщения — по-русски (от 7
  строк с кириллицей в `session-end.sh` до 141 в `preflight`). На `ТИКЕТЫ.md` никто не ссылается.
- Соседние скрипты ищутся в `~/.claude`: `ticket:81` (`profile`), `epic-status:53` (`ticket`),
  `epic-board:56`, `:62`, `qmd-sync-main:29`, `qmd-refresh:35`, `session-start.sh:36`,
  `session-end.sh:22` (`profile`), `profile:33`, `gate.sh:38`, `stop.sh:21` (`gate-resolve.mjs`).
  `preflight:42` уже берёт свой каталог. Каждый путь подменяется env: `CLAUDE_PROFILE_BIN`,
  `CLAUDE_TICKET_BIN`, `CLAUDE_GATE_RESOLVE`, `QMD_SYNC_PROFILE_BIN`, `QMD_REFRESH_SYNC` (так делают
  test-ы). Сообщение Stop при красном Gate называет `~/.claude/hooks/gate.sh` (`stop.sh:179`).
- Состояние машины лежит в `~/.claude`: реестр Gate `gate/config.json` (`gate.sh:34`,
  `gate-resolve.mjs:24`, `profile:32`, `qmd-sync-main:40`, сообщения `gate.sh:125`, `preflight:144`),
  маркеры Gate `gate/state/` (`gate.sh:36`, `stop.sh:20`), замки worktree `worktree-sessions/`
  (`worktree-lock:74`), снимок `state/epic-board.html` (`epic-board:31`). Profile-ы —
  `~/.claude/profiles/` (`profile:34`). По Q4 и ADR-0040 (пункт 5) состояние Harness живёт в
  `~/.claude/worfy-harness/`: реестр и маркеры Gate, Profile-ы (`projects/<project>/`, Ticket 11),
  замки worktree.
- Что читают программы:
  - worfy зовёт `epic-status --json [--ref]` (`src/main/workflow/reader.ts:63`) и
    `profile -C --field` с кодами 0/1/2/3/4 (`src/main/workflow/profile.ts:40`);
  - worfy читает `gate/config.json`, маркеры `red-<key>-<tag>` и `unverified-<key>-<tag>`
    (`src/main/gate/state.ts:4-7`, `:44`) и строки `[gate] зелено|красно|ничего не прогналось|ПРОВЕРИТЬ НЕ УДАЛОСЬ`
    (`state.ts:97-103`); новое место и JSON-вердикт worfy читает после Ticket-ов 09 и 12;
  - skills читают последнюю строку `preflight` — `GO` или `BLOCKED: …` (`preflight:12`, `:433-434`)
    и строку `Status:`, которую пишет `ticket` (`ticket:5-8`, `:208-225`);
  - `epic-status` понимает и старые русские значения статуса (`epic-status:86-91`).
- `bin/tests/skill-blocks.test.sh` вырезает bash-блоки из `overnight-fix-loop`, `qmd` и
  `tickets-to-tasks` и ждёт в выводе `КОД=0` / `КОД=4` (`:79`, `:83`).
- qmd-обёртки связаны с внешними файлами: запись MCP qmd в `~/.claude.json`, строка `update:` в
  `~/.config/qmd/index.yml` (`qmd-sync-main:15`), hook `Stop` → `qmd-refresh --quiet`
  (`~/.claude/settings.json:71`). Перенос qmd в plugin — Ticket 17 (ADR-0043).
- `session-start.sh` подмешивает `rules.md` Profile, уроки и карту Epic-а — до 20 000 байт на раздел
  (`CLAUDE_SESSION_SECTION_CAP`, `:19`, `:59`). `rules.md` Atakama — 8 632 байта (подмешивание
  включено только у Atakama). Предел контекста hook-а — 10 000 символов (ADR-0041).

## Что делаем

1. **Перевод** (Q6, Q34). Пять SKILL.md, комментарии, справка (`usage`), сообщения и человеческий
   вывод скриптов и test-ов — по-английски, без потери правил. `bin/ТИКЕТЫ.md` →
   `harness/bin/TICKETS.md`, по-английски (имя — латиницей).
2. **Машинный вывод не меняется** (ADR-0044, пункт 4).
   - Не меняются: `epic-status --json` (поля и коды выхода), строка `Status:` от `ticket`, последняя
     строка `preflight` (`GO` / `BLOCKED: …`), коды выхода `profile` (0–4) и `gate.sh` (0, 2, 3),
     имена маркеров Gate, четыре строки вердикта `[gate] зелено|красно|ничего не прогналось|ПРОВЕРИТЬ НЕ УДАЛОСЬ`.
     Новый текст вердикта и JSON-файл задаёт Ticket 09.
   - Остальные строки `[gate] …` (например, «набор», `gate.sh:283`, `:285`) переводятся: worfy их
     не разбирает.
   - Чтение старых русских значений статуса (`epic-status:86-91`) остаётся.
   - `echo "КОД=$?"` в skills → `echo "EXIT=$?"` (так же в Ticket-ах 05–07); ожидания
     `skill-blocks.test.sh` — вслед за ними.
3. **Свои скрипты — от своего места** (Q1, ADR-0040).
   - Вместо `~/.claude/bin/<скрипт>` и `~/.claude/hooks/<скрипт>` — путь от каталога самого
     скрипта (bash — `dirname` от `realpath "${BASH_SOURCE[0]}"`, node — `path.dirname(fs.realpathSync(__filename))`).
     Hooks могут брать `CLAUDE_PLUGIN_ROOT` из env, если он задан.
   - Env-подмены (`CLAUDE_PROFILE_BIN` и другие из «Что происходит») работают как раньше.
   - Имена файлов не меняются: на них ссылается `harness/hooks/hooks.json` (Ticket 05).
   - Сообщение `stop.sh:179` называет Gate путём plugin, а не `~/.claude/hooks/gate.sh`.
4. **Состояние — в `HARNESS_HOME`** (Q4, ADR-0040, пункт 5).
   - Env `HARNESS_HOME`, по умолчанию `~/.claude/worfy-harness`. Реестр Gate —
     `$HARNESS_HOME/gate/config.json`, маркеры — `$HARNESS_HOME/gate/state/`, замки worktree —
     `$HARNESS_HOME/worktree-sessions/`, снимок `epic-board` — `$HARNESS_HOME/state/epic-board.html`.
   - `CLAUDE_GATE_CONFIG` и `CLAUDE_GATE_STATE` по-прежнему главнее.
   - Каталог Profile-ов здесь не меняется (`~/.claude/profiles`); `$HARNESS_HOME/projects/` — Ticket 11.
     Перенос нынешнего состояния на машине владельца — Ticket 14.
   - **На время перехода:** нет `$HARNESS_HOME/gate/config.json`, а `~/.claude/gate/config.json`
     есть — скрипты читают старый реестр (только чтение). Пишут всегда в `$HARNESS_HOME`; в старые
     места ничего не пишется.
5. **Пять skills** (Q2, ADR-0040).
   - Пути — `${CLAUDE_PLUGIN_ROOT}/bin/…` и `${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh`;
     `F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" --field "$1"; }`.
   - Значение поля Profile, которое начинается с `~/.claude/bin/` (schema 1), читается как
     `${CLAUDE_PLUGIN_ROOT}/bin/` и остаток — то же правило, что в Ticket-ах 06 и 07.
   - Префикс `worfy:` у своих skills и agents: `/worfy:retro`, `worfy:qmd`, `worfy:scout` и т. д.
   - `/to-tickets` и `/wayfinder` — skills чужого plugin (зависимость `mattpocock-skills` объявляет
     Ticket 02). Исполнитель проверяет, под каким именем они доступны (`claude plugin details
     mattpocock-skills` или список skills Session), и пишет полное имя. Таких skills нет — текст не
     меняется, находка — в «Итог».
   - Слова вердикта Gate в цитатах (`overnight-fix-loop:205-208`) — как есть (Ticket 09). Пути к
     Profile-ам (`qmd:15`, `tickets-to-tasks:129`) и `~/.claude/tasks/` (`tickets-to-tasks:40`) —
     как есть.
6. **qmd-обёртки** (`qmd-mcp`, `qmd-refresh`, `qmd-sync-main`) — только перевод, пути к своим
   скриптам и реестр из пункта 4. Установка qmd, `.mcp.json`, запись в `~/.claude.json`,
   `index.yml`, hook `Stop` с `qmd-refresh`, коллекции по Profile — Ticket 17 (ADR-0043).
7. **Test-ы.** Восемь нынешних (5 в `bin/tests`, 3 в `hooks/tests`; столько импортирует Ticket 02) переводятся и идут по новым путям и `HARNESS_HOME` во временной
   папке, не на настоящем `~/.claude`. Новый test — `harness/bin/tests/harness-home.test.sh`.

**Не входит.** Правила `CLAUDE.md`, `inject-rules.sh` и `hooks.json` — Ticket 05. Skills `epic-wave`
и `ship-ticket` — Ticket 06. Agents — Ticket 07. Gate JSON и новый текст вердикта — Ticket 09.
Profile schema 2 и каталог Profile-ов — Ticket 11. worfy читает новые места — Ticket-ы 09 и 12.
Перенос состояния — Ticket 14. qmd — Ticket 17. Silent mode в скриптах — Ticket 22.
Вывод `session-start.sh` у Atakama может быть длиннее 10 000 символов: исполнитель меряет его на
копии Profile Atakama (только чтение `~/.claude/profiles/atakama`) и пишет число в «Итог»; предел
здесь не меняется.

## Готово, когда

- [ ] С `HOME` во временной папке и без `HARNESS_HOME`: `gate.sh fast` в зарегистрированном test-репозитории заводит своё состояние (`cache/`, `stop-blocks/`, маркеры `red-*` / `unverified-*`, `gate.sh:37-40`, `:156-157`) в `$HOME/.claude/worfy-harness/gate/state/`; `worktree-lock claim` — замок в `$HOME/.claude/worfy-harness/worktree-sessions/`; `epic-board` — снимок в `$HOME/.claude/worfy-harness/state/`. Каталоги `$HOME/.claude/gate`, `$HOME/.claude/worktree-sessions`, `$HOME/.claude/state` не появляются. Проверяет `harness/bin/tests/harness-home.test.sh`.
- [ ] `HARNESS_HOME=<папка>` переносит всё это в `<папка>`; `CLAUDE_GATE_CONFIG` и `CLAUDE_GATE_STATE` по-прежнему главнее. Тот же test.
- [ ] Нет `$HARNESS_HOME/gate/config.json`, есть `$HOME/.claude/gate/config.json`: `profile -C <repo> --name` находит Project по старому реестру (код 0), `gate.sh fast` пишет состояние в `$HARNESS_HOME/gate/state/`; файлы под `$HOME/.claude` вне `worfy-harness/` не меняются (список с mtime до и после совпадает). Тот же test.
- [ ] Копия `harness/` в другой папке зовёт соседей из этой копии: подменённый `$HOME/.claude/bin/profile`, который пишет в файл-ловушку, не вызывает никто (`ticket`, `epic-status`, `epic-board`, `session-start.sh`, `session-end.sh`, `qmd-sync-main`). Тот же test.
- [ ] `epic-status --json` на фикстуре Epic-а отдаёт тот же JSON, что версия на базе ветки (test сравнивает вывод двух копий); `ticket claim|done|block` пишет ту же строку `Status:`; `preflight` кончается `GO` или `BLOCKED: …`; коды `profile` 0/1/2/3/4 — те же. `bash harness/bin/tests/profile.test.sh`, `preflight.test.sh`, `tickets-root.test.sh` — код 0.
- [ ] `gate.sh` печатает те же четыре строки вердикта (`[gate] зелено (…)` и другие) с теми же кодами выхода. `bash harness/hooks/tests/gate-notverified.test.sh` и `gate-unregistered.test.sh` — код 0.
- [ ] `skill-blocks.test.sh` проходит на новых SKILL.md под bash и zsh и ждёт `EXIT=` вместо `КОД=`: `bash harness/bin/tests/skill-blocks.test.sh` — код 0.
- [ ] В файлах этого Ticket-а нет `~/.claude/bin`, `~/.claude/hooks`, `$HOME/.claude/bin`, `$HOME/.claude/hooks` и `КОД=`; кириллица — только в разрешённых местах: слова вердикта Gate, старые русские значения статуса в `epic-status`, плейсхолдеры Profile (`<эпик>`…), русские примеры. Test держит список разрешённых подстрок, вырезает их и другой кириллицы не находит. `harness-home.test.sh`.
- [ ] Каждый test-файл из «Где в коде»: `bash <файл>; echo "EXIT=$?"` — код 0. Test-ы, которым нужны живые Auction и Atakama (часть `profile.test.sh` и `skill-blocks.test.sh`), без них печатают `skip`, как сейчас.
- [ ] `claude plugin validate harness; echo "EXIT=$?"` — код 0, в выводе нет строк про пять skills этого Ticket-а (локально, `claude` из терминала). Не проверено: настоящий Claude Code запускать запрещено.
- [x] Ревьюер с линзой «смысл сохранён» (Q34; Orchestrator даёт её явно) сравнил старый и новый текст пяти skills и сообщений скриптов: `gh pr view <N> --json comments --jq '[.comments[].body | select(startswith("VERIFIED"))] | length'` — не меньше `1`. Выполнено: VERIFIED в [PR #112](https://github.com/IDSAD-XL/worfy/pull/112).
- [ ] CI на PR зелёный. Перед мержем — `GATE_SCOPE=all bash ~/.claude/hooks/gate.sh full` под замком `/tmp/worfy-e2e.lock`: код 0 и строка `[gate] зелено`.

## Тесты

Сначала падающий test — `harness/bin/tests/harness-home.test.sh`. На базе ветки (после Ticket-а 02)
`gate.sh` заводит состояние в `$HOME/.claude/gate/state/` — test красный. В «Итог» — как он падал.

- `harness/bin/tests/harness-home.test.sh` (новый) — пункты «Готово, когда» с первого по четвёртый
  и восьмой. Временные `HOME`, `HARNESS_HOME` и test-репозиторий; настоящий `~/.claude` не
  читается и не пишется.
- Нынешние test-ы `harness/bin/tests/` и `harness/hooks/tests/` — переведены, идут по новым путям и
  `HARNESS_HOME`; ожидаемые строки — новые там, где вывод переведён, и прежние там, где вывод —
  машинный (пункт 2 «Что делаем»). Скрипты test-ы находят так, как это настроил Ticket 02 для CI
  (от своего файла); оставшиеся `$HOME/.claude/...` заменяются тем же способом.
- В CI их гоняет job, который завёл Ticket 02 для `harness/bin/tests/` и `harness/hooks/tests/`.

## Где в коде

Skills (после Ticket-а 02; исходные — `~/.claude/skills/<skill>/SKILL.md`):
- `harness/skills/retro/SKILL.md`
- `harness/skills/qmd/SKILL.md`
- `harness/skills/overnight-fix-loop/SKILL.md`
- `harness/skills/continuous-audit/SKILL.md`
- `harness/skills/tickets-to-tasks/SKILL.md`

Скрипты `bin/` (исходные — `~/.claude/bin/<файл>`):
- `harness/bin/profile`
- `harness/bin/ticket`
- `harness/bin/epic-status`
- `harness/bin/preflight`
- `harness/bin/worktree-lock`
- `harness/bin/epic-board`
- `harness/bin/qmd-mcp`
- `harness/bin/qmd-refresh`
- `harness/bin/qmd-sync-main`
- `harness/bin/ТИКЕТЫ.md` — удаляется
- `harness/bin/TICKETS.md` (новый)

Скрипты `hooks/` (исходные — `~/.claude/hooks/<файл>`):
- `harness/hooks/gate.sh`
- `harness/hooks/gate-resolve.mjs`
- `harness/hooks/guard.mjs`
- `harness/hooks/stop.sh`
- `harness/hooks/session-start.sh`
- `harness/hooks/session-end.sh`

Test-ы (исходные — `~/.claude/bin/tests/`, `~/.claude/hooks/tests/`):
- `harness/bin/tests/preflight.test.sh`
- `harness/bin/tests/profile.test.sh`
- `harness/bin/tests/qmd.test.sh`
- `harness/bin/tests/skill-blocks.test.sh`
- `harness/bin/tests/tickets-root.test.sh`
- `harness/bin/tests/harness-home.test.sh` (новый)
- `harness/hooks/tests/gate-notverified.test.sh`
- `harness/hooks/tests/gate-unregistered.test.sh`
- `harness/hooks/tests/session-hooks.test.sh`

Не меняются: `harness/hooks/hooks.json`, `harness/hooks/inject-rules.sh`, `harness/hooks/rules/` и
`harness/hooks/tests/rules-hooks.test.sh` (Ticket 05); skills `epic-wave`, `ship-ticket` и
`harness/bin/tests/epic-wave-ship-ticket.test.sh` (Ticket 06); agents и
`harness/bin/tests/agents-text.test.sh` (Ticket 07); код worfy; `~/.claude` (заморожен, ADR-0047).
Общих файлов с Ticket-ами 05, 06 и 07 нет. Файлов много — исполнитель может раздать группы
(skills, `bin/`, `hooks/`) своим Subagent-ам, но PR один.

## Итог

- **Падающий test** — `harness/bin/tests/harness-home.test.sh` на копии `harness/` с базы ветки (origin/main
  31bc642, `HARNESS_DIR`): 34 FAIL, 8 ok (зелёные — строка `Status:`, коды `profile` 1 и 2 и проверки, которые
  база проходит случайно). `gate.sh` заводил `cache/`, маркеры и `stop-blocks/` в `$HOME/.claude/gate/state/`, `worktree-lock` —
  замок в `$HOME/.claude/worktree-sessions/`, `epic-board` — снимок в `$HOME/.claude/state/`; копия `harness/`
  звала подменённые `$HOME/.claude/bin/profile` и `$HOME/.claude/bin/ticket` (ловушка записала 6 вызовов),
  `epic-status` падал на `$HOME/.claude/bin/ticket: No such file or directory`; старый реестр не читался.
- **Состояние** — `HARNESS_HOME`, по умолчанию `~/.claude/worfy-harness`: реестр и маркеры Gate, замки worktree,
  снимок `epic-board`. Реестр ищут `gate.sh`, `gate-resolve.mjs`, `profile`, `qmd-sync-main`: `CLAUDE_GATE_CONFIG`,
  иначе `$HARNESS_HOME/gate/config.json`, а если его нет и есть `~/.claude/gate/config.json` — старый, только чтение.
- **Соседи** — от настоящего пути своего файла: bash — `realpath "${BASH_SOURCE[0]}"`, zsh — `${0:A:h}`, node —
  `fs.realpathSync(__filename)` / `import.meta.url`. `CLAUDE_PLUGIN_ROOT` скрипты не читают: свой путь и есть
  корень plugin-а и не зависит от env Session. Сообщение `stop.sh` при красном Gate называет `bash <plugin>/hooks/gate.sh fast`.
- **Mutation testing** — 28 мутантов путей и состояния (старые места, без `realpath`, без перехода на старый
  реестр, без приоритета `CLAUDE_GATE_CONFIG`/`HARNESS_HOME`, без правила schema 1 в `preflight`): все краснеют
  `harness-home.test.sh`, кроме одного эквивалентного — `profile` без `realpathSync` (Node сам раскрывает
  symlink главного модуля). Мутант слов `worktree-lock status` краснеет на двух проверках `preflight`.
- **Вывод `session-start.sh` у Atakama** — 7 850 символов `additionalContext` (8 241 байт JSON) на копии
  `~/.claude/profiles/atakama` во временном `HOME`; карты Epic-а в копии нет (`state/active-epic` отсутствует).
  Предел hook-а 10 000 символов не превышен.
- **`claude plugin validate harness`** — не запускался: бриф волны запретил запуск настоящего Claude Code.
- **Решено без владельца, подтверждено владельцем 2026-10-12:**
  - Четыре строки вердикта Gate оставлены целиком, с русским хвостом («(кэш)», «(прошло: …)», причины «node не
    найден», «резолвер … завершился с кодом N», «проект не зарегистрирован в …») — их меняет Ticket 09. В причине
    «не зарегистрирован» теперь настоящий путь реестра (`~/.claude/worfy-harness/gate/config.json` по умолчанию).
    Остальные строки `[gate] …` переведены (`[gate] набор` → `[gate] scope`).
  - `preflight` читает значение `tickets.epic_status` вида `~/.claude/bin/<скрипт>` (schema 1) как своего соседа —
    иначе `preflight` plugin-а звал бы замороженный `~/.claude/bin/epic-status`. То же правило в `tickets-to-tasks`
    для `tasks.tool`; в `continuous-audit` голое имя skill из `workflow.ticket_skill` читается как `worfy:<имя>`.
  - Человеческий вывод переведён и там, где его читает другой скрипт того же plugin-а: стадия `закрыт` → `closed`
    (`epic-status`, `epic-board`, `preflight`), строки `worktree-lock status` (`holds`/`also`, `seen N min ago`,
    `← this`) — `preflight` разбирает новые слова. `epic-status --json`, строка `Status:`, `GO`/`BLOCKED: `,
    коды `profile` и `gate.sh`, имена маркеров — прежние.
  - Заголовки тикета («## Где в коде», «## Что делаем» …) и метки блока статуса («Этап», «Сейчас», «Дальше», «Жду»)
    в шаблонах `continuous-audit` оставлены по-русски: их разбирает worfy (`src/main/workflow/reader.ts:98`,
    `src/shared/agent/status-block.ts:20`).
  - `/to-tickets` и `/wayfinder` — skills plugin-а `mattpocock-skills` 1.2.3 (оба в его `plugin.json`, с
    `disable-model-invocation`): в тексте `/mattpocock-skills:to-tickets` и `/mattpocock-skills:wayfinder`. Голое
    `/to-tickets` осталось там, где цитируется стадия из вывода `epic-status`.
- **Кириллица** — `harness-home.test.sh` держит список разрешённых подстрок: слова и строки вердикта Gate, старые
  значения `Status` и слова-отрицания в `epic-status`, плейсхолдеры Profile (`<эпик>`, `<имя>`, `<каталог пакета>` …),
  заголовки тикета и метки блока статуса, русские примеры запросов `qmd` и фразы-триггеры skills.

**Влито.** [PR #112](https://github.com/IDSAD-XL/worfy/pull/112) → squash-коммит `7e51db3` в `main`. Ревью — VERIFIED с первого круга от двух
ревьюеров: скрипты и смысл пяти skills и сообщений скриптов. Сломанных читателей переведённого вывода нет:
worfy читает только `epic-status --json` и четыре строки вердикта Gate (не менялись); `closed`, `[gate] scope`
и слова `worktree-lock status` читает только `preflight`. Скрипты пишут только под `$HARNESS_HOME`, старый
реестр — только чтение. Перед мержем: rebase на `31bc642`, head `b1f7e31`, `GATE_SCOPE=all gate full` — exit 0,
CI зелёный, `mergeStateStatus` CLEAN.

**Долг.**
- [med, вопрос владельцу] `harness/skills/continuous-audit/SKILL.md:228-229` — фраза исходника о статусах чужих
  тикетов читается двояко; перевод выбрал «не трогать вовсе». В HANDOFF, «Ждёт владельца».
  Подтверждено владельцем 2026-10-12: «не трогать вовсе».
- [low] `harness/bin/tests/harness-home.test.sh:21-22` — если `mktemp` упадёт, `T` станет текущим каталогом, и
  trap на `EXIT` сделает ему `rm -rf`. Тот же шаблон — ещё в восьми test-ах (был до Ticket-а).
- [low] Фильтр `'closed'*` в `harness/bin/preflight:426` не связан test-ом со стадией в `harness/bin/epic-status:214`:
  мутант `closed` → `complete` выживает.
- [low] `harness/hooks/session-end.sh:35-36` по-прежнему пишет `~/.claude/profiles/<p>/state/pending-retro.log`
  (Ticket 11).
- [low] `harness/hooks/session-start.sh:102` предлагает `/retro`, нужно `/worfy:retro`.
- [low] `harness/skills/continuous-audit/SKILL.md:32` называет раздел «new project» переведённым именем, а в
  `harness/profiles/README.md:194` он «## Новый проект».
- [low] Пять skills этого Ticket-а ссылаются на `~/.claude/profiles/README.md`, а skills Ticket-а 06 — на
  `${CLAUDE_PLUGIN_ROOT}/profiles/README.md`.
- `claude plugin validate` — не проверено (пункт «Готово, когда» выше).

### Долги из HANDOFF (2026-10-08)

- [low] `harness/README.md:18` называет `ТИКЕТЫ.md` (теперь `harness/bin/TICKETS.md`); `:34-35` говорит,
  что пути скриптов указывают на `~/.claude` и текст частично русский, — устарело после Ticket-ов 05–08.
- Урок процесса Wave 2 (история): замок на main разбирается не в порядке постановки мержей в очередь.
  На итог это не влияет: каждый мерж заново перебазируется на свежий `main` и гоняет `gate full`.
