# 167 — Кнопка Enable у выключенного Harness-а в строке статуса

Type: feature
Status: open
Blocked by: —
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

- `src/renderer/shell/toolbar/HarnessStatus.tsx:214` — состояние `installed`, строка «· disabled».
- Main-процесс, где выполняются Install и Update Harness-а (найти по `onInstall`): туда же — действие Enable.

## Готово, когда

- [ ] При выключенном plugin-е строка показывает кнопку Enable; после нажатия статус перечитан и строка без
      «disabled»; ошибка включения видна в tooltip-е.
- [ ] Unit- и contract-test-ы на действие Enable и на строку; test-ы красные до правки.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` зелёный на head PR.
- [ ] (вручную) Сделай: в Claude Code выключи plugin worfy (`/plugin`), в Stable worfy нажми Enable в строке
      Harness → Должно быть: строка без «disabled», в Claude Code plugin worfy снова включён.
  - needs: mac stable
