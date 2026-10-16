# 14 — Клавиша ⌘[ / Ctrl+[ «Back to …» в окне Subagent-а — в реестр сочетаний и в окно Keyboard shortcuts

Type: task
Status: open
Blocked by: 11
Source: разбор находок ночи 2026-10-16 (Session на Mac): [PR #371](https://github.com/IDSAD-XL/worfy/pull/371) (worfy-polish 25, стрелка назад в окне Subagent-а) добавил свой обработчик клавиши мимо реестра сочетаний, который вводит [PR #328](https://github.com/IDSAD-XL/worfy/pull/328) (Ticket [11](11-реестр-сочетаний-и-окно-keyboard-shortcuts.md), не влит). Код перечитан на Mac по main `9974e0e0` и ветке `worfy-ui/11` `2935b0e9`.

## Что происходит

- **Стрелка назад в окне Subagent-а** (PR #371, влит 2026-10-15) ведёт к Session, которая его
  запустила. Клавиша — ⌘[ на macOS, Ctrl+[ на Windows и Linux. Код —
  `src/renderer/session/ExternalSessionPanel.tsx`:
  - `BACK_KEY` (`:43`) и `isBackKey` (`:44`): `isPrimary` из `src/renderer/platform.ts`, без Shift,
    и `event.key === '['` либо, без Alt, `event.code === 'BracketLeft'` — по месту клавиши, для
    раскладки, где на ней другой символ (комментарий `:42`);
  - `BackArrow` (`:46-67`) вешает свой слушатель `keydown` на `window`, пока показан вид Session
    (`:48-58`);
  - подпись кнопки — `label(BACK_KEY)` из `platform.ts` (`:61`).
- **Реестра сочетаний на main нет.** Его вводит PR #328 (Ticket 11, открыт): список
  `src/shared/shortcuts.ts`, сравнение нажатия `matches`, подпись `label` и `ariaKeys` в
  `src/renderer/shortcuts/match.ts` (на ветке `worfy-ui/11`: `:51`, `:76`, `:84`). Окно Keyboard
  shortcuts и раздел Settings ▸ Shortcuts показывают только записи реестра. Образец переноса на
  ветке — `src/renderer/canvas/overlays/FocusEntry.tsx`: `matches(event, SHORTCUTS.focusEnter)`
  (`:78`), подпись `label(SHORTCUTS.focusEnter)` (`:105`).
- **PR #371 написан раньше, чем влит #328, и в реестр не попал.** Когда #328 влит, ⌘[ / Ctrl+[
  работает, но в окне Keyboard shortcuts его нет.
- **`matches` не знает места `[`.** Сравнение идёт по `shortcutKey`
  (`src/renderer/platform.ts:88-93`): место клавиши (`event.code`) читается только для
  `Key[A-Z]`. На русской раскладке клавиша `[` даёт `х`, `event.code` — `BracketLeft`; `matches` с
  записью `key: '['` такое нажатие не примет. Сегодня `isBackKey` его принимает.

## Что делаем

1. **Запись в `src/shared/shortcuts.ts`**: `back` («Back to the Session that started it» или
   короче), группа `Session`, `keys: { primary: true, key: '[' }`. Область (`scope`) — для вида
   Session; если ни одна из нынешних не подходит, новая. Решение — в «Итог».
2. **`BackArrow` слушает через `matches(event, SHORTCUTS.back)`**, подпись и `aria-keyshortcuts` —
   `label` и `ariaKeys` реестра. `BACK_KEY` и `isBackKey` уходят.
3. **Место клавиши не теряется.** Реестр учится сравнивать `[` по `event.code === 'BracketLeft'`:
   поле записи или правило в `shortcutKey` для знаков, у которых есть своё место. Без Alt, как
   сейчас: на немецкой раскладке `[` набирается с AltGr. Выбор — в «Итог».

## Готово, когда

- [ ] В окне Keyboard shortcuts и в Settings ▸ Shortcuts есть строка `[data-shortcut="…back…"]` с
      ⌘[ на macOS и Ctrl+[ на Windows и Linux (e2e `test/e2e/shortcuts.spec.ts`).
- [ ] ⌘[ в окне Subagent-а ведёт к Session, как после PR #371 (e2e, тот же spec или
      `test/e2e/subagent-tree.spec.ts`).
- [ ] Unit: `matches` принимает `{ key: 'х', code: 'BracketLeft' }` с primary и не принимает его с
      Alt и с Shift.
- [ ] В `ExternalSessionPanel.tsx` нет своего сравнения клавиш: `grep -n "BracketLeft"` по файлу —
      пусто.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `gate full` зелёный; Linux CI зелёный.

## Тесты

- Unit: запись `back` в реестре и её сравнение — `key: '['`, русская раскладка по месту клавиши,
  Shift и Alt не проходят.
- e2e: строка в окне Keyboard shortcuts; ⌘[ / Ctrl+[ в окне Subagent-а.
- Мутант: убрать запись из реестра — e2e окна красный; убрать правило места клавиши — unit
  русской раскладки красный.

## Где в коде

- `src/shared/shortcuts.ts`
- `src/renderer/shortcuts/match.ts`
- `src/renderer/platform.ts`
- `src/renderer/session/ExternalSessionPanel.tsx`
- `test/unit/shortcuts.test.tsx`
- `test/e2e/shortcuts.spec.ts`

## Вне скоупа

- Другие обработчики клавиш, появившиеся на main мимо реестра после ветки `worfy-ui/11`: этот Ticket
  их не ищет.
- «Go to Orchestrator» в палитре из PR #371 — команда палитры, а не сочетание.

## Итог

—
