# 29 — `autoCompactWindow` из `~/.claude/settings.json` главнее значений worfy по умолчанию

Type: task
Status: open
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

- [ ] Test-ы пункта 1 красные на main и зелёные с правкой; test-ы Ticket-а 24 зелёные без правки
      ожиданий, кроме тех, что проверяли «400K перекрывает settings.json» (каждое такое изменение —
      строкой в «Итог»).
- [ ] `test/unit/settings-sessions.test.tsx`: подпись источника для каждого из трёх случаев.
- [ ] Снимки в обеих темах — ссылки в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный.
- [ ] (вручную) Stable copy: в `~/.claude/settings.json` владельца `autoCompactWindow` задан — после
      перезапуска Session worfy `/context` показывает порог от этого окна. Шаг владельца.

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

—
