# 06 — Feature page, ADR и термин Claude memory в глоссарии; ADR называет связь с `worfy-harness-guarantees/06`

Type: task
Status: open
Blocked by: 02, 04
Source: [spec.md](../spec.md), «Ticket-ы», строка 6; «Решения владельца», Q14; «Решено советником» («Имя: Claude
memory, не Memory», граница guard-а с Bash); «Решения по реализации» («ADR»); «Не в этом Epic-е» («Guard защищённых
папок»); «Волны», Wave 3

Кто: агент.

## Что строить

1. **ADR** записывает:
   - auto memory в worfy включена по умолчанию;
   - guard в Autopilot и его границу с Bash: обход через переменные и `cd` шаблон не ловит;
   - раздел Claude memory.
2. **ADR называет Ticket 06 Epic-а `worfy-harness-guarantees`** (guard защищённых областей в любом режиме): исключение
   памяти в его guard-е защищённых папок действует только в Session с человеком, а для Session без человека память
   закрывает этот Epic (Q14).
3. **Feature page** описывает то, что влито Ticket-ами 01–05: раздел Claude memory, guard в Session без человека и
   правила Harness о памяти.
4. **Термин «Claude memory»** с определением — в глоссарии: файлы auto memory Claude Code, одна папка на
   git-репозиторий и машину. Термин отличает его от двух занятых значений слова Memory: память процесса в version
   popover и правила Assistant-а в Settings → Assistant → Memory.

## Где в коде

- `docs/adr/` — ADR.
- `docs/features/` — feature pages, оглавление `docs/features/README.md`; занятые значения слова Memory —
  `docs/features/app-shell.md` (version popover) и `docs/features/assistant.md` (Settings → Assistant → Memory).
- `CONTEXT.md` — глоссарий worfy.
- `.scratch/worfy-harness-guarantees/issues/06-guard-защищённые-области-в-любом-режиме.md` и
  `.scratch/worfy-harness-guarantees/spec.md` — Ticket и spec, которые называет ADR.

## Готово, когда

- [ ] ADR записывает: auto memory включена по умолчанию; guard в Autopilot и его граница с Bash (переменные и `cd`);
      раздел Claude memory.
- [ ] ADR называет `worfy-harness-guarantees/06`: исключение памяти в guard-е защищённых папок — только для Session с
      человеком; для Session без человека память закрывает `worfy-memory`.
- [ ] Feature page описывает раздел Claude memory, guard и правила Harness о памяти так, как они влиты Ticket-ами 01–05.
- [ ] `CONTEXT.md` определяет термин Claude memory и отличает его от Memory в version popover и от Settings →
      Assistant → Memory.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
