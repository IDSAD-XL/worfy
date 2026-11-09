# 05 — Что Harness делает без приложения и где ему нужно приложение

Type: research
Status: done 2026-11-08T22:38Z
Blocked by: —
Source: [map.md](../map.md); решение владельца 2026-11-08 по идее 2: «харнесс и так способен работать без
приложения, определим что нужно что бы это было полноценно (например добавление проекта без приложения)»;
[docs/features/harness.md](../../../features/harness.md)

## Question

Что из Harness уже работает в обычном Claude Code без приложения worfy, а где он опирается на приложение: установка и
обновление plugin-а, подключение Project-а, profile и registry gate, skills и hooks, которые зовут MCP-серверы
приложения или его пути и переменные окружения? Чего не хватает, чтобы Harness работал без приложения полноценно, и
сколько это примерно Ticket-ов?

Заметка: [research-harness-без-приложения.md](../research-harness-без-приложения.md).

## Answer

Заметка 2026-11-08, разделы 1, 8 и 9:

- Ядро Harness работает без приложения: hooks, Gate, скрипты `bin/` и Profile к приложению не обращаются; Wave
  в обычном Claude Code проходит `/worfy:epic-wave` до PR и merge.
- Установка и обновление plugin-а, qmd и проверки первого запуска есть только в приложении. Из GitHub plugin одной
  командой не поставить: `marketplace.json` лежит в `harness/.claude-plugin/`, а не в корне репозитория.
- `/worfy:connect-project` в терминале работает, но просит человека самого запустить `project-connect --facts` и
  не задаёт аккаунт GitHub.
- Ошибка и в приложении: шаблон `/worfy:to-tickets` не пишет секцию «Done when», а `ticket evidence` читает именно её
  (проверено: `harness/bin/TICKETS.md`, раздел Evidence; в `harness/skills/to-tickets/SKILL.md` такой секции нет).
- Только в приложении: Autopilot (цепочка Wave-ов без человека), notifications, экран Mind map. Status line
  терминала указывает на скрипт внутри `.app` (проверено в `~/.claude/settings.json`).
- Размер: ядро — 11–12 Ticket-ов; Autopilot, notifications и Mind map — ещё 4–8; Codex без приложения — 1–2.
