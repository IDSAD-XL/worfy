# 02 — Настройка Auto-continue и пункт меню Modes в чате Orchestrator-а

Type: task
Status: done 2026-11-05T18:10Z
PR: #1437
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
  - evidence: test-run pass · `pnpm test test/unit/modes-menu.test.tsx` exit 0 · mac - · bb1dd8947
  - evidence: test-run pass · `pnpm test test/unit/modes-menu.test.tsx` exit 0 · mac - · 471f4bec3
- [ ] Off по умолчанию; on пишет запись Project-а в `app-settings.json`, off её удаляет; другой Project не меняется.
  - evidence: test-run pass · `pnpm test test/contract/auto-continue-setting.test.ts` exit 0 · mac - · bb1dd8947
  - evidence: test-run pass · `pnpm test:e2e test/e2e/auto-continue.spec.ts test/e2e/session-controls.spec.ts test/e2e/eco-mode.spec.ts test/e2e/auto-approve.spec.ts test/e2e/context-meter.spec.ts` exit 0 · mac dev · bb1dd8947
- [ ] Перезапуск приложения — состояние то же.
  - evidence: test-run pass · `pnpm test test/contract/auto-continue-setting.test.ts` exit 0 · mac - · bb1dd8947
  - evidence: test-run pass · `pnpm test:e2e test/e2e/auto-continue.spec.ts test/e2e/session-controls.spec.ts test/e2e/eco-mode.spec.ts test/e2e/auto-approve.spec.ts test/e2e/context-meter.spec.ts` exit 0 · mac dev · bb1dd8947
- [ ] Linked machine — до Ticket-а 13 как сегодня: пункт недоступен с tooltip-ом, ничего не прочитано и не записано.
  - evidence: test-run pass · `pnpm test test/unit/modes-menu.test.tsx` exit 0 · mac - · bb1dd8947
  - evidence: test-run pass · `pnpm test test/contract/auto-continue-setting.test.ts` exit 0 · mac - · bb1dd8947
  - evidence: test-run pass · `pnpm test test/unit/modes-menu.test.tsx` exit 0 · mac - · 471f4bec3
- [ ] Кнопка «Modes» показывает три иконки; ширина одинакова при любом сочетании состояний.
  - evidence: test-run pass · `pnpm test test/unit/modes-menu.test.tsx` exit 0 · mac - · bb1dd8947
  - evidence: test-run pass · `pnpm test:e2e test/e2e/auto-continue.spec.ts test/e2e/session-controls.spec.ts test/e2e/eco-mode.spec.ts test/e2e/auto-approve.spec.ts test/e2e/context-meter.spec.ts` exit 0 · mac dev · bb1dd8947
  - evidence: test-run pass · `pnpm test:e2e test/e2e/auto-continue.spec.ts test/e2e/session-controls.spec.ts test/e2e/eco-mode.spec.ts test/e2e/auto-approve.spec.ts test/e2e/context-meter.spec.ts` exit 0 · mac dev · 471f4bec3
- [ ] Снимки кнопки и меню в светлой и тёмной теме (on и off); ширины окна 800–1600 px с открытым sidebar — ни один
      элемент строки не выпадает, Send на строке pickers от 1220 px, по правилу Ticket-а 12
      (`test/e2e/session-controls.spec.ts:315`, `test/e2e/context-meter.spec.ts:128`).
  - evidence: screenshot pass · `../evidence/02-modes-continue-off-light.png` · mac dev · bb1dd8947fb399e53c9fa666fa772b8691377e99 · scrub: 2026-11-05
  - evidence: screenshot pass · `../evidence/02-modes-continue-off-dark.png` · mac dev · bb1dd8947fb399e53c9fa666fa772b8691377e99 · scrub: 2026-11-05
  - evidence: screenshot pass · `../evidence/02-modes-continue-on-light.png` · mac dev · bb1dd8947fb399e53c9fa666fa772b8691377e99 · scrub: 2026-11-05
  - evidence: screenshot pass · `../evidence/02-modes-continue-on-dark.png` · mac dev · bb1dd8947fb399e53c9fa666fa772b8691377e99 · scrub: 2026-11-05
  - evidence: screenshot pass · `../evidence/02-modes-menu-continue-off-light.png` · mac dev · bb1dd8947fb399e53c9fa666fa772b8691377e99 · scrub: 2026-11-05
  - evidence: screenshot pass · `../evidence/02-modes-menu-continue-off-dark.png` · mac dev · bb1dd8947fb399e53c9fa666fa772b8691377e99 · scrub: 2026-11-05
  - evidence: screenshot pass · `../evidence/02-modes-menu-continue-on-light.png` · mac dev · bb1dd8947fb399e53c9fa666fa772b8691377e99 · scrub: 2026-11-05
  - evidence: screenshot pass · `../evidence/02-modes-menu-continue-on-dark.png` · mac dev · bb1dd8947fb399e53c9fa666fa772b8691377e99 · scrub: 2026-11-05
  - evidence: test-run pass · `pnpm test:e2e test/e2e/auto-continue.spec.ts test/e2e/session-controls.spec.ts test/e2e/eco-mode.spec.ts test/e2e/auto-approve.spec.ts test/e2e/context-meter.spec.ts` exit 0 · mac dev · bb1dd8947
  - evidence: test-run pass · `pnpm test:e2e test/e2e/auto-continue.spec.ts test/e2e/session-controls.spec.ts test/e2e/eco-mode.spec.ts test/e2e/auto-approve.spec.ts test/e2e/context-meter.spec.ts` exit 0 · mac dev · 471f4bec3
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · bb1dd8947
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · bb1dd8947
  - evidence: gate pass · `gate fast` exit 0 · mac - · 471f4bec3

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
- `test/e2e/auto-approve.spec.ts` (tooltip кнопки кончается на «Auto-continue off») и `test/e2e/eco-mode.spec.ts` (три
  слота иконок без заливки, а не два) — правка одной строки в каждом из-за третьей иконки; Ticket 13 правит их же.

Только читать: `src/renderer/session/modes/eco-mode.ts`, `src/renderer/session/modes/auto-approval.ts`,
`src/renderer/session/composer/index.ts`, `src/main/ipc/auto-approve.ts`.

## Итог

Настройка `autoContinue` в `app-settings.json` (`{ [projectId]: true }`, нет записи — выключено): схема в
`src/shared/settings/app-settings.ts` (`autoContinueOf`), запись — только `setAutoContinue()` store-а
`src/main/settings/store.ts`, мимо `appSettings.set`; файл старой версии без поля и любой мусор в поле читаются как
«выключено». Чтение для Ticket-ов 04–06 — `autoContinueOn(projectId)` того же файла. Канал
`src/shared/ipc/auto-continue.ts` (`autoContinue.read`, `autoContinue.set`, событие `autoContinue.changed`, все `local`),
main — `src/main/ipc/auto-continue.ts`. Третий пункт меню Modes — hook `useAutoContinue` в
`src/renderer/session/modes/auto-continue.ts`, пункт и третья иконка — в `src/renderer/session/composer/Modes.tsx`.
Поведения повтора нет. Test-ы: contract `test/contract/auto-continue-setting.test.ts`, unit
`test/unit/modes-menu.test.tsx` (новый блок «Auto-continue in the menu» и правки старых случаев под три иконки),
e2e `test/e2e/auto-continue.spec.ts` (on/off, файл, перезапуск, 64 сочетания состояний — одна ширина),
`test/e2e/session-controls.spec.ts` (три иконки внутри кнопки при каждой ширине). Страница
`docs/features/sessions.md` дополнена пунктом Auto-continue.

Снимки (Playwright fixture build, `captureScreenshot`): кнопка off — [светлая](../evidence/02-modes-continue-off-light.png),
[тёмная](../evidence/02-modes-continue-off-dark.png); кнопка on — [светлая](../evidence/02-modes-continue-on-light.png),
[тёмная](../evidence/02-modes-continue-on-dark.png); меню off — [светлая](../evidence/02-modes-menu-continue-off-light.png),
[тёмная](../evidence/02-modes-menu-continue-off-dark.png); меню on — [светлая](../evidence/02-modes-menu-continue-on-light.png),
[тёмная](../evidence/02-modes-menu-continue-on-dark.png). Пиксели проверил implementer (агент), не человек.

### Решено без владельца

- **Send на строке pickers — от 1220 px, как в Ticket-е 12**, а не 800–1600 px из текста тикета: пункт «Готово, когда»
  сужен так же. С третьей иконкой в слоте 14 px кнопка без подписи стала 58 px, и Send уходил со строки pickers ниже
  1230 px (замер probe-test-ом Playwright каждые 10 px при 1100–1400 px, высоте 800 px, открытом sidebar). Поэтому слот
  сужен до 12 px (иконка по-прежнему 10 px), промежуток — с 2 до 1 px, поля кнопки — с 6/4 до 5/3 px: кнопка без подписи
  48 px (с двумя слотами по 14 px была 42 px). Замер каждые 2 px при 1190–1240 px: Send держится на строке pickers
  до 1212 px. `nothingLost` по-прежнему проверяет весь диапазон 800–1600 px через 20 px.
- **Иконка Auto-continue** — круговая стрелка; on — зелёная «ready», off — приглушённая, как у Eco mode.
- **Имя и tooltip кнопки** добавляют третье состояние: «Modes: Eco mode on, Auto-approval shadow, Auto-continue off»;
  неизвестное состояние названо причиной, как у двух других («being read», «not available»). В окне Linked machine,
  когда все три пункта только для чтения, имя остаётся одной фразой «Modes: set on the Machine of the Project».
- **Пункт стоит последним, после черты**, отдельным `menuitemcheckbox` со строкой «Retry after API errors and Limits»;
  полный текст — tooltip из spec-а (`AUTO_CONTINUE_TITLE`). Отмеченный пункт выделен зелёным, как Eco mode.
- **Read only** — как у Eco mode: подсказка `useReadOnly`; окно Linked machine без Read only — tooltip
  «Auto-continue is set in worfy on the Machine of the Project». В обоих случаях ничего не читается, не пишется и нет
  подписки на `autoContinue.changed`.
- **Рассылка смены** — своё событие `autoContinue.changed` `{ projectId, on }`, а не общее `appSettings.changed`:
  открытое меню любого окна этой Machine обновляется сразу. Событие уходит только когда запись что-то поменяла.
- **Debugging port не выключает Auto-continue**, в отличие от Auto-approval: он лишь шлёт Orchestrator-у «continue»
  и не отвечает на запросы разрешений. Поэтому e2e под Playwright включает и выключает пункт по-настоящему.
- **Ключи записи — те же Project id, что у Auto-approval** (`autoApprovalProjectIdSchema`): отдельную схему не заводил.
- **Красный test сначала — contract и unit**, не e2e: `auto-continue-setting.test.ts` и `modes-menu.test.tsx` падали на
  отсутствии модулей до кода; e2e на старом коде не гонялся (отдельная сборка старого дерева).
- **Правка двух e2e вне следа тикета**: `test/e2e/auto-approve.spec.ts` (tooltip кнопки теперь кончается на
  «Auto-continue off») и `test/e2e/eco-mode.spec.ts` (слотов без заливки три, а не два). Без них оба падали на третьей
  иконке; смысл проверок тот же.
- **Раунд 2 ревью (четыре low).** Unit test окна Linked machine проверяет, что подписки на `autoContinue.changed` нет
  (fake bridge считает подписки); новый случай — подписка есть, пока кнопка видна, и снимается с ней. Unit test-ы
  проверяют черту перед пунктом, ключ `data-item="auto-continue"`, подпись и строку пункта, а отдельный случай читает
  `session.css`: правило отмеченного пункта называет этот ключ. В `nothingLost` каждая иконка целиком внутри своего
  слота (иконка не уже 9.5 px), а слот — внутри кнопки. Две e2e-spec вне следа добавлены в «Где в коде». Mutants
  ревью R2, X14, X15, X16 (unit и contract) и E3 (слот Auto-continue шириной 2 px, e2e session-controls) теперь убиты.
- **Опись состояния в ADR-0005 не правил**: ADR — дело Orchestrator-а; строку про поле `autoContinue` нужно добавить при
  merge, как для `autoApproval` 2026-11-04.

