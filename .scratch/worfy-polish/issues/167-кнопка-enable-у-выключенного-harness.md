# 167 — Кнопка Enable у выключенного Harness-а в строке статуса

Type: feature
Status: claimed 2026-11-27T08:03Z
Branch: worfy-polish/167
Blocked by: worfy-layout 03 (footer и chip версии: строка Harness переезжает в popover chip-а и в `src/renderer/harness/HarnessStatus.tsx`)
Source: вопрос владельца 2026-11-26 о строке статуса у знакомого: «Harness 0.4.0+08d75598c · disabled · removed
mattpocock-skills». Plugin worfy был выключен в Claude Code, а строка только говорит «disabled» и не даёт его включить.
Решение владельца 2026-11-27 (раунд вопросов, Q5): «да» — завести ticket на кнопку Enable.

## Что происходит

Когда plugin worfy установлен, но выключен в Claude Code, строка Harness в toolbar показывает
«Harness <версия> · disabled» и tooltip «The plugin worfy is disabled in Claude Code». Кнопки нет: человеку нужно
знать команду `claude plugin enable worfy@worfy-harness` или открыть `/plugin` в Claude Code.

## Что строить

- В состоянии `installed` с `enabled: false` рядом со строкой — кнопка Enable (тот же вид, что Install и Update).
- Нажатие включает plugin worfy в Claude Code тем же способом, каким это делает сам Claude Code (команда
  `claude plugin enable worfy@worfy-harness` или прямая запись в его настройки — решает исполнитель по тому, что
  надёжнее и не требует sign-in), затем перечитывает статус: строка становится «Harness <версия>».
- Ошибка включения показывается в tooltip-е и не меняет строку на «enabled».
- Кнопки нет там, где нет и Install/Update (`canInstall` false).

## Где в коде

- `src/renderer/harness/HarnessStatus.tsx` — строка `HarnessLine` в popover chip-а версии: кнопка Enable
  (`harness-enable`) рядом с Install, Update Harness, Retry; ошибка Enable — в tooltip-е текста и кнопки.
  Прежний путь `src/renderer/shell/toolbar/HarnessStatus.tsx` ушёл с worfy-layout 03.
- `src/renderer/harness/harness-lines.ts` — `harnessPart`: у `installed` с `enabled: false` кнопка Enable с accent,
  отсюда янтарная точка chip-а (`src/renderer/shell/footer/version-dot.ts`).
- `src/renderer/harness/useHarnessStatus.tsx` — `onEnable` через `harness.enable`, «Enabling Harness…», `enableFailure`.
- `src/shared/ipc/harness.ts` — channel `harness.enable` и его ответ (`status`, `error`); шаг `enable`.
- `src/main/harness/install.ts` — `HarnessInstaller.enable()`: `claude plugin enable worfy@worfy-harness --scope user`,
  затем статус заново. `src/main/ipc/harness.ts` — handler и `harness.changed` всем окнам после удачного Enable.
- Test-ы: `test/contract/harness-install.test.ts`, `test/contract/harness-changed.test.ts`,
  `test/unit/harness-status.test.tsx`, `test/unit/version-dot.test.tsx`.
- `docs/features/harness.md` — строка Disabled и абзац «Enable».

## Готово, когда

- [ ] При выключенном plugin-е строка показывает кнопку Enable; после нажатия статус перечитан и строка без
      «disabled»; ошибка включения видна в tooltip-е.
- [ ] Unit- и contract-test-ы на действие Enable и на строку; test-ы красные до правки.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` зелёный на head PR.
- [ ] (вручную) Сделай: в Claude Code выключи plugin worfy (`/plugin`), в Stable worfy нажми Enable в строке
      Harness → Должно быть: строка без «disabled», в Claude Code plugin worfy снова включён.
  - needs: mac stable
