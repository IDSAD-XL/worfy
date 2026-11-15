# 10 — Список MCP-серверов: группа «not started» с одним Restart, имена целиком, тихий Allow

Type: task
Status: claimed 2026-11-12T20:04Z
Blocked by: none
Source: владелец 2026-11-12, взгляд на popover chip-а «MCP n/m» на Stable 802d79536 («нечитаемые названия + больная
кнопка, плохой UX»); Q8, Q9, Q10, Q12 — «да»

## Что происходит

- Popover chip-а «MCP n/m» (`src/renderer/session/McpChip.tsx`) показывает строку «not started» на каждый разрешённый
  сервер, которого нет в процессе. В каждой такой строке стоит длинная кнопка «Restart Session with the same
  conversation», а под ней один и тот же оранжевый текст «Allowed in this Project, but Claude Code did not start it in
  this Session.». При четырёх connector-ах claude.ai это четыре одинаковые кнопки и четыре одинаковые строки текста.
- Кнопка отнимает ширину у имени, и имена обрезаются до «claude.ai A…», «claude.ai D…» — прочитать нельзя.
- В группе «Not allowed in this Project» у каждой строки яркая кнопка «Allow» в акцентном цвете; рядом с «Allow all»
  в заголовке группы они спорят друг с другом.

## Что делаем

1. Строки «not started» собираются в свою группу. В её заголовке один раз — текст «Allowed in this Project, but Claude
   Code did not start them in this Session.» и одна кнопка «Restart Session». Что Restart сохраняет разговор, говорит
   tooltip кнопки (kit Tooltip, ADR-0106). Строки группы — имя, chip «not started» и источник, без кнопок.
2. Имя сервера читается целиком. Если источник — claude.ai, приставка «claude.ai » из имени убирается: колонка
   источника уже говорит «claude.ai». Кнопки больше не отнимают ширину у имени; имя, которое не помещается,
   переносится на вторую строку, а не обрезается. Полное исходное имя — в tooltip.
3. «Allow» в строках — secondary кнопка (theme/Button.tsx). Акцентная кнопка в popover-е одна — «Allow all».
4. Остальное поведение не меняется: Allow, Allow all, Restart, Turn off, Reconnect и Sign in делают то же, что сейчас.

## Готово, когда

- [ ] Unit test `test/unit/mcp-chip.test.tsx`: группа «not started» — один заголовок с текстом и одной кнопкой
      «Restart Session» при любом числе строк; в строках группы кнопок нет; кнопка запускает тот же Restart, что и
      раньше.
  - evidence: test-run pass · `pnpm test test/unit/mcp-chip.test.tsx` exit 0 · mac - · 424479c1525cbeeb956b3c1657db010745162957
- [ ] Unit test: имя connector-а claude.ai показано без приставки, полное исходное имя доступно в tooltip; длинное имя
      не обрезается многоточием.
  - evidence: test-run pass · `pnpm test test/unit/mcp-chip.test.tsx test/unit/mcp-status-row.test.ts` exit 0 · mac - · 424479c1525cbeeb956b3c1657db010745162957
- [ ] Unit test: «Allow» в строках — secondary, «Allow all» — единственная акцентная кнопка popover-а.
  - evidence: test-run pass · `pnpm test test/unit/mcp-chip.test.tsx` exit 0 · mac - · 424479c1525cbeeb956b3c1657db010745162957
- [ ] E2e `test/e2e/session-mcp.spec.ts` зелёный в CI на macOS и Windows; снимки popover-а в обеих темах приложены к PR.
  - evidence: test-run pass · `pnpm test:e2e session-mcp.spec.ts` exit 0 in CI run 43314911671 on macOS and Windows; shots in artifact e2e-snapshots-0-1 · mac - · 59af0c2cfd386571d8382137dd78908f5e0e8ee9
- [ ] Страницы `docs/features/mcp-servers.md` и `docs/features/ru/mcp-servers.md` описывают новую группу и кнопку.
  - evidence: commit pass · MCP list: one Restart for the not-started group, full names, quiet Allow (worfy-mcp-live 10) · - - · 424479c1525cbeeb956b3c1657db010745162957
- [ ] Правка вида названа в PR отдельной строкой. Merge — только после того, как владелец посмотрел снимки (Q12).
  - evidence: commit pass · PR 1841 description, line Look change · - - · 424479c1525cbeeb956b3c1657db010745162957
- [ ] lint, typecheck, unit и contract test-ы затронутых модулей, gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 59af0c2cfd386571d8382137dd78908f5e0e8ee9

## Где в коде

- `src/renderer/session/McpChip.tsx` — popover, группы строк, кнопки строк.
- `src/shared/agent/mcp-status.ts` — действия строки (`actions`), источник `claudeai`.
- `test/unit/mcp-chip.test.tsx`, `test/unit/mcp-status-row.test.ts`, `test/e2e/session-mcp.spec.ts`.
- `docs/features/mcp-servers.md`, `docs/features/ru/mcp-servers.md`.

## Вне скоупа

- Почему connector-ы claude.ai остаются «not started» после Restart — Ticket 11.
