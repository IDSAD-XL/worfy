# 03 — Список Remote host-ов в собственном состоянии worfy и раздел в Settings → «Terminal AI»

Type: task
Status: open
Blocked by: 01
Source: решения владельца 2026-10-18: пункты 2 (интеграция только на включённых Remote host-ах), 3 («Не спрашивать для этого хоста»), 4 (переключатель отправки на каждом Remote host-е) ([spec.md](../spec.md)); допущение 1 (список — состояние worfy на Machine, ADR-0005, виден в Settings); «Решено без владельца», пункты 4–6; [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md)

## Что происходит

- Settings Terminal AI хранятся в `<WORFY_DATA_DIR>/terminal-ai.json`
  (`src/main/terminal-ai/settings.ts:1,15`), чтение и запись — `src/main/storage/json-file`.
- Раздел окна Settings — `src/renderer/settings/TerminalAiSection.tsx`.
- Списка Remote host-ов нет.

## Что делаем

1. **Схема** — `src/shared/terminal-ai/hosts.ts` (новый): `{host, enabled, send, dontAsk}`. `host` —
   ключ из `ssh -G` (Ticket 02). `send` по умолчанию `true` («Решено без владельца», пункт 6).
2. **Хранение** — `src/main/terminal-ai/hosts.ts` (новый): `<WORFY_DATA_DIR>/terminal-ai-hosts.json`.
   Отдельный файл, а не `terminal-ai.json`: его правят Ticket-ы этого Epic-а, Settings — Epic
   `worfy-terminal-ai`. Испорченный файл — пустой список и запись в лог, а не ошибка.
3. **Каналы** — `src/shared/ipc/terminal-ai-hosts.ts`, `src/main/ipc/terminal-ai-hosts.ts` (новые):
   `terminalAi.hosts.list`, `terminalAi.hosts.set {host, enabled?, send?, dontAsk?}`,
   `terminalAi.hosts.remove {host}`, событие `terminalAi.hosts.changed`. Пометка — `local`.
4. **Settings** — `src/renderer/settings/TerminalAiHosts.tsx` (новый), подключён в
   `TerminalAiSection.tsx`. Список: имя, переключатель «Terminal AI включён», отметка «Не
   спрашивать» с кнопкой снять, кнопка удалить. Пустой список — строка «Remote host-ы появятся
   здесь после входа по ssh». Переключатель отправки — Ticket 08.

**Не входит:** баннер (Ticket 05), переключатель отправки в UI (Ticket 08), использование списка
обёрткой (Ticket 04).

## Готово, когда

- [ ] Unit `test/unit/terminal-ai-hosts.test.ts` (новый): set создаёт запись с `send: true`; второй set
  меняет только переданные поля; remove удаляет; запись — в `WORFY_DATA_DIR` временной папки и
  больше нигде (ADR-0005); испорченный JSON — пустой список; событие `terminalAi.hosts.changed` после
  каждой записи; каналы помечены `local`.
- [ ] Unit (jsdom) `test/unit/terminal-ai-hosts-section.test.tsx` (новый): список из двух Remote
  host-ов; переключатель «Terminal AI включён» зовёт `terminalAi.hosts.set`; «Не спрашивать» снимается;
  удалить — `terminalAi.hosts.remove`; пустой список — строка-подсказка.
- [ ] e2e `test/e2e/terminal-ai-hosts.spec.ts` (новый): файл `terminal-ai-hosts.json` с одним Remote
  host-ом — Settings → «Terminal AI» показывает его; выключение переживает перезапуск приложения.
- [ ] (вручную) `WORFY_AGENT=fake pnpm dev`: список в светлой и тёмной теме —
  `../evidence/03-hosts-light.png`, `../evidence/03-hosts-dark.png`. Как проверить: окно Settings.
- [ ] `test/e2e/terminal-ai-settings.spec.ts` зелёный без правки ожиданий.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

## Тесты

Сначала падающий test — unit «set создаёт запись с `send: true`»: модуля ещё нет. Потом каналы,
раздел Settings, e2e.

## Где в коде

- `src/shared/terminal-ai/hosts.ts` (новый)
- `src/main/terminal-ai/hosts.ts` (новый)
- `src/shared/ipc/terminal-ai-hosts.ts` (новый)
- `src/main/ipc/terminal-ai-hosts.ts` (новый)
- `src/renderer/settings/TerminalAiHosts.tsx` (новый)
- `src/renderer/settings/TerminalAiSection.tsx`
- `test/unit/terminal-ai-hosts.test.ts` (новый)
- `test/unit/terminal-ai-hosts-section.test.tsx` (новый)
- `test/e2e/terminal-ai-hosts.spec.ts` (новый)

## Итог

Заполняется по завершении Ticket-а.
