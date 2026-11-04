# 02 — Настройка Auto-continue и переключатель в чате Orchestrator-а

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Что видит владелец», п. 1–2; «Как работает» → «Где живёт»; «Вопросы владельцу», Q1, Q2; [worfy-throughput 60](../../worfy-throughput/issues/60-переключатель-eco-mode-в-чате-orchestrator-а.md) (образец)

## Что происходит

- Переключатель Eco mode — элемент второй строки поля ввода только Orchestrator-а
  (`src/renderer/session/composer/EcoMode.tsx`, порядок 15, `useOrchestratorViews` — `:137-143`; кнопка `role="switch"`,
  класс `w-eco` — `:107-127`; стиль — `src/renderer/session/session.css:1541`). Eco mode хранится в Profile проекта
  через `bin/profile-set` (`src/main/ipc/eco-mode.ts:1-9`).
- Настройки Machine — `app-settings.json` (`src/main/settings/store.ts:1-22`, схема
  `src/shared/settings/app-settings.ts`); `autopilotBudget` и `autopilotRun` хранят только то, что выбрал человек.
- Настройки Auto-continue нет.

## Что делаем (по рекомендациям Q1, Q2; ответ владельца может поменять)

1. **Поле `autoContinue`** в `app-settings.json`: `{ [projectId]: true }` — включён; нет записи — выключен (умолчание).
   Файл старой версии без поля читается как «везде выключен». Строка в описи состояния worfy (ADR-0005), если опись
   ведётся списком в ADR.
2. **Канал** `src/shared/ipc/auto-continue.ts`: `autoContinue.read({ projectId })` → `{ on }`,
   `autoContinue.set({ projectId, on })`; main — `src/main/ipc/auto-continue.ts`, рассылает смену всем окнам, как
   store настроек.
3. **Элемент** `src/renderer/session/composer/AutoContinue.tsx`, порядок 16 (справа от Eco mode, перед очередью):
   подпись «Auto-continue», `role="switch"`, иконки из тех же SVG, что у строки, tooltip из spec-а. Только у
   Orchestrator-а. Linked machine — недоступен с tooltip-ом «Auto-continue is set in worfy on the Machine of the
   Project», только чтение — `useReadOnly`, как Eco mode.
4. Ошибка записи — toast с причиной, переключатель возвращается.

Поведения повтора здесь нет: Ticket-ы 04–06 читают настройку.

## Готово, когда

- [ ] Переключатель есть только у Orchestrator-а; в обычной Session его нет.
- [ ] Off по умолчанию; on пишет запись Project-а в `app-settings.json`, off её удаляет; другой Project не меняется.
- [ ] Перезапуск приложения — состояние то же.
- [ ] Linked machine и только чтение — недоступен с tooltip-ом.
- [ ] Снимки строки в светлой и тёмной теме (on и off); ширины окна 800–1600 px — элементы строки не пропадают
      (`test/e2e/session-controls.spec.ts`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Contract `test/contract/auto-continue-setting.test.ts`: запись и чтение во временной папке данных, старый файл без поля.
- Unit `test/unit/auto-continue-switch.test.tsx`: только у Orchestrator-а, состояние, недоступность.
- E2e `test/e2e/auto-continue.spec.ts`: клик on/off, `app-settings.json`, перезапуск.
- Сначала падающий: e2e — переключателя нет.

## Где в коде

- `src/shared/settings/app-settings.ts`, `src/main/settings/store.ts`
- `src/shared/ipc/auto-continue.ts`, `src/main/ipc/auto-continue.ts` (новые)
- `src/renderer/session/composer/AutoContinue.tsx` (новый), `src/renderer/session/session.css`
- `test/contract/auto-continue-setting.test.ts`, `test/unit/auto-continue-switch.test.tsx`, `test/e2e/auto-continue.spec.ts` (новые)

Только читать: `src/renderer/session/composer/EcoMode.tsx`, `src/renderer/session/composer/index.ts`,
`src/main/ipc/eco-mode.ts`, `test/e2e/eco-mode.spec.ts`.
