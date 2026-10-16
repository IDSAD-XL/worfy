# 12 — Запросы разрешения Bash, на которых Orchestrator Autopilot теряет ход: какие команды и что поправить

Type: research
Status: done — 2026-10-15, [PR #338](https://github.com/IDSAD-XL/worfy/pull/338)
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

- [x] Отчёт отвечает на вопросы 1–4 по каждому из 4 событий; если команду найти не удалось — так и
      сказано, с причиной.
- [x] По каждой предложенной правке сказано, где она: Harness (`harness/`), Profile worfy, worfy (`src/`).
      Правки Harness и Profile — только предложение: их делают по слову владельца.
- [ ] (вручную) Владелец прочёл отчёт и решил по правкам; решение — в «Итог».

## Где в коде

- `docs/research/2026-10-15-bash-запросы-разрешения-autopilot.md`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/shared/autopilot/journal.ts`, `src/main/autopilot/run.ts`, `harness/`.

## Вне скоупа

- Сами правки Harness и Profile.
- Диалоги `AskUserQuestion`: их отказ — замысел Autopilot (без человека).

## Итог

Отчёт: [docs/research/2026-10-15-bash-запросы-разрешения-autopilot.md](../../../docs/research/2026-10-15-bash-запросы-разрешения-autopilot.md).

Решения владельца 2026-10-15 по «Предложениям» отчёта: 1 — Ticket [26](26-причина-и-subagent-в-отказе-разрешения-autopilot.md); 2 — `worfy-harness` 48 (правило в `harness/hooks/rules/common.md`); 3 (guard) — отложен: делать, только если правило будут нарушать; allowlist — не предлагается.

**Команды.** Все четыре запроса пришли не от Orchestrator-а, а от его фоновых Subagent-ов. Claude
Code передаёт их запросы разрешения в `canUseTool` Session-а Orchestrator-а. Пути ниже сокращены.

1. 2026-10-06 13:17 UTC, `worfy-daily`, `impl-10`: `cd /tmp/worfy-wave6/impl-10/trace && rm -rf * &&
   unzip …` — `rm` с glob после `cd`.
2. 2026-10-06 18:18 UTC, `worfy-daily`, `verify-11-r2` (reviewer): `for d in shot mut; do rm -rf
   $R/$d; …` — переменные в цели `rm`.
3. 2026-10-08 06:20 UTC, `worfy-harness`, `impl-22`: `M=$(mktemp -d …); … rm -rf "$M/$mut"` —
   переменная из command substitution в цели `rm`.
4. 2026-10-14 01:23 UTC, `worfy-terminal-ai`, `impl-tai-03`: `cd /tmp/… && zsh -f -c '<script с
   zmodload, setopt, autoload>'` — встроенный script для `-c`, который Claude Code не смог проверить
   (вывод, запуском не проверен).

**Причина.** Во всех четырёх случаях сработала проверка Claude Code на опасное удаление
(`dangerousRemoval`). Она спрашивает и в `bypassPermissions` (`bypassImmune`), и её нельзя разрешить
правилом allowlist. Session Autopilot идёт в `bypassPermissions`
(`src/main/agent/session-settings.ts:41-42`), а его `canUseTool` — это `unattendedCanUseTool`
(`src/main/agent/session.ts:306-308`). Тот отказывает сразу (`src/main/agent/permissions.ts:59-64`)
одним и тем же текстом без причины (`src/main/agent/permissions.ts:34-35`). Журнал пишет только вид
диалога и имя инструмента (`src/main/autopilot/run.ts:745-746`). Guard Harness ни при чём: он умеет
только `deny` (`harness/hooks/guard.mjs:32`). Отказ верен. Цена — один вызов: каждый Subagent за 3–16 с
переписал команду, ход Orchestrator-а не пострадал.

**Правки (предложение).**

- worfy (`src/`), новый Ticket, его может взять Autopilot. `unattendedCanUseTool` читает
  `decisionReason` и `agentID` из options SDK. Причина идёт в ответ модели. В `refused-dialog` пишутся
  `agent` и обрезанная `reason`, а не сама команда.
- Harness — решает **владелец**. Расширить правило «Delete only by a literal path»
  (`harness/agents/implementer.md:63-67`, `harness/agents/reviewer.md:122-125`): никаких переменных в
  цели `rm`; script для `-c` — в файл. Перенести правило в `harness/hooks/rules/common.md`. По
  желанию — то же правило в `harness/hooks/guard.mjs`. Правило из случая 3 уже было в prompt-е, и
  агент его нарушил.
- Profile worfy — ничего: allowlist эту проверку не снимает.

Решение владельца: —
