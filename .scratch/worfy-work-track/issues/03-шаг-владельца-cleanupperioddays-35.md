# 03 — Шаг владельца: `cleanupPeriodDays` Claude Code — 35 дней

Type: task
Status: blocked 2026-11-05T19:30Z
Blocked reason: owner step: set cleanupPeriodDays 35 in ~/.claude/settings.json on the Mac
Waits: owner
Blocked by:
Source: [spec.md](../spec.md), «Решения владельца», 5; «Открытые вопросы», 3; [research 04](../../worfy-autopilot-queue/issues/04-данные-work-track.md), «Пробелы», 4; [06](../../worfy-autopilot-queue/issues/06-объём-и-доступ-work-track.md), Q2

## Что происходит

- Claude Code удаляет транскрипты, не тронутые `cleanupPeriodDays` дней (по умолчанию 30; в `~/.claude/settings*.json`
  на Mac не задан — research 04). Окно Month Work track стоит на самой границе: Session, в которую не писали 30 дней,
  пропадает целиком вместе с Subagent-ами.
- worfy не пишет в `~/.claude` (ADR-0005); агентам запись туда без слова владельца запрещена.

## Что делаем

1. Владелец добавляет `"cleanupPeriodDays": 35` в `~/.claude/settings.json` на Mac (ПК — по желанию: Work track первой
   версии ПК не читает).
2. Цена — диск: около 4 GB транскриптов в месяц у worfy (research 04), +5 дней — около +0.7 GB.
3. Orchestrator после шага проверяет строку (только чтение) и закрывает Ticket: `ticket done worfy-work-track 03`.

## Готово, когда

- [ ] В `~/.claude/settings.json` на Mac — `cleanupPeriodDays` 35 (вручную).

## Тесты

- Нет: это настройка владельца.

## Где в коде

- `.scratch/worfy-work-track/issues/03-шаг-владельца-cleanupperioddays-35.md`
