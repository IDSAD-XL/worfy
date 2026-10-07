# 05 — Правила Harness приходят через hooks `SessionStart` и `SubagentStart`: по-английски, частями до 10 000 символов

Type: task
Status: open
Blocked by: 02
Source: решения владельца 2026-10-07, вопросы Q9, Q6, Q34 и Q32; [ADR-0041](../../../docs/adr/0041-harness-rules-via-session-hooks.md) (правила через hooks), [ADR-0044](../../../docs/adr/0044-harness-in-english-language-from-profile.md) (Harness на английском, машинные строки), [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) (plugin `worfy`, `${CLAUDE_PLUGIN_ROOT}`); [spec.md](../spec.md)

Пути Harness ниже — нынешние, в `~/.claude`. После Ticket-а 02 (импорт Harness с историей) те же
файлы лежат в `harness/` по тем же относительным путям, кроме одного: `~/.claude/CLAUDE.md` лежит
как `harness/rules/global.md` (Ticket 02, пункт 1). `~/.claude` заморожен (ADR-0047): правки — только
в `harness/`.

## Что происходит

- Общие правила Harness — `~/.claude/CLAUDE.md` владельца (после Ticket-а 02 — `harness/rules/global.md`):
  262 строки, 13 218 символов, по-английски. Claude Code грузит этот файл в каждую Session
  пользователя.
- Plugin `CLAUDE.md` не несёт: файл в корне plugin Claude Code не грузит, `claude plugin validate`
  о нём предупреждает. Правила доходят до Session через `additionalContext` hooks `SessionStart` и
  `SubagentStart`. Одна строка `additionalContext` — не больше 10 000 символов; длиннее — в контекст
  попадает превью на 2 000 (ADR-0041). Spike 2026-10-07 проверил: hooks plugin с `additionalContext`
  доходят до главной Session и до Subagent-а.
- Разделы `CLAUDE.md` по размеру (символы): «Plain language» 3 010, «Phase 3 — state, then report»
  2 455, «Evidence before "green"» 1 166, «Project profile» 922, «Phase 0» 782, «Quota» 605, «Your
  own hands» 586, «Subagent contract» 577, «Context hygiene» 574, «Delegate by default» 540,
  «Phase 2» 500, «Default loop» 373, «Long output» 329, «Answering, not exploring» 317, «Standing
  authorization» 310, заголовок 172. В одну часть до 10 000 символов файл целиком не помещается.
- Пути в тексте ведут в `~/.claude`: `~/.claude/bin/profile` и `~/.claude/profiles/README.md`
  (`CLAUDE.md:17`, `:19`), `~/.claude/hooks/gate.sh fast` (`:183`), `~/.claude/bin/epic-status`
  (`:221`), `~/.claude/bin/ticket` (`:229`). Поля Profile `tickets.epic_status` и
  `tickets.status_tool` (`:221`, `:228`) по Q11 — константы Harness; из Profile их убирает Ticket 11.
- Agents названы голыми именами: `scout` (`:104`, `:172`), `implementer` (`:172`), `reviewer`
  (`:173`, `:199`); skill — `qmd` (`:112`). В plugin это `worfy:scout`, `worfy:implementer`,
  `worfy:reviewer`, `worfy:qmd` (ADR-0040).
- Личное в файле: раздел «Standing authorization» (`:6-11`) — согласие владельца звать Subagent-ов
  без вопроса; Telegram (`:94`); обращения «me», «my», «I» (`:8`, `:97-99`, `:174`, `:183`, `:199`,
  `:215`, `:262`).
- Блок статуса в конце хода (`:209-216`) подписан «— Этап / Сейчас / Дальше / Жду». worfy разбирает
  его по этим словам (`src/shared/agent/status-block.ts:20-23`).
- Вердикт Gate цитируется русскими словами: «ПРОВЕРИТЬ НЕ УДАЛОСЬ» (`:188`). Новый текст вердикта
  задаёт Ticket 09 (ADR-0044, пункт 4).
- Hooks Harness подключены в `~/.claude/settings.json:5-109`, все команды — `$HOME/.claude/...`:
  - `SessionStart` — `hooks/session-start.sh` (timeout 15), `bin/worktree-lock claim` (10);
  - `TaskCompleted` и `TeammateIdle` — `hooks/gate.sh fast` (900);
  - `Stop` — `hooks/stop.sh` (10), `bin/worktree-lock beat` (5), `bin/qmd-refresh --quiet` (15, `:71`);
  - `SessionEnd` — `hooks/session-end.sh` (10), `bin/worktree-lock release` (5);
  - `PreToolUse`, matcher `Bash` — `hooks/guard.mjs` (10).

  В plugin связка hooks — `harness/hooks/hooks.json` (ADR-0041, пункт 3). Его пока нет.

## Что делаем

1. **Две части вместо `CLAUDE.md`** (Q9, ADR-0041).
   - `harness/hooks/rules/orchestrator.md` — главной Session: Default loop, Answering, Project
     profile и коды выхода `profile`, Phase 0, Delegate by default, Your own hands, Quota, Long
     output, Subagent contract, Phase 2, Phase 3 с блоком статуса, файлом состояния и ADR.
   - `harness/hooks/rules/common.md` — и главной Session, и Subagent-у: Plain language (с «Which
     language»), Evidence before "green", Context hygiene.
   - `SessionStart` отдаёт обе части двумя записями hook-а, у каждой свой `additionalContext`.
     `SubagentStart` отдаёт только `common.md`. Текст общей части один на оба события.
   - Каждая часть — не больше 10 000 символов (символов, не байт). Первая строка — метка:
     `# worfy Harness — orchestrator rules` и `# worfy Harness — common rules`.
   - Hooks одного события идут параллельно, порядок частей в контексте не задан. Поэтому часть не
     ссылается на другую словами «см. выше».
   - `orchestrator.md` не помещается и после сжатия — третья часть со своей записью
     `SessionStart`. Итоговые части и их размеры — в «Итог».
2. **Сжатие без потери правил** (Q6, Q34). Текст уже английский; правка — сжатие и чистка. В «Итог»
   — таблица «старый раздел → новое место», включая слитые и убранные строки с причиной.
3. **Личное в plugin не идёт** (Q9).
   - «Standing authorization» — согласие самого пользователя; plugin не даёт его за пользователя.
     Раздел остаётся личным в `~/.claude/CLAUDE.md` владельца (что убрать, что оставить, решает
     форма переноса — Ticket 14). Правило «delegate by default» в `orchestrator.md` остаётся, без
     слов о согласии. Как такое согласие даёт новый пользователь — вопрос владельцу: в «Итог» и в
     HANDOFF, раздел «Ждёт владельца».
   - Пример с Telegram — убрать.
   - «me», «my», «I» → «the user».
4. **Пути и имена** (Q2, ADR-0040).
   - Скрипты — `${CLAUDE_PLUGIN_ROOT}/bin/profile`, `${CLAUDE_PLUGIN_ROOT}/bin/epic-status`,
     `${CLAUDE_PLUGIN_ROOT}/bin/ticket`, `${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh fast`.
   - Контракт Profile — `${CLAUDE_PLUGIN_ROOT}/profiles/README.md`, если Ticket 02 положил его в
     `harness/profiles/` (проверить: `ls harness/profiles`). Иначе — путь из «Итог» Ticket-а 02.
   - Правило Phase 3 больше не говорит «если в Profile есть `tickets.epic_status`»: `epic-status` и
     `ticket` — скрипты Harness (Q11). Условие — Project ведёт Ticket-ы (поле `tickets.path`).
   - Agents — `worfy:scout`, `worfy:implementer`, `worfy:reviewer`; skill — `worfy:qmd`.
   - В `additionalContext` Claude Code `${CLAUDE_PLUGIN_ROOT}` не подставляет: он делает это в
     skills, agents, commands и в `command` hooks. Подставляет скрипт из пункта 6.
5. **Машинные строки не меняются** (Q6, ADR-0044, пункт 4).
   - Подписи блока статуса «— Этап: / — Сейчас: / — Дальше: / — Жду:» — как есть: их читает worfy
     (`status-block.ts:23`). Описания в угловых скобках — по-английски. Английские подписи
     потребовали бы правки worfy, в плане E3 её нет — вопрос владельцу в «Итог».
   - Слова вердикта Gate (`[gate] зелено (…)`, «ничего не прогналось», «ПРОВЕРИТЬ НЕ УДАЛОСЬ») —
     как есть. Новый текст вердикта и правку цитат делает Ticket 09.
   - Если в части нужен пример с кодом выхода — `echo "EXIT=$?"` (так же в Ticket-ах 06–08).
6. **Скрипт hook-а** `harness/hooks/inject-rules.sh <часть>`.
   - bash и `jq`. Node hook-у в PATH не гарантирован (поэтому `session-start.sh` ищет его сам), а
     `jq` Harness-у нужен и так (первый запуск проверяет его, Q22).
   - Читает `hook_event_name` из JSON на stdin. Берёт `rules/<часть>.md` рядом со своим файлом.
     Подставляет `${CLAUDE_PLUGIN_ROOT}` значением env; без env — каталог plugin от своего файла.
   - Печатает `{"hookSpecificOutput":{"hookEventName":"<событие>","additionalContext":"<текст>"}}`.
   - Всегда код 0. Нет файла части или пустой stdin — без `additionalContext`, одна строка
     причины в stderr: сломанный hook не ломает Session.
7. **`harness/hooks/hooks.json`** — связка всех hooks Harness (ADR-0041, пункт 3).
   - Записи — как в `~/.claude/settings.json:5-109`: те же события, matcher и timeout. Команды —
     `"${CLAUDE_PLUGIN_ROOT}/hooks/<скрипт>"` и `"${CLAUDE_PLUGIN_ROOT}/bin/worktree-lock" <действие>`,
     путь в кавычках.
   - Плюс `SessionStart` → `inject-rules.sh orchestrator` и `inject-rules.sh common`;
     `SubagentStart` → `inject-rules.sh common`.
   - Без записи `qmd-refresh --quiet`: где после переноса обновляется индекс qmd, решает Ticket 17
     (ADR-0043).
   - Имена скриптов не меняются; их содержимое правит Ticket 08.
8. **Удаляется `harness/rules/global.md`.** Его текст живёт в частях. Папка `harness/rules/`
   после этого пуста и тоже уходит. История файла остаётся в git после импорта Ticket-а 02.

**Не входит.**
- Записи hooks в `~/.claude/settings.json` владельца и личный остаток его `~/.claude/CLAUDE.md` —
  перенос, Ticket 14; переход машины владельца — Ticket 16. Пока записи на месте, Session с этим
  plugin запускает каждый hook дважды (ADR-0041).
- Правила Project (`rules.md` Profile, их подмешивает `hooks/session-start.sh`) — Ticket 08 и ADR-0042.
- Доходят ли правила до Subagent-ов workflow-скриптов — Ticket 01 (итог — ADR-0048).
- Новый текст вердикта Gate — Ticket 09.

## Готово, когда

- [ ] Каждая часть в `harness/hooks/rules/` — не больше 10 000 символов, первая строка — метка части. Проверяет `harness/hooks/tests/rules-hooks.test.sh`.
- [ ] `inject-rules.sh` на JSON `SessionStart` и на JSON `SubagentStart` печатает JSON: `hookEventName` — событие из stdin, `additionalContext` — текст части, где `${CLAUDE_PLUGIN_ROOT}` заменён значением env; строки `${CLAUDE_PLUGIN_ROOT}` в выводе нет; код 0. Тот же test.
- [ ] Без env `CLAUDE_PLUGIN_ROOT` подставляется каталог plugin, вычисленный от файла скрипта. Нет файла части или пустой stdin — код 0, `additionalContext` нет, причина — одна строка в stderr. Тот же test.
- [ ] В частях нет `~/.claude/bin`, `~/.claude/hooks`, `~/.claude/profiles`, `$HOME/.claude`; скрипты Harness — через `${CLAUDE_PLUGIN_ROOT}/`; agents — `worfy:scout`, `worfy:implementer`, `worfy:reviewer`; голых `` `scout` ``, `` `implementer` ``, `` `reviewer` `` нет. Тот же test.
- [ ] Ни одно правило не потеряно: test держит список тем старого `CLAUDE.md` (от «Default loop» до «Context hygiene», без «Standing authorization») и находит каждую в `orchestrator.md` или `common.md`. В `common.md` — ровно «Plain language», «Evidence before "green"», «Context hygiene»; тем Orchestrator-а («Phase 0», «Quota», «Default loop») в нём нет. Тот же test.
- [ ] В `orchestrator.md` есть строки, которые ловит `LINE` из `src/shared/agent/status-block.ts:23`: «— Этап:», «— Сейчас:», «— Дальше:», «— Жду:». Кириллица в частях — только в этих подписях, в словах вердикта Gate и в русских примерах раздела о русском языке; разрешённые подстроки перечислены в test-е, остальной кириллицы нет. Тот же test.
- [ ] В частях нет «Telegram» и «Standing authorization». Тот же test.
- [ ] `harness/hooks/hooks.json` — валидный JSON. События, matcher и timeout совпадают с `~/.claude/settings.json:5-109` без `qmd-refresh` (ожидаемый список — в test-е). Есть три записи `inject-rules.sh`: две в `SessionStart`, одна в `SubagentStart`. Каждый путь команды после подстановки `${CLAUDE_PLUGIN_ROOT}` = `harness` существует и исполняем. Тот же test.
- [ ] Старого файла правил нет: `test ! -e harness/rules/global.md` — exit 0.
- [ ] (локально) Части доходят: `claude -p --plugin-dir "$PWD/harness" 'Quote verbatim every line of your context that starts with "# worfy Harness".' | grep -c '^# worfy Harness — '` печатает `2`. Subagent: `claude -p --plugin-dir "$PWD/harness" 'Start a general-purpose Subagent. Ask it to quote verbatim every line of its context that starts with "# worfy Harness" and nothing else. Print only its answer.'` — в ответе `grep -c 'common rules'` не меньше `1`, а `grep -c 'orchestrator rules'` печатает `0`. Транскрипты пишутся в `~/.claude/projects`, как у любой Session; другой записи в `~/.claude` нет.
- [ ] Ревьюер с линзой «смысл сохранён» (Q34; в `review.lenses` Profile worfy её нет — Orchestrator даёт её явно) сравнил `harness/rules/global.md` на базе ветки с обеими частями: `gh pr view <N> --json comments --jq '[.comments[].body | select(startswith("VERIFIED"))] | length'` — не меньше `1`.
- [ ] CI на PR зелёный. Перед мержем — `GATE_SCOPE=all bash ~/.claude/hooks/gate.sh full` под замком `/tmp/worfy-e2e.lock`: код 0 и строка `[gate] зелено`.

## Тесты

Сначала падающий test — `harness/hooks/tests/rules-hooks.test.sh`. На базе ветки (после Ticket-а 02)
нет ни частей, ни `inject-rules.sh`, ни `hooks.json` — test красный. В «Итог» — как он падал.

- `harness/hooks/tests/rules-hooks.test.sh` (новый) — пункты «Готово, когда» с первого по
  восьмой. Стиль — как у соседних test-ов: bash, строки `ok` / `FAIL`, код 0 — всё прошло; путь к
  `harness/` — от своего файла. В CI его гоняет job, который завёл Ticket 02 для `harness/hooks/tests/`;
  если job перечисляет файлы поимённо, а не маской, — это пишется в «Итог», `ci.yml` здесь не правится.
- Live-проверка и `claude plugin validate` — локально, не в CI: им нужны `claude` и вход.
- Следуют ли модели правилам из `additionalContext` так же, как правилам из `CLAUDE.md`, проверяет
  первая Wave после перехода (Ticket 16, ADR-0041).

## Где в коде

- `harness/rules/global.md` — удаляется (импортирован Ticket-ом 02 из `~/.claude/CLAUDE.md`)
- `harness/hooks/rules/orchestrator.md` (новый)
- `harness/hooks/rules/common.md` (новый)
- `harness/hooks/inject-rules.sh` (новый)
- `harness/hooks/hooks.json` (новый)
- `harness/hooks/tests/rules-hooks.test.sh` (новый)

Не меняются: остальные скрипты `harness/hooks/` и `harness/bin/` (Ticket 08; он не переименовывает
файлы, на которые ссылается `hooks.json`), `~/.claude` (заморожен, ADR-0047), код worfy. Общих
файлов с Ticket-ами 06, 07 и 08 нет.

## Итог

Заполняется при закрытии.
