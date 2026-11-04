# 06 — Переключатель Off / Shadow / On

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Что видит владелец», п. 1; «Решено без владельца», п. 3; «Безопасность», п. 5; «Соседний Epic worfy-retry»; Q1

Глубина ревью: high (кто может включить одобрение).

## Что происходит

- Образец — Eco mode: composer item `src/renderer/session/composer/EcoMode.tsx` (`order = 15`, класс `w-eco`
  `:110-127`, `ECO_MODE_ELSEWHERE` `:23`), IPC `ecoMode` (`src/shared/ipc/eco-mode.ts`, `src/main/ipc/eco-mode.ts`,
  каналы `local`). Eco mode пишет Profile через Harness; Auto-approval этого делать не должен (spec, «Решено», п. 3).
- Настройки Machine — `app-settings.json` (`src/main/settings/store.ts`, ADR-0005); worfy-retry 02 кладёт туда же
  `autoContinue` по id Project-а.

## Что делаем

1. Поле `autoApproval: Record<projectId, 'off' | 'shadow' | 'on'>` в `app-settings.json`
   (`src/shared/settings/app-settings.ts`, `src/main/settings/store.ts`); нет записи — `off`; значение вне схемы —
   `off`.
2. IPC `autoApproval.read` / `autoApproval.set` (`src/shared/ipc/auto-approve.ts`, `src/main/ipc/auto-approve.ts`),
   каналы `local`: с Linked machine не пишется. Функция `autoApprovalMode(projectId)` для Ticket-а 04.
3. Composer item `src/renderer/session/composer/AutoApprove.tsx`, `order = 17`, только у Orchestrator-а; три
   положения Off / Shadow / On; tooltip на каждое; в окне Linked machine read-only с текстом «Auto-approval is set in
   worfy on the Machine of the Project». Вид — рядом с `w-eco`, свой модификатор для трёх положений (`w-eco` не
   меняется).
4. Проверить и записать в «Итог», читает ли `store.ts` файл заново при чужой правке (spec, «Безопасность», п. 5).
   Если читает — режим Auto-approval берётся из памяти, записанной UI, а правка файла извне видна только после
   рестарта.
5. Строка в инвентаре состояния worfy (`docs/adr/0005-worfy-own-state-inventory.md`).

## Готово, когда

- [ ] Unit test компонента: три положения, клик пишет через IPC, read-only на Linked machine, нет у обычной Session.
- [ ] Contract test настройки: нет файла — `off`; мусор — `off`; запись одного Project-а не трогает другие и
      `autoContinue`.
- [ ] Contract test: канал не принимает запись с Linked machine.
- [ ] Ответ про перечитывание `app-settings.json` — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/auto-approve-switch.test.tsx`, contract `test/contract/auto-approve-setting.test.ts` (новые).
- Прогнать test-ы Eco mode и настроек: `test/unit/eco-mode*.test.tsx`, `test/contract/*settings*.test.ts`.

## Где в коде

- `src/shared/settings/app-settings.ts`, `src/main/settings/store.ts` (общие с worfy-retry 02 — не параллельно)
- `src/shared/ipc/auto-approve.ts`, `src/main/ipc/auto-approve.ts` (новые)
- `src/renderer/session/composer/AutoApprove.tsx` (новый), `src/renderer/session/session.css`
- `docs/adr/0005-worfy-own-state-inventory.md`
- `test/unit/auto-approve-switch.test.tsx`, `test/contract/auto-approve-setting.test.ts` (новые)
