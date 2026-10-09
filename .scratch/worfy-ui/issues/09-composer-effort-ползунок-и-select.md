# 09 — Composer: effort — ползунок, Model и Permission mode — Select

Type: task
Status: open
Blocked by: 08
Source: решение владельца 2026-10-09: 4 (effort — ползунок, как в приложении Claude Code, с уровнями выбранной модели; Model и Permission mode — стилизованные списки на общем Select; вид кнопок — макет `docs/design/F-session-dark.dc.html:177-179`) ([spec.md](../spec.md), «Как устроено», «Select»)

## Что происходит

- Три пикера — native `<select>` в `src/renderer/session/composer/Pickers.tsx`, под полем ввода
  Session (`Pickers.tsx:7`, часть composer-а по файлу — `export const order = 10`, `:14`): модель
  (`:69-84`), effort (`:85-103`), режим разрешений (`:104-121`). Стили — `.w-pickers__select`
  (`src/renderer/session/session.css:772-794`).
- Макет рисует Model, Effort и Permissions в шапке Session (`docs/design/F-session-dark.dc.html:170`;
  кнопки «Model Opus 5.5» и «Effort high» — `:177-178`, chip «Permissions» — `:179`), а не под
  полем ввода.
- Модель. Список — из `supportedModels()` SDK: `modelOptions` (`src/main/agent/session.ts:155-163`)
  оставляет модели от sonnet и выше; у каждой — уровни effort (`supportedEffortLevels`). Сохранённая
  модель, которой нет в списке, всё равно показывается (`Pickers.tsx:55-56`). Список обновляется при
  фокусе (`onFocus={refresh}`, `:75`).
- Effort. Все уровни — `EFFORT_LEVELS = ['low','medium','high','xhigh','max']`
  (`src/shared/agent/settings.ts:13`). Пикер показывает:
  - уровни выбранной модели; пока список моделей пуст (не пришёл или упал) — все `EFFORT_LEVELS`
    (`Pickers.tsx:58`);
  - сохранённый уровень, которого у модели нет, — в конце списка (`:59-60`);
  - `null` — «effort default»; пикер неактивен, только когда строк нет совсем: «effort —»
    (`:90`, `:97`).

  Смена модели сбрасывает уровень, которого у новой нет (`:61-65`). Применённый effort
  Claude Code не сообщает — так и пишет `title` пикера (`:88`). Уровень уходит в SDK при старте
  (`src/main/agent/options.ts:246`) и в живую Session (`applyFlagSettings`,
  `src/main/agent/session.ts:252`).
- Режимы разрешений — `PERMISSION_MODES` (`src/shared/agent/settings.ts:8`), подписи — `MODE_LABELS`
  (`Pickers.tsx:16-21`).
- После Ticket-а 08 есть `Select` (`src/renderer/theme/Select.tsx`) с `onOpen`, подписью-префиксом и
  `data-value` на кнопке.
- Test-ы, которые полагаются на native `<select>`:
  - `test/unit/session-view.test.tsx:456-512` (`HTMLSelectElement`, список `option`, `.value`,
    `fireEvent.change` по `picker-model`, `picker-effort`, `picker-permissions`) и `:650` (`.value`);
  - `test/e2e/own-sessions.spec.ts:179-180`, `test/e2e/permissions.spec.ts:58-59` — `selectOption`
    режима и `toHaveValue`;
  - `test/e2e/session-controls.spec.ts:69-86` (`locator('option')`, `selectOption` модели, effort и
    режима, `toHaveValue`), `:154-156` и `:180-184` (`toHaveValue`, `locator('option')`).

## Что делаем

1. **Model и Permission mode — Select Ticket-а 08.** Пикеры остаются под полем ввода; от макета
   берётся вид кнопок: префикс «Model» или «Permissions» и значение. Строки — как сейчас:
   `displayName` моделей и «Default model»; `MODE_LABELS`. Список моделей обновляется при открытии
   (`onOpen`). Сохранённая модель, которой нет в списке, показывается. `data-testid` — прежние, на
   кнопках.
2. **Effort — ползунок.** Кнопка «Effort <уровень>» (вид — макет `:178`) открывает поповер с
   горизонтальным ползунком:
   - отметки слева направо — «default», затем уровни в порядке `EFFORT_LEVELS`: уровни выбранной
     модели (пока список моделей пуст — все) и сохранённый уровень, которого у модели нет, — на своём
     месте по порядку, а не в конце;
   - текущая отметка подписана над ползунком; `aria-valuetext` — имя уровня;
   - ← и → двигают; уровень уходит в `configure({ effort })` один раз — на `pointerup`, на `keyup`
     стрелки или при закрытии поповера (Esc, Enter, клик вне), а не на каждое событие `input` или
     `change` native-ползунка;
   - кнопка неактивна, «Effort —», только когда отметок нет совсем, как сейчас; у модели без уровней,
     но с сохранённым уровнем — отметки «default» и этот уровень;
   - `title` о применённом effort (`Pickers.tsx:88`) остаётся у кнопки.

   Ползунок — native `<input type="range">` с отметками в цветах токенов.
3. Стили `.w-pickers__select` уступают стилям кнопок Select и ползунка; высота строки composer-а
   не меняется.
4. Test-ы из «Что происходит» выбирают через Select (клик по кнопке и по `option`) и ползунок,
   значение читают из `data-value` кнопки.

Решено в Ticket-е, подтвердить у владельца: пикеры остаются под полем ввода, а не в шапке Session,
как в макете; ползунок — в поповере кнопки «Effort», а не прямо в строке composer-а; отметка
«default» — слева от уровней модели.

**Не входит:** список уровней (его даёт SDK); общий Select (Ticket 08); перенос пикеров в шапку
Session; смена режима разрешений по сочетанию клавиш.

## Готово, когда

- [ ] Unit `test/unit/session-view.test.tsx`: выбор модели, effort и режима — через Select и
  ползунок; sonnet → `configure({ model: 'sonnet' })`; модель, у которой нет текущего уровня,
  сбрасывает его; режим «Plan only» → `configure({ permissionMode: 'plan' })`.
- [ ] Unit `test/unit/effort-slider.test.tsx` (новый): отметки — «default» и уровни выбранной
  модели; список моделей пуст — все уровни; сохранённый `low` у модели `[medium, high, xhigh]` стоит
  первым после «default»; → с «high» даёт «xhigh» у модели, где он есть; `aria-valuetext` — имя
  уровня; три нажатия → и закрытие поповера зовут `configure` один раз; отметок нет — кнопка
  неактивна.
- [ ] e2e `test/e2e/own-sessions.spec.ts`, `test/e2e/permissions.spec.ts`,
  `test/e2e/session-controls.spec.ts` — выбор через Select и ползунок, зелёные. В
  `session-controls.spec.ts` — снимки `composer-pickers` и `effort-slider` (поповер открыт) в светлой
  и тёмной теме.
- [ ] grep: `<select` в `src/renderer` нет; `selectOption` в `test/e2e` нет.
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
