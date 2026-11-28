# 04: Порог Limits для scheduled run-ов — глобальный и свой у Schedule

Type: task
Status: open
Blocked by: 03
Source: [spec.md](../spec.md), «Ticket-ы», 04; «Решения по реализации» («Limits»); решения владельца Q14, Q18 (в)
grilling-а и Q2, Q6 spec-а; «Волны», Wave 3

Кто: агент. Глубина ревью — `medium`.

## Что происходит

- Проверка Limits перед автоматическим вызовом — `src/main/agent/limits-gate.ts` (`AUTOMATIC_SHARE_LIMIT = 0.8`, вид
  `automatic`). Порог один и не настраивается.
- Q18 (в): глобальный порог в Settings (5-часовое окно 80 %, недельный — по желанию, выключен) и необязательный свой у
  Schedule. Q2 spec-а: проверка только перед стартом.

## Что строить

- `src/main/schedules/limits.ts`: `mayStart(schedule)` → ok или `{ window, share, threshold }`. Порог — свой у Schedule,
  иначе глобальный. Окна по Vendor-у: Claude — 5 часов и 7 дней; Codex — primary и secondary. Доля на пороге или
  выше — нельзя. Нет данных — как `limits-gate` для `automatic`.
- Settings → Schedules: «5-hour window threshold» (по умолчанию 80 %), «Weekly threshold» (выключен по умолчанию,
  значение по включении). Поле в app settings (ADR-0005), канал `local`.
- Поле порога в схеме Schedule (Ticket 03) — «Global» или свои значения; UI поля — Ticket 08.
- Отдельного предела на одновременные run-ы нет (Q6 spec-а).

## Где в коде

- `src/main/schedules/limits.ts` (новый), `src/main/agent/limits-gate.ts` (только чтение)
- `src/shared/settings/` — поле настроек; `src/renderer/settings/` — раздел Schedules (имя файла — предложение)
- `test/unit/schedule-limits.test.ts` (новый)

## Test-ы

- Unit: глобальные 80 %; недельный выключен и включён; порог Schedule поверх глобального; окна Codex; нет данных; ровно
  на пороге — нельзя.
- Unit UI раздела Settings: значения по умолчанию.
- Сначала падающий test. Limits — fixture `limits.json` во временном `WORFY_DATA_DIR`.

## Готово, когда

- [ ] `mayStart` отвечает по глобальному порогу или по порогу Schedule для окон Claude и Codex.
- [ ] Settings → Schedules показывает оба порога: 80 % и выключенный недельный.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
