# 29 — `autoCompactWindow` из `~/.claude/settings.json` главнее значений worfy по умолчанию

Type: task
Status: done — 2026-10-17, [PR #424](https://github.com/IDSAD-XL/worfy/pull/424)
Branch: worfy-polish/29
Blocked by: —
Source: решение владельца 2026-10-16 («со всем согласен») — follow-up Ticket-а
[24](24-настройка-порога-autocompact-session.md) (раздел «Gate оркестратора (2026-10-16)», Noted: «400K и
500K по умолчанию перекрывают `autoCompactWindow` из `~/.claude/settings.json` — `/autocompact` в
Session worfy после перезапуска не действует, пока не выбран «Claude Code default»; в UI об этом не
сказано»).

## Что происходит

- **Значения worfy по умолчанию** — 400K для Orchestrator-а и 500K для прочих Session-ов
  (`AUTO_COMPACT_WINDOW_DEFAULTS`, `src/shared/settings/app-settings.ts:46`). Их получает и тот, кто
  настройку не открывал: `DEFAULT_APP_SETTINGS` и `defaultAppSettings()` (`:122-137`), store берёт их
  для старого `app-settings.json` без поля (`src/main/settings/store.ts`).
- **Передача в Claude Code.** `autoCompactWindowFor` (`app-settings.ts:144-146`) → `appAutoCompactWindow`
  (`src/main/agent/app-registry.ts:55-63`) → `options.settings = { autoCompactWindow }`
  (`src/main/agent/options.ts:340`). Это flag settings: они главнее `autoCompactWindow` из
  `~/.claude/settings.json` пользователя. Окно, которое человек задал там сам (или командой
  `/autocompact`), в Session worfy не действует, пока в Settings не выбран «Claude Code default».
- **Settings → Sessions** (`src/renderer/settings/SessionsSection.tsx`) показывает только строку про
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW` в shell (`SHELL_OVERRIDE_TEXT`, `:36`; канал
  `sessionAutocompact.shellOverride`, `src/shared/ipc/session-autocompact.ts:10`). Про
  `settings.json` — ничего.
- `~/.claude/settings.json` worfy уже читает для модели и effort: `readUserSettings`
  (`src/main/claude-home/user-model.ts:21-35`).

## Что делаем

1. **Сначала красные test-ы** в `test/contract/agent-autocompact.test.ts` (Claude home test-а — свой,
   его даёт `test/setup-contract.ts`): `settings.json` с `autoCompactWindow: 300000` и настройка worfy,
   которую человек не трогал, — `query()` получает опции без ключа `settings`; без `autoCompactWindow` в
   `settings.json` — 400K Orchestrator-у и 500K прочим, как сейчас. На main первый красный.
2. **Порядок источников** окна для роли (решено при планировании):
   1. значение, которое человек сам выбрал в Settings worfy («Custom» или «Claude Code default»), —
      как сейчас;
   2. иначе `autoCompactWindow` из `<claudeHome>/settings.json` — worfy не передаёт своего окна, и
      Claude Code берёт значение пользователя сам;
   3. иначе 400K / 500K worfy.
   Для этого store различает «человек выбрал» и «значение по умолчанию» (как именно — выбор
   исполнителя; старый `app-settings.json` без поля и файл, где значение равно умолчанию и его не
   выбирали, читаются как «по умолчанию»).
3. **Чтение `settings.json`** — рядом с `readUserModel` и `readUserEffort` (`user-model.ts`): целое
   положительное число, иначе «нет». Читается при каждом запуске процесса Claude Code, как сейчас
   настройки приложения (`app-registry.ts:55-63`).
4. **Settings показывает источник** под каждой ролью: «Claude Code default», «From ~/.claude/settings.json
   (<значение> K)», «worfy default (400K)» или своё значение. Строка про
   `CLAUDE_CODE_AUTO_COMPACT_WINDOW` остаётся. Источник приходит из main (новый канал рядом с
   `sessionAutocompact.shellOverride`, домен `local`).
5. **Снимки** раздела Sessions в светлой и тёмной теме: значение из `settings.json`, значение worfy по
   умолчанию, своё значение.

## Готово, когда

- [x] Test-ы пункта 1 красные на main и зелёные с правкой; test-ы Ticket-а 24 зелёные без правки
      ожиданий, кроме тех, что проверяли «400K перекрывает settings.json» (каждое такое изменение —
      строкой в «Итог»).
- [x] `test/unit/settings-sessions.test.tsx`: подпись источника для каждого из трёх случаев.
- [x] Снимки в обеих темах — ссылки в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный.
- [ ] (вручную) Stable copy: в `~/.claude/settings.json` владельца `autoCompactWindow` задан — после
      перезапуска Session worfy `/context` показывает порог от этого окна. Шаг владельца.
      Не проверено: шаг владельца/оркестратора.

## Тесты

- `test/contract/agent-autocompact.test.ts` — порядок источников, fake SDK, без настоящего SDK
  (`loadSdk`, как в Ticket-е 24).
- `test/unit/settings-sessions.test.tsx` — подпись источника.
- `test/contract/app-settings.test.ts` — store различает «выбрал» и «по умолчанию».
- Мутанты: `settings.json` не читается; значение worfy по умолчанию главнее `settings.json`; выбор
  человека не главнее `settings.json` — каждый красный.

## Где в коде

- `src/shared/settings/app-settings.ts`
- `src/main/settings/store.ts`
- `src/main/agent/app-registry.ts`
- `src/main/claude-home/user-model.ts`
- `src/shared/ipc/session-autocompact.ts`
- `src/main/ipc/session-autocompact.ts`
- `src/renderer/settings/SessionsSection.tsx`
- `test/contract/agent-autocompact.test.ts`
- `test/contract/app-settings.test.ts`
- `test/unit/settings-sessions.test.tsx`

Только читать (не в списке, чтобы не давать ложных пересечений Wave): `src/main/agent/options.ts`,
`test/setup-contract.ts`.

## Вне скоупа

- `autoCompactWindow` из `.claude/settings.json` Project-а и `settings.local.json` — только файл
  пользователя в Claude home.
- Порог autocompact для implementer-ов (решение владельца 2026-10-15, «Вне скоупа» Ticket-а 24).
- Запись в `~/.claude/settings.json`: worfy только читает (ADR-0005).

## Итог

- **Порядок источников** — `autoCompactWindowSource` (`src/shared/settings/app-settings.ts`): выбор
  человека в Settings («Custom» или «Claude Code default»), затем `autoCompactWindow` из
  `<claudeHome>/settings.json`, затем 400K / 500K worfy. `autoCompactWindowFor` передаёт окно только для
  «Custom» и значения worfy по умолчанию; для «Claude Code default» и окна из `settings.json` ключа
  `settings` у `query()` нет — Claude Code берёт окно пользователя сам. Main (`app-registry.ts`) и
  Settings считают источник одной функцией.
- **Как store различает «выбрал» и «по умолчанию»** (выбор исполнителя): новое необязательное поле
  `autoCompactWindowChosen: { orchestrator, other }`. Окно, названное изменением, — выбор, в том числе
  400K / 500K. Окно, не равное значению worfy по умолчанию, считается выбранным и без отметки: так
  `app-settings.json` Ticket-а 24 (300K или `null`) сохраняет выбор, а файл со значениями по умолчанию
  читается как «по умолчанию». Отметка пишется, только пока выбрано хотя бы одно окно, поэтому файл
  без выбора не меняется. Значение изменения `'worfy-default'` возвращает роль к значению worfy по
  умолчанию, без выбора; канал `appSettings.set` его принимает, Settings его пока не предлагает.
- **Чтение `settings.json`** — `readUserAutoCompactWindow` (`user-model.ts`): целое положительное
  число, иначе `null` (`"auto"`, строка, дробь, 0, нет поля, нет файла, не JSON). Читается при
  каждом запуске процесса Claude Code. `modelSettings.<model>.autoCompactWindow` не читается.
- **Settings → Sessions**: под каждой ролью строка источника — «Custom (450K)», «Claude Code default»,
  «From ~/.claude/settings.json (300K)», «worfy default (400K)». Окно из `settings.json` при
  невыбранной настройке показано как «Claude Code default» без поля: worfy ничего не передаёт.
  Невыбранное окно без `settings.json` показано как «Custom» с полем 400 / 500, как раньше. Значение
  `settings.json` приходит из main по новому каналу `sessionAutocompact.userSettings` (домен `local`);
  источник считает renderer той же функцией, что main, чтобы строка менялась сразу после выбора.
  Строка про `CLAUDE_CODE_AUTO_COMPACT_WINDOW` осталась.
- **Решено без владельца, подтвердить:** (1) отдельного пункта «вернуться к значению по умолчанию» в
  Select нет: при окне в `settings.json` «Claude Code default» действует так же; (2) `settings.json`
  читается при открытии раздела, правка файла при открытом разделе видна после повторного открытия
  (`shortcut:` в `SessionsSection.tsx`); (3) подписи источника — английские, как названия действий; (4) источник для строки
  Settings считает renderer той же функцией `autoCompactWindowSource`, а не получает его из main:
  так строка меняется сразу после выбора.
- **Изменения test-ов Ticket-а 24:** ожидания не менялись. Изменена подготовка в `beforeEach`
  `test/contract/agent-autocompact.test.ts`: раньше она возвращала store к 400K / 500K явной записью,
  теперь — значением `'worfy-default'`, иначе явная запись стала бы выбором человека. С прежней
  подготовкой новый test «окно в settings.json, настройка не выбрана — без `settings`» на main красный
  (проверено: 3 из 22 красные, exit 1); с новой на main красные 23 из 69 (тип `'worfy-default'` main не
  знает).
- **Test-ы:** `test/contract/agent-autocompact.test.ts` — порядок источников через настоящую цепочку
  Orchestrators → Session → `sdkQueryFactory` с fake SDK, 8 видов «нет окна» в `settings.json`, чтение
  при каждом запуске, канал `sessionAutocompact.userSettings`; `test/contract/app-settings.test.ts` —
  отметка выбора, `'worfy-default'`, старые файлы без отметки, отметка «не выбрано» при окне не по
  умолчанию; `test/unit/settings-sessions.test.tsx` — строка источника для всех четырёх случаев и
  переход к «Custom» из окна `settings.json`.
- **Мутанты** (на копиях, восстановлены с `cmp`), все красные: `settings.json` не читается (2 test-а);
  значение worfy главнее `settings.json` (5); `settings.json` главнее выбора человека (4); store не
  считает выбором значение по умолчанию (2); отметка при чтении не учитывается (3); строка показывает
  значение store вместо источника (2); reader принимает дробь (1); канал отвечает `null` (1);
  `'worfy-default'` оставляет выбор (3).
- **Снимки** (Playwright на собранном приложении, `WORFY_CLAUDE_HOME` временный): значение worfy по
  умолчанию — [светлая](../evidence/29-sessions-worfy-default-light.png),
  [тёмная](../evidence/29-sessions-worfy-default-dark.png); значение из `settings.json` (300K) —
  [светлая](../evidence/29-sessions-settings-json-light.png),
  [тёмная](../evidence/29-sessions-settings-json-dark.png); своё значение (Orchestrator 450K, Other
  Sessions — из `settings.json`) — [светлая](../evidence/29-sessions-custom-light.png),
  [тёмная](../evidence/29-sessions-custom-dark.png).
- `test/e2e/settings-sessions.spec.ts` (Ticket 24) зелёный без правки: 2 из 2, exit 0.
- **Не проверено:** порог на настоящем Claude Code — пункт «(вручную)», шаг владельца.

**Ревью и merge (2026-10-17).** Круг 1 — `VERIFIED`
([вердикт](https://github.com/IDSAD-XL/worfy/pull/424#issuecomment-6229686497)); gate full на Mac
зелёный, merge `21dfc5d1`. Находка low — отступление (4) не было в списке «Решено без владельца» —
перенесена туда этим документным PR.
