# 14 — Клавиша ⌘[ / Ctrl+[ «Back to …» в окне Subagent-а — в реестр сочетаний и в окно Keyboard shortcuts

Type: task
Status: claimed 2026-10-17T18:03Z
Branch: worfy-ui/14
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

Заполнено implementer-ом 2026-10-17; gate full, ревью и мерж — у Orchestrator-а.

- **Запись реестра.** `SHORTCUTS.back` в `src/shared/shortcuts.ts`: id `session.back`, название
  «Back to what started the Subagent» (стрелка ведёт к родительскому Subagent-у или к Session),
  группа `Session`, `keys: primary('[')`. Область — новая, `session view`: ни одна из прежних не
  подходит (`composer` — поле ввода, а у окна Subagent-а поля нет; `app` действует везде, а клавиша
  работает только пока показан вид Session). Строка видна в окне Keyboard shortcuts и в
  Settings ▸ Shortcuts: ⌘[ на macOS, Ctrl+[ на Windows и Linux.
- **`BackArrow`** (`src/renderer/session/ExternalSessionPanel.tsx`) слушает через
  `matches(event, SHORTCUTS.back)`; подпись — `label(SHORTCUTS.back)`, у кнопки появился
  `aria-keyshortcuts` (`ariaKeys`). `BACK_KEY`, `isBackKey` и импорт `isPrimary` ушли;
  `grep -n BracketLeft` по файлу — пусто.
- **Место клавиши — правило в `shortcutKey`** (`src/renderer/platform.ts`), а не поле записи.
  Карта `PUNCTUATION_PLACES = { BracketLeft: '[' }`: любая буква вне a–z на месте `BracketLeft`
  читается как `[` — `х` на русской раскладке, `ü` на немецкой, `å` на северных (там сам `[`
  набирается с AltGr или Option, а это не сочетание). Так же `л` на месте `KeyK` читается как K.
  Буква a–z на этом месте остаётся буквой: на BÉPO там `z`, и ⌘z — Undo, а не Back. Почему правило,
  а не поле записи: оно одно для всех записей, реестр остаётся без DOM-кодов. Карта только с `[`:
  `Backquote` (`ё`) не добавлен, потому что unit test `platform-keys.test.ts` закрепляет `ё` как есть.
  Об этом пределе — комментарий `shortcut:` у карты.
- **Shift.** Для знаков препинания `matches` Shift не проверял, и `Х` (Shift и `х`) прошёл бы как
  ⌘[. Теперь Shift входит в сочетание, если нажатие дало букву (`shiftCounts(key, event.key)` в
  `match.ts`): у буквы Shift меняет только регистр. Alt проверялся и раньше.
- **Тесты.** Unit — `test/unit/shortcuts.test.tsx`: `[` и `х` на `BracketLeft` с primary проходят на
  трёх системах, `ü` и `å` на `BracketLeft` — тоже; с Alt, с Shift (`Х`, `Ü`), без primary, `{`,
  `z` на `BracketLeft` (BÉPO; это Undo), `ъ` и `ü` на `BracketRight` и нажатие во время работы
  input method — нет; подписи ⌘[ / Ctrl+[ и `aria-keyshortcuts`. e2e —
  `test/e2e/shortcuts.spec.ts`: строка `[data-shortcut="session.back"]` в окне и в Settings ▸
  Shortcuts; сама клавиша ⌘[ в окне Subagent-а — прежний `test/e2e/session-back.spec.ts`, зелёный.
- **Мутанты.** Пустая карта мест — unit русской раскладки красный; `shiftCounts` без правила буквы —
  unit Shift красный; латинская буква снова отсечена до карты (как в первом круге) — unit `ü`
  красный; карта прочитана раньше a–z — unit BÉPO `z` красный; запись убрана из `SHORTCUT_LIST` —
  оба e2e списка красные.
- **Что изменилось в поведении.** Раньше ⌘[ принимался и с Alt, если `event.key` был `[`.
  Теперь — только без Alt. ⌘ü на немецкой раскладке, как и раньше, ведёт назад. Не ведут больше
  нажатия на месте `BracketLeft`, которые дают не букву (раньше `isBackKey` брал любое). Буква a–z
  на этом месте теперь своя клавиша (BÉPO `z` — Undo), а не Back. На Windows и Linux Ctrl+[ внутри
  Terminal Node теперь у оболочки (там это Esc), как у всех записей с primary.
