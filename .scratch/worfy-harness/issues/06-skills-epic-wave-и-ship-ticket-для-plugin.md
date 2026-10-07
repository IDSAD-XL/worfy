# 06 — Skills `epic-wave` и `ship-ticket` по-английски, с путями plugin, префиксом `worfy:` и новой командой Autopilot

Type: task
Status: done — 2026-10-07, [PR #110](https://github.com/IDSAD-XL/worfy/pull/110)
Blocked by: 02
Source: решения владельца 2026-10-07, вопросы Q6, Q34, Q2, Q11 и Q32; [ADR-0044](../../../docs/adr/0044-harness-in-english-language-from-profile.md) (Harness на английском; формат команды Autopilot задаёт этот Ticket), [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) (plugin `worfy`, `${CLAUDE_PLUGIN_ROOT}`), [ADR-0033](../../../docs/adr/0033-autopilot-names-wave-tickets.md) (Autopilot называет Ticket-ы Wave); [spec.md](../spec.md)

Пути Harness ниже — нынешние, в `~/.claude`. После Ticket-а 02 (импорт Harness с историей) те же
файлы лежат в `harness/` по тем же относительным путям, а `~/.claude` заморожен (ADR-0047): правки —
только в `harness/`.

## Что происходит

- Skills — `~/.claude/skills/epic-wave/SKILL.md` (392 строки, 37 021 байт) и
  `~/.claude/skills/ship-ticket/SKILL.md` (299 строк, 25 686 байт). Текст по-русски; `description`
  у `ship-ticket` уже английский (`ship-ticket/SKILL.md:3`), у `epic-wave` — русский
  (`epic-wave/SKILL.md:3`).
- Скрипты Harness вызываются по пути `~/.claude/...`:
  - `F <поле>` — `~/.claude/bin/profile -C <repo> --field <поле>` (`epic-wave:12`, `ship-ticket:14`);
    `profile --name` (`epic-wave:17`, `ship-ticket:19`), `--rules` (`epic-wave:50`, `ship-ticket:47`);
  - Gate — `bash ~/.claude/hooks/gate.sh fast` (`epic-wave:184`, `ship-ticket:149`);
  - `~/.claude/bin/epic-board` (`epic-wave:377`);
  - контракт Profile — `~/.claude/profiles/README.md` (`epic-wave:11`, `:23`; `ship-ticket:12`, `:25`).

  В plugin эти пути — `${CLAUDE_PLUGIN_ROOT}/…`. Spike 2026-10-07 подтвердил: Claude Code
  подставляет `${CLAUDE_PLUGIN_ROOT}` в текст SKILL.md.
- Пути Harness приходят и из значений Profile: `tickets.status_tool` = `~/.claude/bin/ticket`,
  `tickets.epic_status` = `~/.claude/bin/epic-status`, `workflow.preflight` =
  `~/.claude/bin/preflight --epic <эпик>`, `numbering.reserve_with` = `~/.claude/bin/preflight`
  (`~/.claude/profiles/worfy/profile.json`, так же у Auction; у Atakama `preflight` и `reserve_with`
  — `null`). По Q11 это константы Harness; поля из Profile убирает Ticket 11.
- `~/.claude` в тексте бывает и законно: Claude Code пишет транскрипты в `~/.claude/projects`, бриф
  несёт строку «Запись в ~/.claude» (`epic-wave:151`, `:157-164`).
- Agents названы голыми именами: `scout` (`epic-wave:96`), `implementer` (`:128`), `reviewer`
  (`:172`, `:209`, `:248`; `ship-ticket:179`). В plugin это `worfy:scout`, `worfy:implementer`,
  `worfy:reviewer`. Skill из plugin вызывается только с префиксом: `/worfy:epic-wave`, голое
  `/epic-wave` не работает (spike, ADR-0040). Profile называет skill Ticket-а голым именем:
  `workflow.ticket_skill` = `ship-ticket`.
- Команда Autopilot. worfy шлёт `/epic-wave Ticket-ы {tickets} эпика {epic}`
  (`src/shared/projects/action-templates.ts:34`), `{tickets}` — номера через запятую с пробелом,
  например `11, 23, 25` (`src/shared/actions/render-template.ts:13`). Прежний шаблон —
  `/epic-wave волна {wave} эпика {epic}` (`action-templates.ts:38`). Skill узнаёт обе формы и
  английскую «run wave N of epic X» (`epic-wave:3`, `:80-86`).
- Машинные строки:
  - `echo "КОД=$?"` — `epic-wave:17`, `:184`; `ship-ticket:19`, `:72`, `:139`, `:149`, `:239`, `:272`;
  - слова вердикта Gate `[gate] зелено (…)`, «ничего не прогналось», `[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ`
    — `epic-wave:189-191`, `ship-ticket:152-154`; новый текст задаёт Ticket 09;
  - вердикт ревью `VERIFIED` / `REJECTED` и коммит `gate: VERIFIED` — `epic-wave:213-230`; уже
    английские, их читает worfy (`src/shared/transcript/subagents.ts:415`,
    `src/shared/ipc/checks.ts:62-63`).
- Шаблон брифа исполнителю (`epic-wave:136-153`) подписан по-русски: «Цель», «Репозиторий», «Тикет»,
  «Дерево», «База», «След по файлам», «Номера», «Следы соседей по волне», «Scratchpad», «Запись в
  ~/.claude», «GitHub:», «GUI-проверки». Agents (Ticket 07) ссылаются на эти строки:
  `~/.claude/agents/implementer.md:74-79`, `reviewer.md:97-100`.
- На номера разделов skills ссылаются снаружи: «скилл `ship-ticket`, шаг 8»
  (`~/.claude/agents/implementer.md:106`); `workflow.implementer_steps` Profile worfy — «шаги 1–8»
  `ship-ticket`.

## Что делаем

1. **Перевод** (Q6, Q34). Оба SKILL.md, включая `description`, — по-английски, без потери правил.
   - Номера разделов (`## 0.` … `## 11.` у `ship-ticket`, `## 0.` … `## 5.` у `epic-wave`) и шагов
     не меняются: на них ссылаются agents и Profile.
   - Язык того, что агент пишет по skill-у: пользователю — `language.reports`, команде —
     `language.team`, документы Project — `language.docs`. Поле `language.docs` вносит Ticket 11;
     пока его нет — язык уже написанных документов Project.
   - Названия разделов документов Project («## Где в коде», «## Итог», «Ждёт владельца» в HANDOFF)
     принадлежат Project, а не Harness. Skill их не переводит: берёт из Profile, где поле есть
     (`tickets.trail_section`), иначе называет по смыслу и даёт имя из worfy примером.
2. **Пути** (Q1, ADR-0040).
   - `~/.claude/bin/<скрипт>` → `${CLAUDE_PLUGIN_ROOT}/bin/<скрипт>`; `~/.claude/hooks/gate.sh` →
     `${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh`; `F` — `"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field <поле>`.
   - Контракт Profile — `${CLAUDE_PLUGIN_ROOT}/profiles/README.md`, если Ticket 02 положил его в
     `harness/profiles/` (проверить: `ls harness/profiles`). Иначе ссылка остаётся, причина — в «Итог».
   - Значение поля Profile, которое начинается с `~/.claude/bin/` (schema 1), skill читает как
     `${CLAUDE_PLUGIN_ROOT}/bin/` и остаток: старые Profile-ы ведут в замороженный `~/.claude`.
     Поле `null` или код 4 — шаг пропускается и называется словами, как сейчас.
   - Остаются: `~/.claude/projects` (транскрипты) и строка брифа о записи в `~/.claude`.
3. **Префикс `worfy:`** (Q2). Subagent-ы — `worfy:implementer`, `worfy:reviewer`, `worfy:scout`
   (и тип в вызове Agent, и текст); skills — `/worfy:ship-ticket`, `/worfy:epic-wave`, `worfy:qmd`,
   `/worfy:retro`. Голое `ship-ticket` в `workflow.ticket_skill` (schema 1) значит `/worfy:ship-ticket`.
4. **Новая команда Autopilot** (Q6; ADR-0044, пункт 4 — формат задаёт этот Ticket).
   - Формат: `/worfy:epic-wave tickets {tickets} of epic {epic}`, например
     `/worfy:epic-wave tickets 05, 06, 07, 08 of epic worfy-harness`. Номера — как их пишет
     `render-template.ts:13`.
   - Skill по-прежнему узнаёт старые формы: «Ticket-ы NN, NN эпика X» (ADR-0033), «волна N эпика
     X», «run wave N of epic X». Они остаются в старых транскриптах и в сохранённых шаблонах
     Project-ов.
   - `description` называет новую форму первой, старые — явно.
   - Этот же текст разбирает worfy (Ticket 10) и шлёт по шаблону (Ticket 12). Если Ticket 10 влит
     раньше с другим текстом формата — берётся текст из его кода
     (`src/shared/projects/action-templates.ts`), расхождение — в «Итог».
5. **Машинные строки** (Q6, ADR-0044).
   - `echo "КОД=$?"` → `echo "EXIT=$?"` (так же в Ticket-ах 05, 07 и 08).
   - Не меняются: слова вердикта Gate в цитатах (новый текст и правку цитат делает Ticket 09);
     `VERIFIED` / `REJECTED`, `gate: VERIFIED`, строка `Status:`, последняя строка предполёта
     `GO` / `BLOCKED: …`, коды выхода `profile` 0–4, поля `epic-status --json`.
   - Плейсхолдеры в значениях Profile (`<эпик>`, `<NN>`, `<ветка>`, `<что-ревьюишь>` и другие) —
     контракт Profile, его меняет Ticket 11. Skill подставляет их как написано.
6. **Подписи брифа — английские**, общие с agents Ticket-а 07 (тот же список там):

   | Было | Стало |
   |---|---|
   | `Цель:` | `Goal:` |
   | `Репозиторий:` | `Repository:` |
   | `Тикет: …; спецификация: …` | `Ticket: …; spec: …` |
   | `Дерево:` | `Worktree:` |
   | `База:` | `Base:` |
   | `След по файлам:` | `Files:` |
   | `Номера:` | `Numbers:` |
   | `Следы соседей по волне (не трогать):` | `Wave neighbours' files (do not touch):` |
   | `Scratchpad:` | `Scratchpad:` |
   | `Запись в ~/.claude: разрешена \| запрещена` | `Write to ~/.claude: allowed \| forbidden` |
   | `GitHub:` | `GitHub:` |
   | `GUI-проверки: тебе \| не тебе` | `GUI checks: yours \| not yours` |

**Не входит.** `GH_TOKEN` без ручного `export` — Ticket 18. Узкий круг ревью без владельца —
Ticket 20. Silent mode — Ticket 22. Удаление полей путей из Profile и schema 2 — Ticket 11. Новый
текст вердикта Gate и JSON-файл — Ticket 09. Код worfy (Binding, показ Subagent-ов, шаблон
команды) — Ticket-ы 10 и 12. Agents — Ticket 07. Остальные skills и скрипты — Ticket 08.

## Готово, когда

- [x] В обоих SKILL.md нет `~/.claude/bin`, `~/.claude/hooks`, `$HOME/.claude`; `~/.claude` встречается только как `~/.claude/projects`, `~/.claude/worfy-harness` и в строке брифа `Write to ~/.claude`. Проверяет `harness/bin/tests/epic-wave-ship-ticket.test.sh`.
- [x] Profile и Gate вызываются через `${CLAUDE_PLUGIN_ROOT}/bin/profile` и `${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh`; правило «значение Profile с `~/.claude/bin/` читается как `${CLAUDE_PLUGIN_ROOT}/bin/`» есть в обоих skills. Тот же test.
- [x] Нет голых `` `implementer` ``, `` `reviewer` ``, `` `scout` `` и вызовов `/ship-ticket`, `/epic-wave`, `/retro` без `worfy:`; есть `worfy:implementer`, `worfy:reviewer`, `worfy:scout`. Тот же test.
- [x] `description` и раздел выбора Wave в `epic-wave` называют `tickets NN, NN of epic X`, «Ticket-ы NN, NN эпика X» и «волна N эпика X». Тот же test.
- [x] Нет `КОД=`; код выхода печатается `EXIT=$?`. Тот же test.
- [x] Номера разделов совпадают со старыми (список — в test-е). Тот же test.
- [x] Подписи брифа — по таблице пункта 6 «Что делаем». Тот же test.
- [x] Кириллица — только в разрешённых местах: старые формы команды Autopilot, слова вердикта Gate, плейсхолдеры Profile, названия разделов документов Project, русские примеры. Test держит список разрешённых подстрок, вырезает их и другой кириллицы не находит.
- [ ] `claude plugin validate harness; echo "EXIT=$?"` — код 0, в выводе нет строк про `skills/epic-wave` и `skills/ship-ticket` (локально, `claude` из терминала). Не проверено: настоящий Claude Code запускать запрещено.
- [x] Ревьюер с линзой «смысл сохранён» (Q34; Orchestrator даёт её явно) сравнил старый и новый текст обоих skills: `gh pr view <N> --json comments --jq '[.comments[].body | select(startswith("VERIFIED"))] | length'` — не меньше `1`. Выполнено: VERIFIED в [PR #110](https://github.com/IDSAD-XL/worfy/pull/110).
- [ ] CI на PR зелёный. Перед мержем — `GATE_SCOPE=all bash ~/.claude/hooks/gate.sh full` под замком `/tmp/worfy-e2e.lock`: код 0 и строка `[gate] зелено`.

## Тесты

Сначала падающий test — `harness/bin/tests/epic-wave-ship-ticket.test.sh`. На базе ветки (после
Ticket-а 02) в skills есть `~/.claude/bin/profile` и `КОД=` — test красный. В «Итог» — как он падал.

- `harness/bin/tests/epic-wave-ship-ticket.test.sh` (новый) — пункты «Готово, когда» с первого по
  восьмой. Стиль — как у `skill-blocks.test.sh`: bash, `ok` / `FAIL`, код 0 — всё прошло; путь к
  `harness/` — от своего файла. В CI его гоняет job, который завёл Ticket 02 для `harness/bin/tests/`.
- Поведение skills на plugin проверяет первая Wave после перехода (Ticket 16; ADR-0044, пункт 6).
  eval-кейсы — в E4.

## Где в коде

- `harness/skills/epic-wave/SKILL.md` (после Ticket-а 02; исходный `~/.claude/skills/epic-wave/SKILL.md`)
- `harness/skills/ship-ticket/SKILL.md` (после Ticket-а 02; исходный `~/.claude/skills/ship-ticket/SKILL.md`)
- `harness/bin/tests/epic-wave-ship-ticket.test.sh` (новый)

Не меняются: код worfy, agents (Ticket 07), остальные skills и скрипты (Ticket 08), `~/.claude`
(заморожен, ADR-0047). Общих файлов с Ticket-ами 05, 07 и 08 нет.

## Итог

PR #110 (ветка `worfy-harness/06`).

- **Перевод.** `harness/skills/epic-wave/SKILL.md` и `harness/skills/ship-ticket/SKILL.md` — по-английски,
  включая `description`. Номера разделов прежние: `## 0.`–`## 5.` и `## 0.`–`## 11.`. Блок ожидания CI
  (`gh run watch`) остался в шаге 8 `ship-ticket`: на него ссылается `implementer.md`.
- **Пути.** `F` — `"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field <field>`. Gate вызывается как
  `bash "${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh" fast`. Под тот же корень переехали `epic-board` и контракт
  Profile (`harness/profiles/README.md` есть после Ticket-а 02). В обоих skills — правило: значение
  Profile, которое начинается с `~/.claude/bin/`, читается как `${CLAUDE_PLUGIN_ROOT}/bin/` и остаток.
- **Префикс `worfy:`.** `worfy:implementer`, `worfy:reviewer`, `worfy:scout`, `/worfy:ship-ticket`,
  `/worfy:epic-wave`, `worfy:qmd`. Голое `ship-ticket` в `workflow.ticket_skill` значит `/worfy:ship-ticket`.
- **Команда Autopilot.** Формат — `/worfy:epic-wave tickets {tickets} of epic {epic}`. Он совпадает с тем,
  что worfy уже привязывает после Ticket-а 10 (`test/unit/binding.test.ts:245`; эпик — последнее слово,
  которое является известным эпиком, `src/shared/binding/resolve.ts:143`). Шаблон по умолчанию в
  `src/shared/projects/action-templates.ts:34` пока прежний; его меняет Ticket 12. Skill узнаёт и старые
  формы: «Ticket-ы NN, NN эпика X», «волна N эпика X», «run wave N of epic X».
- **Машинные строки.** `КОД=` заменён на `EXIT=`, строка `НЕТ RUN` — на `NO RUN` (о ней говорит
  `rules.md` профиля worfy). Подписи блока статуса `— Этап:`, `— Сейчас:`, `— Дальше:`, `— Жду:`
  процитированы дословно: их читает worfy (`src/shared/agent/status-block.ts:23`, spec.md, риск 4).
- **Test.** `harness/bin/tests/epic-wave-ship-ticket.test.sh`, в CI через
  `test/contract/harness-scripts.test.ts`. На базе ветки (31bc642) он падал: 11 проверок прошли,
  51 упала. Первые FAIL: `~/.claude/bin` в тексте, `F` не через `${CLAUDE_PLUGIN_ROOT}/bin/profile`,
  `КОД=`. Каждая проверка краснеет на своём мутанте skill-а.
- **Противоречие пунктов 1 и 2 «Готово, когда»** — решено без владельца, подтвердить. Пункт 1 запрещает
  `~/.claude/bin` в skills, а пункт 2 требует правило, которое называет это значение. Правило стоит в
  каждом skill одной дословной фразой; test вырезает ровно её, а потом ищет `~/.claude/bin`. Цена:
  чтобы переформулировать правило, нужно поправить и test.
- **Не проверено: `claude plugin validate harness`.** Бриф исполнителя запрещал запускать настоящий
  Claude Code; команда остаётся владельцу или Orchestrator-у.

**Влито.** [PR #110](https://github.com/IDSAD-XL/worfy/pull/110) → squash-коммит `d787c83` в `main`. Ревью — REJECTED в первом круге, один круг
доработки, затем VERIFIED (диф `d45e0df..c5ca0cf`). Находки первого круга: [med] раздел 5 `epic-wave` заменил
дословные подписи блока статуса («— Этап: / — Сейчас: / — Дальше: / — Жду:») описанием — Orchestrator в
английском Project напечатал бы «— Stage: …», и Node Orchestrator-а не показал бы статус Wave; [low] test не
держал запреты (мутанты, убирающие «не переключать глобальный аккаунт gh», «мутации только на копиях» и
«exit 0 без `[gate] зелено` — не проверка», выживали); [low] «Итог» не заполнен. Всё исправлено: подписи
процитированы, по одной проверке на запрет, test 70/70. Перед мержем: rebase на `f57999d`, head `0b1a09b`,
`GATE_SCOPE=all gate full` — exit 0, CI зелёный, `mergeStateStatus` CLEAN.

**Долг.**
- [low] Проверка подписей блока статуса ищет подпись где угодно в разделе 5: мутант, убирающий «— Сейчас:» из
  списка в `harness/skills/epic-wave/SKILL.md:388`, проходит, потому что `:390` повторяет подпись.
- [low] Skills печатают `NO RUN`, а `~/.claude/profiles/worfy/rules.md:23` (Profile worfy, вне репозитория)
  говорит «НЕТ RUN».
- [low] Skills этого Ticket-а ссылаются на `${CLAUDE_PLUGIN_ROOT}/profiles/README.md`, а пять skills Ticket-а 08 —
  на `~/.claude/profiles/README.md`.
- Противоречие пунктов 1 и 2 «Готово, когда» решено без владельца — в HANDOFF, «Ждёт владельца».
