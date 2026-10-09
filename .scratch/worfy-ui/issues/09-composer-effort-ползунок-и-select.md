# 09 — Composer: effort — ползунок, Model и Permission mode — Select

Type: task
Status: open
Blocked by: 08
Source: решение владельца 2026-10-09: 4 (effort — ползунок, как в приложении Claude Code, с уровнями выбранной модели; Model и Permission mode — стилизованные списки на общем Select; макет — `docs/design/F-session-dark.dc.html:177-179`) ([spec.md](../spec.md), «Как устроено», «Select»)

## Что происходит

- Три пикера composer-а — native `<select>` в `src/renderer/session/composer/Pickers.tsx`: модель
  (`:69-84`), effort (`:85-103`), режим разрешений (`:104-121`). Стили — `.w-pickers__select`
  (`src/renderer/session/session.css:772-794`). Pickers — часть composer-а по файлу
  (`export const order = 10`, `Pickers.tsx:14`).
- Модель. Список — из `supportedModels()` SDK: `modelOptions` (`src/main/agent/session.ts:155-163`)
  оставляет модели от sonnet и выше; у каждой — уровни effort (`supportedEffortLevels`). Сохранённая
  модель, которой нет в списке, всё равно показывается (`Pickers.tsx:55-56`). Список обновляется при
  фокусе (`onFocus={refresh}`, `:75`).
- Effort. Все уровни — `EFFORT_LEVELS = ['low','medium','high','xhigh','max']`
  (`src/shared/agent/settings.ts:13`); пикер показывает уровни выбранной модели (`Pickers.tsx:58`),
  плюс сохранённый уровень, которого у модели нет (`:59-60`). `null` — «effort default»; у модели без
  effort — «effort —» и пикер неактивен (`:90`, `:97`). Смена модели сбрасывает уровень, которого у
  новой нет (`:61-65`). Подсказка: Claude Code не сообщает применённый effort (`:88`). Уровень уходит
  в SDK при старте (`src/main/agent/options.ts:246`) и в живую Session
  (`applyFlagSettings`, `src/main/agent/session.ts:252`).
- Режимы разрешений — `PERMISSION_MODES` (`src/shared/agent/settings.ts:8`), подписи — `MODE_LABELS`
  (`Pickers.tsx:16-21`).
- Макет composer-а (`docs/design/F-session-dark.dc.html:177-179`): кнопки «Model Opus 5.5» и «Effort
  high» с подписью-префиксом и шевроном, «Permissions» — chip режима.
- После Ticket-а 08 есть `Select` (`src/renderer/theme/Select.tsx`) с `onOpen` и подписью-префиксом.
- Test-ы, которые выбирают в этих `<select>`:
  - `test/unit/session-view.test.tsx:467-512` (`fireEvent.change` по `picker-model`, `picker-effort`,
    `picker-permissions`);
  - `test/e2e/own-sessions.spec.ts:179`, `test/e2e/permissions.spec.ts:58` (`selectOption` режима),
    `test/e2e/session-controls.spec.ts:81` (`selectOption` модели).

## Что делаем

1. **Model и Permission mode — Select Ticket-а 08.** Кнопки с префиксом «Model» и «Permissions» и
   значением, как в макете. Строки — как сейчас: `displayName` моделей и «Default model»;
   `MODE_LABELS`. Список моделей обновляется при открытии (`onOpen`). Сохранённая модель, которой нет
   в списке, показывается. `data-testid` — прежние, на кнопках.
2. **Effort — ползунок.** Кнопка «Effort <уровень>» (макет) открывает поповер с горизонтальным
   ползунком:
   - отметки слева направо — «default», затем уровни выбранной модели; подпись под каждой;
   - текущая отметка подписана и над ползунком; `aria-valuetext` — имя уровня;
   - ← и → двигают, Esc и Enter закрывают; уровень уходит в `configure({ effort })` при
     отпускании, а не на каждом шаге;
   - модель без effort — кнопка неактивна, «Effort —»;
   - сохранённый уровень, которого у модели нет, остаётся отметкой, как сейчас;
   - подсказка про применённый effort (`Pickers.tsx:88`) остаётся у кнопки.

   Ползунок — native `<input type="range">` с отметками в цветах токенов.
3. Стили `.w-pickers__select` уступают стилям кнопок Select и ползунка; высота строки composer-а
   не меняется.
4. Test-ы из «Что происходит» выбирают через Select (клик по кнопке и по `option`) и ползунок.

Решено в Ticket-е, подтвердить у владельца: ползунок — в поповере кнопки «Effort», а не прямо в
строке composer-а; отметка «default» — слева от уровней модели.

**Не входит:** список уровней (его даёт SDK); общий Select (Ticket 08); смена режима разрешений по
сочетанию клавиш.

## Готово, когда

- [ ] Unit `test/unit/session-view.test.tsx`: выбор модели, effort и режима — через Select и
  ползунок; sonnet → `configure({ model: 'sonnet' })`; модель, у которой нет текущего уровня,
  сбрасывает его; режим «Plan only» → `configure({ permissionMode: 'plan' })`.
- [ ] Unit `test/unit/effort-slider.test.tsx` (новый): отметки — «default» и уровни выбранной
  модели; → с «high» даёт «xhigh» у модели, где он есть; `aria-valuetext` — имя уровня; модель без
  effort — кнопка неактивна; уровень уходит в `configure` один раз — при отпускании.
- [ ] e2e `test/e2e/own-sessions.spec.ts`, `test/e2e/permissions.spec.ts`,
  `test/e2e/session-controls.spec.ts` — выбор через Select, зелёные. В `session-controls.spec.ts` —
  снимки `composer-pickers` и `effort-slider` (поповер открыт) в светлой и тёмной теме.
- [ ] grep: `<select` в `src/renderer` нет.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально —
  exit 0.

## Тесты

Сначала падающий test — unit ползунка «отметки — default и уровни модели»: ползунка нет. Затем
перевод `session-view.test.tsx` и e2e на Select. В «Итог» — как падал первый test.

## Где в коде

- `src/renderer/session/composer/Pickers.tsx`
- `src/renderer/session/session.css`
- `test/unit/session-view.test.tsx`
- `test/unit/effort-slider.test.tsx` (новый)
- `test/e2e/own-sessions.spec.ts`
- `test/e2e/permissions.spec.ts`
- `test/e2e/session-controls.spec.ts`

## Итог

Заполняется при закрытии.
