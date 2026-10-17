# 05 — Правила Harness приходят через hooks `SessionStart` и `SubagentStart`: по-английски, частями до 10 000 символов

Type: task
Status: done 2026-10-07
PR: #109
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

- [x] Каждая часть в `harness/hooks/rules/` — не больше 10 000 символов, первая строка — метка части. Проверяет `harness/hooks/tests/rules-hooks.test.sh`.
- [x] `inject-rules.sh` на JSON `SessionStart` и на JSON `SubagentStart` печатает JSON: `hookEventName` — событие из stdin, `additionalContext` — текст части, где `${CLAUDE_PLUGIN_ROOT}` заменён значением env; строки `${CLAUDE_PLUGIN_ROOT}` в выводе нет; код 0. Тот же test.
- [x] Без env `CLAUDE_PLUGIN_ROOT` подставляется каталог plugin, вычисленный от файла скрипта. Нет файла части или пустой stdin — код 0, `additionalContext` нет, причина — одна строка в stderr. Тот же test.
- [x] В частях нет `~/.claude/bin`, `~/.claude/hooks`, `~/.claude/profiles`, `$HOME/.claude`; скрипты Harness — через `${CLAUDE_PLUGIN_ROOT}/`; agents — `worfy:scout`, `worfy:implementer`, `worfy:reviewer`; голых `` `scout` ``, `` `implementer` ``, `` `reviewer` `` нет. Тот же test.
- [x] Ни одно правило не потеряно: test держит список тем старого `CLAUDE.md` (от «Default loop» до «Context hygiene», без «Standing authorization») и находит каждую в `orchestrator.md` или `common.md`. В `common.md` — ровно «Plain language», «Evidence before "green"», «Context hygiene»; тем Orchestrator-а («Phase 0», «Quota», «Default loop») в нём нет. Тот же test.
- [x] В `orchestrator.md` есть строки, которые ловит `LINE` из `src/shared/agent/status-block.ts:23`: «— Этап:», «— Сейчас:», «— Дальше:», «— Жду:». Кириллица в частях — только в этих подписях, в словах вердикта Gate и в русских примерах раздела о русском языке; разрешённые подстроки перечислены в test-е, остальной кириллицы нет. Тот же test.
- [x] В частях нет «Telegram» и «Standing authorization». Тот же test.
- [x] `harness/hooks/hooks.json` — валидный JSON. События, matcher и timeout совпадают с `~/.claude/settings.json:5-109` без `qmd-refresh` (ожидаемый список — в test-е). Есть три записи `inject-rules.sh`: две в `SessionStart`, одна в `SubagentStart`. Каждый путь команды после подстановки `${CLAUDE_PLUGIN_ROOT}` = `harness` существует и исполняем. Тот же test.
- [x] Старого файла правил нет: `test ! -e harness/rules/global.md` — exit 0.
- [ ] (локально) Части доходят: `claude -p --plugin-dir "$PWD/harness" 'Quote verbatim every line of your context that starts with "# worfy Harness".' | grep -c '^# worfy Harness — '` печатает `2`. Subagent: `claude -p --plugin-dir "$PWD/harness" 'Start a general-purpose Subagent. Ask it to quote verbatim every line of its context that starts with "# worfy Harness" and nothing else. Print only its answer.'` — в ответе `grep -c 'common rules'` не меньше `1`, а `grep -c 'orchestrator rules'` печатает `0`. Транскрипты пишутся в `~/.claude/projects`, как у любой Session; другой записи в `~/.claude` нет. Не проверено: настоящий Claude Code запускать запрещено.
- [x] Ревьюер с линзой «смысл сохранён» (Q34; в `review.lenses` Profile worfy её нет — Orchestrator даёт её явно) сравнил `harness/rules/global.md` на базе ветки с обеими частями: `gh pr view <N> --json comments --jq '[.comments[].body | select(startswith("VERIFIED"))] | length'` — не меньше `1`. Выполнено: VERIFIED в [PR #109](https://github.com/IDSAD-XL/worfy/pull/109).
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
- вне следа, разрешено Orchestrator-ом 2026-10-07: `test/contract/harness-plugin.test.ts` (ждал
  `rules/global.md` среди импортированных файлов — теперь ждёт обе части) и `harness/README.md` (только
  строка таблицы и абзац о `rules/global.md`)

Не меняются: остальные скрипты `harness/hooks/` и `harness/bin/` (Ticket 08; он не переименовывает
файлы, на которые ссылается `hooks.json`), `~/.claude` (заморожен, ADR-0047), код worfy. Общих
файлов с Ticket-ами 06, 07 и 08 нет.

## Итог

- **Части и размеры** (символы, `jq -Rs length`): `harness/hooks/rules/orchestrator.md` — 8 590,
  `harness/hooks/rules/common.md` — 4 899. Третья часть не понадобилась. С длинным путём plugin-а
  (113 символов вместо `${CLAUDE_PLUGIN_ROOT}`) обе части остаются в пределах 10 000 — это тоже
  проверяет test.
- **Падающий test** — `harness/hooks/tests/rules-hooks.test.sh` на базе ветки: код 1, `passed: 39,
  failed: 79` (нет частей, `inject-rules.sh`, `hooks.json`; `rules/global.md` на месте). Зелёные 39 —
  отрицательные проверки («нет Telegram», «нет `~/.claude/bin`» и т. п.), которые на пустом месте
  проходят; их держат положительные проверки того же test-а. После правки — `passed: 139, failed: 0`.
- **CI** — job из Ticket-а 02 (`test/contract/harness-scripts.test.ts`) берёт `*.test.sh` маской
  (`readdirSync` + `endsWith('.test.sh')`), новый test он подхватывает сам; `ci.yml` не менялся.
- **Правка вне следа** (разрешил Orchestrator): `test/contract/harness-plugin.test.ts:63` ждал
  `rules/global.md` среди файлов `harness/` — после удаления ждёт `hooks/rules/orchestrator.md` и
  `hooks/rules/common.md`; `harness/README.md` — строка таблицы и абзац о `rules/global.md`.
- **`inject-rules.sh`** — bash и `jq`. Подставляет `${CLAUDE_PLUGIN_ROOT}` буквально (`split`/`join`,
  без regex). Пустой `CLAUDE_PLUGIN_ROOT` считается отсутствующим. Имя части с `/` или с точкой в
  начале не принимается (часть берётся только из `hooks/rules/`). Без `jq`, на пустом stdin, на stdin
  не JSON и без `hook_event_name` — код 0, stdout пуст, одна строка в stderr.
- **`hooks.json`** — записи `~/.claude/settings.json:5-109` с теми же событиями, matcher и timeout, без
  `qmd-refresh --quiet`; плюс `inject-rules.sh orchestrator` и `common` в `SessionStart`, `common` в
  `SubagentStart`, timeout 10. Поле `description` верхнего уровня — необязательное поле `hooks.json`
  plugin-а. Решено без владельца, подтверждено владельцем 2026-10-12: timeout 10 у `inject-rules.sh`.

**Куда легли разделы `harness/rules/global.md`** (строки старого файла → новое место):

| Старый раздел (строки) | Новое место | Что изменилось |
|---|---|---|
| Заголовок «Workflow: orchestrator + subagents» (1–4) | `orchestrator.md:3-5` | заголовок слит с вводным абзацем; добавлена фраза, что простой язык, доказательства и гигиена — в общих правилах |
| Standing authorization (6–11) | убран | согласие самого пользователя; plugin его за пользователя не даёт (п. 3 тикета). «Delegate by default» остался |
| Project profile (13–31) | `orchestrator.md:7-22` | пути — `${CLAUDE_PLUGIN_ROOT}/bin/profile`, `${CLAUDE_PLUGIN_ROOT}/profiles/README.md`; ticket CLI и `epic-status` действуют, когда у Project есть `tickets.path` (Q11), остальное — когда Profile их объявляет; «no `qmd` query» → «no qmd query» |
| Default loop (33–40) | `orchestrator.md:24-31` | без изменений |
| Answering, not exploring (42–47) | `orchestrator.md:33-37` | без изменений |
| Plain language (49–56) | `common.md:5-11` | без изменений |
| Writing in Russian (58–67) | `common.md:13-20` | без изменений, русские примеры как есть |
| Metaphors (69–72) | `common.md:22-24` | без изменений |
| Codes carry their meaning (74–78) | `common.md:26-30` | без изменений |
| Restate, don't point back (80–82) | `common.md:32-34` | без изменений |
| Short sentences (84–85) | `common.md:36-37` | без изменений |
| Self-check before sending (87–91) | `common.md:39-42` | без изменений |
| Scope (93–95) | `common.md:44-45` | «a message drafted for a friend in Telegram» → «a personal message drafted for someone» |
| Which language (97–100) | `common.md:47-50` | «to me», «I am writing in» → «to the user», «the user writes in» |
| Phase 0 (102–116) | `orchestrator.md:39-50` | `scout` → `worfy:scout`; «skill `qmd`» → «skill `worfy:qmd`», «MCP server `qmd`» → «the qmd MCP server», «one `qmd` query» → «one search of the qmd index»; «Ask it for» слито с первым абзацем |
| Delegate by default (118–128) | `orchestrator.md:52-61` | «you sharpen it» → «the orchestrator sharpens it» |
| Your own hands (130–141) | `orchestrator.md:63-73` | без изменений |
| Quota (143–156) | `orchestrator.md:75-86` | «Every line above» → «Every line of the closed list» (часть не ссылается на текст вне себя); «Two counters» слито с первым абзацем |
| Long output (158–163) | `orchestrator.md:88-92` | без изменений |
| Subagent contract (165–175) | `orchestrator.md:94-103` | agents — `worfy:scout`, `worfy:implementer`, `worfy:reviewer`; «resolve my directory» → «the orchestrator's directory» |
| Evidence before "green" (177–195) | `common.md:52-67` | «(above)» убрано; `echo $?` → `echo "EXIT=$?"`; путь Gate — `${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh fast`; «my reading» → «reading»; «`3` is «не проверено»» → «`3` is not verified» (кириллица — только в словах вердикта); `0` — зелено только со строкой `[gate] зелено (…)`, «ничего не прогналось» и «ПРОВЕРИТЬ НЕ УДАЛОСЬ» как есть, с английским переводом рядом |
| Phase 2 (197–205) | `orchestrator.md:105-111` | `reviewer` → `worfy:reviewer`; «before you report to me» → «before reporting to the user» |
| Phase 3: блок статуса (207–226) | `orchestrator.md:113-132` | подписи «— Этап / Сейчас / Дальше / Жду:» как есть; описания в скобках — по-английски («ничего» → «"nothing" in the language of reports»); добавлено «подписи не переводятся — их читает worfy»; «Готово» → «Done»; условие Этап-строки — `tickets.path` и `${CLAUDE_PLUGIN_ROOT}/bin/epic-status <epic>` вместо `tickets.epic_status` |
| Phase 3: статус тикета (228–233) | `orchestrator.md:134-138` | `${CLAUDE_PLUGIN_ROOT}/bin/ticket` вместо `tickets.status_tool`; `block <причина>` → `block <reason>`, `<эпик>` → `<epic>`; «No status tool in the profile» → «No tickets in the profile» |
| Phase 3: файл состояния (235–244) | `orchestrator.md:140-147` | без изменений |
| Phase 3: ADR и файл состояния (246–251) | `orchestrator.md:149-153` | без изменений |
| Context hygiene (253–262) | `common.md:69-78` | «Report to me … what I need to decide» → «Report to the user … what they need to decide» |

**Вопросы владельцу** (в HANDOFF, «Ждёт владельца», их вносит Orchestrator):

1. Как согласие «звать Subagent-ов без вопроса» (бывший «Standing authorization») даёт новый
   пользователь plugin-а: plugin его за пользователя не даёт, у владельца раздел остаётся в личном
   `~/.claude/CLAUDE.md` (Ticket 14).
   Владелец решил 2026-10-12: действие экрана первого запуска с «Confirm» дописывает раздел в личный
   `~/.claude/CLAUDE.md`; отдельный Ticket, до первого внешнего пользователя не срочно; Ticket заводит Orchestrator.
2. Подписи блока статуса остались русскими («— Этап: / — Сейчас: / — Дальше: / — Жду:»): их разбирает
   `src/shared/agent/status-block.ts:23`. Английские подписи потребуют правки worfy — в плане E3 её нет.
   Владелец решил 2026-10-12: сейчас не переводить; вернуться, когда появится Project с английскими отчётами.

**Не проверено.**
- [ ] Live-проверка в Claude Code (`claude -p --plugin-dir …`, пункт «Готово, когда») — не проверено:
  бриф волны запретил запускать настоящий Claude Code (он пишет транскрипты в `~/.claude/projects`).
  Hook проверен shell-test-ом с JSON событий на stdin, как его подаёт Claude Code. По той же причине не
  запускался `claude plugin validate`.
  Владелец решил 2026-10-12: `claude plugin validate harness` и живые проверки `worfy-harness` 05–08
  делает Orchestrator в песочнице приёмки, где вход уже есть; настоящий `~/.claude` они не трогают.
- Пока записи hooks в `~/.claude/settings.json` владельца на месте, Session с plugin-ом запускает
  каждый hook дважды (ADR-0041); убирает их перенос — Ticket 14.

**Влито.** [PR #109](https://github.com/IDSAD-XL/worfy/pull/109) → squash-коммит `728ee71` в `main`. Ревью — VERIFIED с первого круга (линзы
«отчёт исполнителя» и «смысл сохранён»): каждый абзац старого `harness/rules/global.md` найден в `orchestrator.md`
или `common.md` с тем же смыслом. Одна находка [med] — test правил держал правила о доказательствах только по
теме, два мутанта выживали — исправлена до мержа в `2befae6`: test держит маркеры «never green», «Neither is
reported as done», «not from reading the diff», «is green only when», «Only verified state goes in»; оба мутанта
краснеют, test — 139/0. Первая попытка мержа остановилась: `test/e2e/epic-frame.spec.ts:721` (нестабильный
test «long names», к этому Ticket-у не относится) упал два прогона `gate full` подряд. Мерж — после повтора:
rebase на `7e51db3`, head `6e68b39`, `GATE_SCOPE=all gate full` — exit 0, CI зелёный, `mergeStateStatus` CLEAN.

**Долг.**
- [low] `src/shared/agent/status-block.ts:1-2` — комментарий называет источником блока статуса
  `~/.claude/CLAUDE.md`, «Phase 3»; теперь это `harness/hooks/rules/orchestrator.md`.
- Live-проверка частей в Claude Code и `claude plugin validate` — не проверено (пункты «Готово, когда» выше).
- Вопросы владельцу (timeout 10 у `inject-rules.sh`; согласие нового пользователя звать Subagent-ов вместо
  «Standing authorization»; русские подписи блока статуса) — в HANDOFF, «Ждёт владельца».
