# 02 — Настройка Auto-continue и пункт меню Modes в чате Orchestrator-а

Type: task
Status: open
Blocked by: 12
Source: [spec.md](../spec.md), «Что видит владелец», п. 1–2; «Как работает» → «Где живёт»; «Вопросы владельцу», Q1, Q2; «Решения владельца 2026-11-05», Q10–Q13; [worfy-throughput 60](../../worfy-throughput/issues/60-переключатель-eco-mode-в-чате-orchestrator-а.md) (образец)

## Что происходит

- После Ticket-а 12 у Orchestrator-а во второй строке поля ввода одна кнопка «Modes» (`src/renderer/session/composer/Modes.tsx`)
  с меню из двух пунктов: Eco mode и Auto-approval; их логика — hook-и в `src/renderer/session/modes/`. Eco mode
  хранится в Profile проекта через `bin/profile-set` (`src/main/ipc/eco-mode.ts:1-9`), Auto-approval — в
  `app-settings.json` (`src/main/ipc/auto-approve.ts:1-5`).
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
3. **Третий пункт меню Modes** (Q13): «Auto-continue», `role="menuitemcheckbox"`, `aria-checked`, tooltip из spec-а;
   логика — hook `useAutoContinue(projectId)` в `src/renderer/session/modes/auto-continue.ts`, по образцу hook-ов
   Ticket-а 12. Кнопка «Modes» получает третью иконку состояния в постоянном слоте: on — яркая, off — приглушённая;
   ширина кнопки от состояния не зависит. Отдельного элемента строки (`AutoContinue.tsx`, порядок 16) нет. Окно Linked
   machine — до Ticket-а 13 как у двух других пунктов: ничего не читается, пункт недоступен с tooltip-ом
   «Auto-continue is set in worfy on the Machine of the Project», при Read only — подсказка `useReadOnly`.
4. Ошибка записи — toast с причиной, пункт показывает прочитанное заново.

Поведения повтора здесь нет: Ticket-ы 04–06 читают настройку.

## Готово, когда

- [ ] Пункт Auto-continue есть в меню Modes только у Orchestrator-а; в обычной Session меню нет.
- [ ] Off по умолчанию; on пишет запись Project-а в `app-settings.json`, off её удаляет; другой Project не меняется.
- [ ] Перезапуск приложения — состояние то же.
- [ ] Linked machine — до Ticket-а 13 как сегодня: пункт недоступен с tooltip-ом, ничего не прочитано и не записано.
- [ ] Кнопка «Modes» показывает три иконки; ширина одинакова при любом сочетании состояний.
- [ ] Снимки кнопки и меню в светлой и тёмной теме (on и off); ширины окна 800–1600 px с открытым sidebar — Send на
      строке pickers (`test/e2e/session-controls.spec.ts:315`, `test/e2e/context-meter.spec.ts:128`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Contract `test/contract/auto-continue-setting.test.ts`: запись и чтение во временной папке данных, старый файл без поля.
- Unit `test/unit/modes-menu.test.tsx` (файл Ticket-а 12): пункт Auto-continue — только у Orchestrator-а, состояние,
  недоступность, третья иконка, постоянная ширина.
- E2e `test/e2e/auto-continue.spec.ts`: меню Modes → Auto-continue on/off, `app-settings.json`, перезапуск;
  `test/e2e/session-controls.spec.ts` — ширины с тремя иконками.
- Сначала падающий: e2e — в меню Modes нет пункта Auto-continue.

## Где в коде

- `src/shared/settings/app-settings.ts`, `src/main/settings/store.ts`
- `src/shared/ipc/auto-continue.ts`, `src/main/ipc/auto-continue.ts` (новые)
- `src/renderer/session/modes/auto-continue.ts` (новый), `src/renderer/session/composer/Modes.tsx`,
  `src/renderer/session/session.css`
- `test/contract/auto-continue-setting.test.ts`, `test/e2e/auto-continue.spec.ts` (новые); `test/unit/modes-menu.test.tsx`,
  `test/e2e/session-controls.spec.ts`

Только читать: `src/renderer/session/modes/eco-mode.ts`, `src/renderer/session/modes/auto-approval.ts`,
`src/renderer/session/composer/index.ts`, `src/main/ipc/auto-approve.ts`, `test/e2e/auto-approve.spec.ts`.
