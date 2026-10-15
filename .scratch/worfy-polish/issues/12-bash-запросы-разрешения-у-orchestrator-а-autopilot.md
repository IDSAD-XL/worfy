# 12 — Запросы разрешения Bash, на которых Orchestrator Autopilot теряет ход: какие команды и что поправить

Type: research
Status: blocked — research: ведёт Session Orchestrator-а, итог — отчёт в `docs/research/`; Autopilot не берёт (spec, «Соглашения», «Кто ведёт»)
Blocked by: —
Source: [spec.md](../spec.md), кандидат R1 и решение 2; журналы Autopilot на Mac владельца
(`~/Library/Application Support/worfy/autopilot/*.jsonl`, только чтение);
[ADR-0046](../../../docs/adr/0046-autopilot-narrow-round-without-owner.md).

## Что происходит

- Autopilot не отвечает на диалоги Session-а Orchestrator-а: запрос разрешения он отклоняет и пишет в
  журнал событие `refused-dialog` (`src/shared/autopilot/journal.ts`, `JOURNAL_EVENT_KINDS`).
- В журналах на Mac владельца (2026-10-15) таких событий 6: 4 — `permission_request Bash`
  (2026-10-06 13:17 и 18:18, 2026-10-08 06:20, 2026-10-14 01:23), 2 — `permission_request
  AskUserQuestion`. Все — в одной Session Orchestrator-а (`f6ab7045…`), Epic-и `worfy-daily`,
  `worfy-harness`, `worfy-terminal-ai`.
- Какую команду Bash спрашивали, журнал не пишет (`what` — только вид диалога). Отказ стоит
  Orchestrator-у хода: он видит отказ и ищет обход, или Wave встаёт.

## Вопросы

1. Какие 4 команды Bash вызвали запрос? Источник — транскрипт Session-а Orchestrator-а
   (`~/.claude/projects/<cwd>/f6ab7045-….jsonl`), записи вокруг времени каждого `refused-dialog`.
2. Почему разрешения не хватило: команды нет в allowlist Profile-а или Harness, команда составная
   (pipe, `cd &&`), сработал guard Harness, путь вне worktree?
3. Что поправить, по каждой команде: (а) Orchestrator зовёт другую, уже разрешённую команду — правка
   prompt-а или skill-а Harness; (б) команду добавить в allowlist; (в) ничего — отказ правильный.
4. Стоит ли писать в `refused-dialog` саму команду (без секретов, обрезанную) — правка worfy, тогда
   отдельный Ticket.

## Как делаем

- Только чтение журналов и транскриптов; ни одного запуска Claude Code или Autopilot.
- В отчёт идут команды (без токенов, личных путей и секретов — заменить на `<…>`), время, Epic и вывод,
  а не куски транскрипта.
- Отчёт — `docs/research/2026-10-NN-bash-запросы-разрешения-autopilot.md`; дата — день написания.

## Готово, когда

- [ ] Отчёт отвечает на вопросы 1–4 по каждому из 4 событий; если команду найти не удалось — так и
      сказано, с причиной.
- [ ] По каждой предложенной правке сказано, где она: Harness (`harness/`), Profile worfy, worfy (`src/`).
      Правки Harness и Profile — только предложение: их делают по слову владельца.
- [ ] (вручную) Владелец прочёл отчёт и решил по правкам; решение — в «Итог».

## Где в коде

- `docs/research/2026-10-NN-bash-запросы-разрешения-autopilot.md`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/shared/autopilot/journal.ts`, `src/main/autopilot/run.ts`, `harness/`.

## Вне скоупа

- Сами правки Harness и Profile.
- Диалоги `AskUserQuestion`: их отказ — замысел Autopilot (без человека).

## Итог

—
