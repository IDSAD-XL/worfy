# 16 — Шаг владельца: машина владельца переходит на plugin `worfy`

Type: task
Status: blocked — шаг владельца: переход машины на plugin
Blocked by: 05, 09, 14, 15
Source: решения владельца 2026-10-07, Q13, Q33, Q14, Q19, Q8, Q35 (пункт 3); [ADR-0047](../../../docs/adr/0047-harness-lessons-by-pr-early-owner-switch.md) (ранний переход машины владельца, `~/.claude` заморожен после импорта, откат одной командой, без пересборки во время Autopilot); [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) (plugin `worfy`, состояние машины в `~/.claude/worfy-harness/`); [ADR-0041](../../../docs/adr/0041-harness-rules-via-session-hooks.md) (правила Harness через hooks `SessionStart` и `SubagentStart`); [ADR-0044](../../../docs/adr/0044-harness-in-english-language-from-profile.md) (вердикт Gate JSON-файлом); [spec.md](../spec.md)

## Что происходит

- На машине владельца Harness — файлы в `~/.claude`. Wave-ы E3 до этого Ticket-а Autopilot ведёт на
  них (Q33). После мержа Ticket-а 02 `~/.claude` заморожен (Q13): уроки идут в `harness/` и начнут
  действовать только после перехода.
- К этому Ticket-у влиты: правила для hooks `SessionStart` и `SubagentStart` (Ticket 05), вердикт
  Gate JSON-файлом (Ticket 09), установщик (Ticket 13), перенос с резервной копией и откатом
  (Ticket 14), мост Limits в `.app` (Ticket 15). Всё это проверено в песочнице; на настоящем
  `~/.claude` — ещё нет.
- Пометки «этот Ticket агенты не берут» в Harness нет. `epic-status` (`harness/bin/epic-status`,
  исходный путь `~/.claude/bin/epic-status:161-162`) читает из Ticket-а только `Status:` и
  `Blocked by:`, поле `Type:` он не разбирает. Skill `epic-wave` (`harness/skills/epic-wave/SKILL.md`,
  исходный путь `~/.claude/skills/epic-wave/SKILL.md:81-90`) берёт в Wave каждый Ticket со
  `state: "open"` и закрытыми блокерами.
- worfy так же: `readyWave` (`src/shared/workflow/waves.ts:158-200`) отдаёт Autopilot-у каждый open
  Ticket с закрытыми блокерами. Не берёт он только Ticket в состоянии blocked или без статуса
  (`src/shared/workflow/waves.ts:170-176`); если готового open Ticket-а нет, прогон останавливается с
  причиной `blocked-tickets` (`src/shared/autopilot/cycle.ts:142-145`).

## Что делаем

**Autopilot и implementer этот Ticket не берут; закрывает Orchestrator после шага владельца.**

1. **Остановить Autopilot перед Ticket-ом (Q33).** Своей пометки нет, поэтому — тем, что уже
   останавливает прогон: Ticket приходит в main уже со `Status: blocked — шаг владельца: переход
   машины на plugin` (так его завёл docs-PR Epic-а). Пока блокеры 05, 09, 14, 15 открыты, это ничего
   не меняет. Когда они закрыты, worfy не отдаёт Ticket в Wave (`readyWave` пишет его в `skipped`) и
   останавливает прогон с `blocked-tickets`, как только другого готового Ticket-а нет. В начале шага
   владельца — `ticket open worfy-harness 16`.
2. **Подготовка (Orchestrator, без владельца).**
   - Прогон Autopilot не идёт: во время прогона Stable copy не пересобирается (Q14).
   - `pnpm install:stable` из main, в котором влиты 05, 09, 13, 14, 15. Код выхода и SHA — в «Итог».
   - Снимок до перехода — сразу в «Итог» этого Ticket-а, подраздел «Снимок до», без токенов
     (scratchpad Session не переживает её конец, а снимок нужен для сверки на шаге 4):
     `git -C ~/.claude status --short` (как есть; 2026-10-07 там `?? skills/synced/` — личная папка,
     Q19), `git -C ~/.claude log -1 --format=%H`, `ls ~/.claude/agents ~/.claude/skills
     ~/.claude/bin ~/.claude/hooks`, `jq '{statusLine, hooks, model, env, effortLevel, enabledPlugins}'
     ~/.claude/settings.json`, `jq '.mcpServers | keys' ~/.claude.json`.
   - Работа после перехода идёт в новых Session-ах. По docs Claude Code hooks Session берёт при
     старте, поэтому Session, начатая до перехода, звала бы удалённые файлы. Это проверить на шаге 4.
3. **Шаг владельца (Q33, Q8).** В Stable copy:
   - Install Harness (элемент toolbar Ticket-а 13) → согласие в диалоге;
   - форма переноса (Ticket 14): владелец смотрит строки «уберу / оставлю», ставит `mode`,
     `language.docs`, `attribution` для worfy, Auction и Atakama (Q28: worfy и Auction — Full,
     Atakama — Silent; Q25: `attribution` — решение владельца) и подтверждает;
   - строка `statusLine` — замена на мост Stable copy
     (`~/Applications/worfy-stable.app/Contents/Resources/statusline-bridge.sh`);
   - группа qmd (`bin/qmd-*`, запись hook `qmd-refresh --quiet`, запись qmd в `~/.claude.json`)
     уходит по умолчанию (Q15, Q19). До Ticket-а 17 сервер qmd в plugin не зарегистрирован, и агенты
     ищут grep-ом по `qmd.fallback_grep` Profile-а — форма об этом предупреждает. Оставить группу
     может только владелец; тогда это пишется в «Итог» и в HANDOFF.
   Системные запросы macOS и вход в аккаунты — тоже владелец (Q8).
4. **Проверки Orchestrator-а** — в новой Session терминала после шага владельца. Каждая — команда с
   кодом выхода; вывод — в «Итог» (без токенов). Список — в «Готово, когда».
5. **Не прошло.** Откат одной командой: `node ~/.claude/worfy-harness/backup-<дата>/restore.mjs`.
   Ticket — `ticket block worfy-harness 16 "<что не прошло>"`, пункт — в HANDOFF, раздел «Ждёт
   владельца». Autopilot не перезапускается.
6. **Прошло.** `ticket done worfy-harness 16` — скриптом из plugin
   (`~/.claude/worfy-harness/plugin/bin/ticket`). В HANDOFF: дата перехода, путь резервной копии,
   команда отката, что до Ticket-а 17 qmd в Session-ах нет. Дальше все Wave-ы E3 идут на plugin
   (Q33).

Писать в `/Users/alexey/Work/*` нельзя: Auction и Atakama в проверках — только чтение.

## Готово, когда

- [ ] (владелец) Install Harness и перенос сделаны в Stable copy; путь резервной копии — в «Итог».
- [ ] `~/.claude` — только личное: снимок до и `ls ~/.claude/agents ~/.claude/skills ~/.claude/bin ~/.claude/hooks` после, сравнение `comm -23` — пропали ровно Harness-файлы Q19 (3 agents, 7 skills, `bin/` без `telegram-mcp`, `auction-staging-db-mcp`, `agent-time-split`, `hooks/`); личные skills, `skills/synced/` и три личных скрипта `bin/` на месте.
- [ ] `jq '[.hooks[][].hooks[].command]' ~/.claude/settings.json` — нет команд, ведущих в `$HOME/.claude/hooks/` или `$HOME/.claude/bin/`; `jq '{model, env, effortLevel}'` совпадает со снимком; `statusLine.command` — мост Stable copy.
- [ ] `jq '.mcpServers.qmd' ~/.claude.json` — `null`, остальные ключи `mcpServers` — как в снимке. Если владелец оставил группу qmd, этот пункт и qmd в двух пунктах выше заменяет запись в «Итог» и HANDOFF.
- [ ] `git -C ~/.claude log -1 --stat` — коммит переноса, в нём только пути из формы; `git -C ~/.claude status --short` — тот же вывод, что в «Снимок до» (личное вне git, например `?? skills/synced/`, остаётся как было).
- [ ] `claude plugin list --json` (терминальный `claude`) — `worfy` включён, версия равна версии Stable copy.
- [ ] Новая Session в терминале видит plugin: `set -o pipefail; claude -p ok --output-format stream-json --verbose | jq -c 'select(.type=="system" and .subtype=="init") | {plugins, slash_commands}'` — код 0, в `plugins` есть `worfy`, в `slash_commands` — `worfy:epic-wave` и `worfy:ship-ticket`.
- [ ] `~/.claude/worfy-harness/plugin/bin/epic-status worfy-harness` в checkout-е worfy — код 0 и строка Epic-а; с `--json` — код 0 и Ticket-ы `worfy-harness`.
- [ ] `GATE_SCOPE=all bash ~/.claude/worfy-harness/plugin/hooks/gate.sh fast` в checkout-е worfy — код 0, строка `[gate]` зелёная, файл вердикта (Ticket 09) с тем же исходом; Stable copy показывает этот вердикт.
- [ ] `~/.claude/worfy-harness/plugin/bin/profile -C /Users/alexey/Stuff/CanvasForAI --field mode` — код 0 и `full`; то же для `/Users/alexey/Work/Auction` — `full`, для `/Users/alexey/Work/Atakama/Atakama-Browser-Server` (реестр Gate сопоставляет Atakama по каждому из трёх репозиториев) — `silent` (только чтение).
- [ ] Stable copy показывает Epic-и worfy и Auction (окно приложения; только чтение).
- [ ] Limits из терминала: после ответа новой Session в терминале `stat -f %m ~/Library/Application\ Support/worfy/statusline-limits.json` новее времени перехода.
- [ ] `test -f ~/.claude/worfy-harness/backup-<дата>/restore.mjs` — код 0; команда отката записана в HANDOFF. Сам откат на настоящем `~/.claude` не запускается.
- [ ] HANDOFF: переход сделан, дата, путь копии, команда отката; до Ticket-а 17 qmd в Session-ах нет.

## Тесты

Код этот Ticket не меняет. Автоматические test-ы установщика, переноса и моста Limits — в
Ticket-ах 13, 14 и 15 (песочница). Здесь — проверки командами на настоящей машине владельца; вывод
каждой — в «Итог».

## Где в коде

- `HANDOFF.md` — раздел о переходе
- `~/.claude/` — меняет форма переноса Ticket-а 14 на шаге владельца

Кода worfy и файлов `harness/` Ticket не меняет. Вне репозитория меняются ещё `~/.claude.json`
(запись qmd, если она ушла по форме) и `~/.claude/worfy-harness/`. Читаются
`~/Applications/worfy-stable.app` и репозитории Auction и Atakama.

## Итог

Заполняется при закрытии.
