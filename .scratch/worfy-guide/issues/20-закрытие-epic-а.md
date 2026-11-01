# 20 — Закрытие Epic-а: отчёт об отставании в ежемесячном аудите

Type: task
Status: open
Blocked by: 11, 12, 13, 14, 15, 16, 17, 18, 19
Source: [spec.md](../spec.md), Q9, Q17

## Что происходит

Запланированная задача `worfy-feature-docs-monthly-audit` на Mac не знает про Topic-и.

## Что делаем

1. Добавить `node scripts/guide-lag.mjs` в текст запланированной задачи, отчёт о Topic-ах рядом с отчётом о страницах.
2. Обновить отставшие Topic-и и переводы по отчёту.
3. Закрыть «Готово, когда» spec-а, строку Epic-а в `HANDOFF.md`, `node scripts/check-handoff.mjs`.

## Готово, когда

- [x] `scripts/guide-lag.mjs`: нет отстающих, exit code 0.
- [x] Задача обновлена и видна в списке запланированных задач. — сделал orchestrator 2026-11-01: файл задачи правлен напрямую,
  после `feature-docs-lag` задача запускает `node scripts/guide-lag.mjs`; показывает ли приложение Claude новое описание — взглянуть владельцу.
- [ ] Все пункты spec-а отмечены. — отмечены шесть из семи; открыт только «README причёсан» (Ticket 21).

## Тесты

Нет.

## Где в коде

- `scripts/guide-lag.mjs`, `HANDOFF.md`.

## Итог

`node scripts/guide-lag.mjs` до правки: 9 отставаний страниц, 0 отставаний перевода (14 Topic-ов). После: 0 и 0, exit
code 0. Каждый коммит страницы с прежнего SHA прочитан через `git log -p <sha>..origin/main -- <страница>`.

### Topic-и, где поменялся текст

**autopilot** — `docs/features/autopilot.md`, `02be335e` → `ee30655f` (worfy-flight-recorder 21, 22, 23 и 11). Новые фразы,
`en.json` и `ru.json`:

| Где | Фраза | Источник |
|---|---|---|
| `summary[0]` | Тот же прогон, по Epic-у или по части его Ticket-ов, начинает `/worfy:epic-wave` в чате Session | `docs/features/autopilot.md:43-47`, `:53` |
| `summary[0]` | …и просьба к агенту словами — после подтверждения диалога worfy | `autopilot.md:64-71` |
| `underTheHood.text[2]` | Команда с Epic-ом, Wave или Ticket-ами до агента не доходит; `agent.send` передаёт её в `ChatStarts.startFromChat` | `autopilot.md:44`, `:55`, `:336`; `src/main/ipc/agent.ts:136` |
| `underTheHood.text[2]` | Инструмент Canvas MCP `autopilot_start` приходит туда же после диалога | `autopilot.md:333`; `src/main/autopilot/chat-confirm.ts:185` |
| `underTheHood.text[2]` | Прогон по названным Ticket-ам берёт в Wave-ы только их и останавливается с `tickets-done` | `autopilot.md:212`; `src/shared/autopilot/cycle.ts:36`, `:223` |
| `underTheHood.limits[4]` | Диалог ждёт 10 минут; Session без человека получает отказ без диалога | `autopilot.md:69`, `:74`; `chat-confirm.ts:33`, `:45` |
| `underTheHood.files` | `src/main/autopilot/chat-start.ts` — старт из чата, командой или инструментом (добавлен и в `topic.json`) | `autopilot.md:333`; `chat-start.ts:91` |

Не тронуто, потому что осталось верным: шаги и описание схемы говорят о кнопке, «Сам прогон не начинается никогда»
(`autopilot.md:39`). Новое событие журнала `ticket-status` (11) Topic не перечисляет: шаг 5 называет журнал без списка событий.

**skeleton** («How the Guide works», тестовый Topic, в собранном приложении не показан) — `docs/features/app-shell.md`,
`ca34275a` → `8c6fc399`:

| Где | Фраза | Источник |
|---|---|---|
| `summary[0]` | Наведите указатель на блок — подсветятся он и его связи; Play проходит по шагам | `app-shell.md:401-403` (worfy-guide 04) |
| `summary[1]` | Открыть можно ещё по ссылке worfy Guide в Getting started и на странице понятий First run | `app-shell.md:390-392` (worfy-guide 09) |

Номер сборки в Settings (worfy-update 14) этот Topic не описывает.

### Только новый SHA: страница поменялась, а сказанное в Topic-е — нет

| Topic | Страница, SHA | Что поменялось на странице |
|---|---|---|
| cards | `cards.md` `02be335e` → `ee30655f` | строка `autopilot_start` в таблице инструментов Canvas MCP; Topic называет только `create_card` |
| harness | `harness.md` `8c6fc399` → `1745e4bb`; `skills-agents-and-hooks.md` `3f662f1c` → `1745e4bb` | условия запуска qmd (node 22.14+) и hook `qmd-refresh` на Windows; Topic говорит о qmd только «поиск по документам» |
| link | `link.md` `c1ea91d9` → `9d967195` | окно старой сборки получает «answered outside the contract», когда ответ канала расширен; Topic этого случая не касается |
| terminal | `terminal.md` `a36324a0` → `d2ca34cf` | Git Bash дописывает историю после каждой команды (`PROMPT_COMMAND`); Topic историю Git Bash не описывает |
| the-window-and-your-data | `app-shell.md` `058d618b` → `8c6fc399`; `notifications.md` `41f4e01b` → `9d967195` | номер сборки в Settings; toast-ы обходят шапку рамки Epic-а; Topic не говорит ни о версии, ни о месте toast-ов |

### Схемы — описание, не сделано

- autopilot: в Scene и Flow вход один — кнопка. Можно добавить блок «Chat» (группа `agents`, как Session) со связью к Run
  «/worfy:epic-wave, autopilot_start», а во Flow — `agent.send` → `startFromChat` → Run. По брифу GUI-проверок нет, поэтому
  схема не правилась.
- skeleton: в схеме два входа, меню и Command palette; третий — ссылка worfy Guide в Getting started и First run.

### Прочее

- `spec.md`, «Готово, когда»: отмечены шесть пунктов с доказательствами; пункт аудита сделал orchestrator. Открыт только
  README (Ticket 21).
- `HANDOFF.md`: строка `worfy-guide` — 19/21; `node scripts/check-handoff.mjs` — exit code 0. Файл у предела 15360 байт, поэтому
  строка короткая.
- Статусы Ticket-ов CLI `ticket` не менялись: это делает orchestrator.
- Токены автора: ~110 тыс. контекста (оценка).
