# 54 — Contract test-ы Terminal AI и shell integration не загружаются на Windows: `/bin/sh` при загрузке модуля в шести файлах `test/contract`

Type: task
Status: open
Blocked by: 53
Source: Session на Windows-ПК «Worfy тесты на ПК», найдено попутно при работе над
[Ticket-ом 53](53-e2e-не-загружаются-на-windows-из-за-bin-sh.md) («Итог» на ветке `worfy-windows/53`,
[PR #387](https://github.com/IDSAD-XL/worfy/pull/387), не влит; пункт «Вне скоупа, найдено
попутно»). Отдельный Ticket — решение Session на Mac 2026-10-16. Код перечитан на Mac по main
`ed820a51` и ветке `worfy-windows/53` `86f2e2e7`.

## Что происходит

- **Шесть файлов `test/contract` при загрузке модуля ищут zsh через `/bin/sh`:**
  `const ZSH = execFileSync('/bin/sh', ['-c', 'command -v zsh'], …)` на верхнем уровне файла.
  - `test/contract/terminal-ai-fix.test.ts:45`;
  - `test/contract/terminal-ai-next-command.test.ts:41`;
  - `test/contract/terminal-ai-request.test.ts:47`;
  - `test/contract/terminal-ai-suggest.test.ts:42`;
  - `test/contract/terminal-ai-zle.test.ts:23`;
  - `test/contract/terminal-shell-integration.test.ts:24`.

  На Windows `/bin/sh` нет: `execFileSync` бросает `ENOENT` при загрузке, и vitest роняет каждый из
  шести файлов целиком — 0 test-ов. Остальной прогон vitest идёт дальше, в отличие от Playwright в
  Ticket-е 53, но test-ы этих файлов, которым zsh не нужен, тоже не запускаются (например, describe
  «the handler of Next command», `terminal-ai-next-command.test.ts:208`, или «the words and the
  notes», `terminal-ai-request.test.ts:334`).
- **Ticket 53 чинит то же в `test/e2e`** (ветка `worfy-windows/53`):
  - поиск zsh — функция `zshPath()` в `test/e2e/zsh.ts`, первый вызов спрашивает `/bin/sh`, импорт
    ничего не запускает;
  - `NO_ZSH` (`process.platform === 'win32'`) и причина пропуска `NO_ZSH_ON_WINDOWS` в том же файле;
    test-ы zsh на `win32` пропускаются с причиной;
  - защита от повтора — test по тексту `test/unit/e2e-no-spawn-on-load.test.ts`: ни один файл
    `test/e2e` и ни один файл, который они загружают, не запускает процесс при загрузке модуля.
    `test/contract` он не смотрит.
- **zsh этим test-ам нужен по смыслу.** Terminal AI и shell integration Ticket-а 01 Epic-а
  `worfy-terminal-ai` работают в zsh. PowerShell для Terminal AI — позже, вне Epic-а
  `worfy-terminal-ai`.

## Что делаем

1. **Поиск zsh — функция, а не значение модуля**, как в Ticket-е 53. Шесть файлов зовут `zshPath()`
   там, где zsh нужен (в test-е, `beforeAll` или helper-е). Брать ли `test/e2e/zsh.ts` или вынести
   его в общий для `test/e2e` и `test/contract` файл — выбор исполнителя, в «Итог».
2. **Test-ы, которым нужен zsh, на `win32` пропускаются с причиной** (`NO_ZSH_ON_WINDOWS` или своя).
   Test-ы тех же файлов, которым zsh не нужен, идут и на Windows. На macOS и Linux ничего не
   меняется.
3. **Защита от повтора** — static check Ticket-а 53 смотрит и `test/contract`: ни один файл
   `test/contract` и ни один файл, который они загружают, не запускает процесс при загрузке модуля.
   Test по тексту красный на main (находит шесть вызовов) и зелёный после правки.

## Готово, когда

- [ ] На Windows-ПК шесть файлов загружаются: `pnpm exec vitest run --project contract` по каждому —
      ни одного `spawnSync /bin/sh ENOENT`; test-ы zsh — skipped с причиной; test-ы без zsh идут.
      Числа passed, skipped и failed по файлам — в «Итог». Это проверяет Session на Windows-ПК.
- [ ] На macOS те же test-ы идут, как раньше: число test-ов каждого из шести файлов (passed и
      skipped) то же, что на main; числа — в «Итог».
- [ ] Static check смотрит `test/contract`: красный на main (шесть вызовов найдены), зелёный после
      правки.
- [ ] Мутант: вернуть `const ZSH = execFileSync(…)` в один из шести файлов — static check красный.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 на Mac; gate full — exit 0 и строка
      `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный.

## Тесты

- Unit `test/unit/e2e-no-spawn-on-load.test.ts`: каталог `test/contract` в обходе; таблица случаев
  — вызов на верхнем уровне файла `test/contract` найден, вызов в теле test-а проходит.
- Мутант — выше.

## Где в коде

- `test/contract/terminal-ai-fix.test.ts`
- `test/contract/terminal-ai-next-command.test.ts`
- `test/contract/terminal-ai-request.test.ts`
- `test/contract/terminal-ai-suggest.test.ts`
- `test/contract/terminal-ai-zle.test.ts`
- `test/contract/terminal-shell-integration.test.ts`
- `test/e2e/zsh.ts`
- `test/unit/e2e-no-spawn-on-load.test.ts`

`test/e2e/zsh.ts` и `test/unit/e2e-no-spawn-on-load.test.ts` появляются с Ticket-ом 53 (PR #387);
отсюда `Blocked by: 53`.

Пересечения с другими Epic-ами: `test/contract/terminal-ai-request.test.ts` — в «Где в коде» Ticket-а
13 `worfy-terminal-ai` (панель ⌘I шлёт текущую строку shell-а), `test/contract/terminal-ai-zle.test.ts`
— Ticket-а 11 того же Epic-а (программа в Terminal-е пишет в соединение shell-а). Сверка перед claim;
кто влит вторым, тот делает rebase.

## Вне скоупа

- Другие файлы `test/contract`, которые на Windows падают по существу (`/bin/sh` как `SHELL` в
  test-е, stub-ы `#!/bin/sh`, команды POSIX) — Ticket 14.
- Terminal AI на Windows (PowerShell) — позже, вне Epic-а `worfy-terminal-ai`.

## Итог

—
