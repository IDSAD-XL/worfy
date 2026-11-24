# 138 — Autopilot: сообщение «отложи Ticket» называет ветку Ticket-а

Type: bug
Status: done 2026-11-20T19:02Z
PR: #2102
Branch: worfy-polish/138
Blocked by: none
Source: решение владельца 2026-11-20, Q5. Тот же провал worfy-polish 131 исправил в skill-е epic-wave (#2086): block,
записанный в своём дереве Orchestrator-а, не виден под `claimed` ветки Ticket-а.

Кто: агент. Глубина review — `medium`. Не платформенный PR.

## Что происходит

- Autopilot (автоматический запуск Wave-ов в worfy) после 2 continuation-ов (сообщений «продолжай») просит
  Orchestrator отложить застрявший Ticket. Текст строит `setAsideText` (`src/shared/autopilot/continuation.ts:39-48`),
  шлёт его `src/main/autopilot/run.ts:2905-2916`: `Run: ticket block <epic> <NN> "stuck: …" --waits owner. Then end
  the turn.` Где запускать команду, текст не говорит.
- Orchestrator запускает её в своём дереве (main checkout). worfy читает origin/main, поверх которого лежит закоммиченная
  ветка каждого worktree Ticket-а, а ветка никогда не отменяет `blocked` из main
  (`harness/skills/epic-wave/SKILL.md:391-399`). Поэтому block в дереве Orchestrator-а остаётся невидим под `claimed`
  ветки Ticket-а, пока не вольётся docs PR. Autopilot по-прежнему видит Ticket застрявшим, и очередь Epic-ов не идёт
  дальше.
- worfy-polish 131 (#2086) записал в skill epic-wave, где ставить block: в worktree Ticket-а, commit на его ветке только
  с файлом Ticket-а; Ticket без worktree — на main. Сообщение Autopilot-а этого не повторяет.

## Что делаем

1. `setAsideText` называет место команды: для каждого Ticket-а — в его worktree, commit на ветке Ticket-а только с
   файлом Ticket-а (`git -C <worktree> commit -m "<message>" -- <ticket file>`); Ticket без worktree — на main. Текст
   короткий и согласован с абзацем «Where the owner-stop status is written» skill-а epic-wave. Если run знает ветку
   или worktree Ticket-а, текст называет их; не знает — описывает правило словами.
2. Текст закреплён в test-ах и в документации — они меняются вместе с ним:
   - `test/contract/autopilot-faults-codex.test.ts:150`;
   - `test/contract/autopilot-faults-ladder.test.ts:47` (`SET_ASIDE_01`) и `:192`;
   - `docs/features/autopilot-faults.md:254`; перевод `docs/features/ru/autopilot-faults.md:263` — по правилу проекта
     (ADR-0088: правится английская страница).
3. Unit test `setAsideText` (если его нет — рядом с другими test-ами `continuation.ts`): текст называет место для
   Ticket-а с worktree и для Ticket-а без него. Красный до правки.

## Готово, когда

- [ ] Сообщение «отложи Ticket» называет, где запускать `ticket block … --waits owner`: worktree Ticket-а с commit-ом на
      его ветке, Ticket без worktree — main.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/autopilot-continuation.test.ts test/contract/autopilot-faults-ladder.test.ts test/contract/autopilot-faults-codex.test.ts` exit 0 · mac - · 2c347bb81d232f90a16cc2a09aefc3666add4340
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/autopilot-continuation.test.ts test/contract/autopilot-faults-ladder.test.ts test/contract/autopilot-faults-codex.test.ts` exit 0 (Full and Silent texts) · mac - · 21ef295727ebd5cc4f48627d7fdd6250d98bb300
  - evidence: review pass · PR #2102 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Unit test текста красный до правки и зелёный после; mutant (место убрано из текста) — красный.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/autopilot-continuation.test.ts` exit 1 before the change (3 failed), exit 0 after; mutant without the place: 7 failed · mac - · 2c347bb81d232f90a16cc2a09aefc3666add4340
  - evidence: test-run pass · round 2: the same three files exit 1 before the change (9 failed), exit 0 after; mutants epic filter removed and mode not passed: red · mac - · 21ef295727ebd5cc4f48627d7fdd6250d98bb300
  - evidence: review pass · PR #2102 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Contract test-ы `autopilot-faults-codex.test.ts` и `autopilot-faults-ladder.test.ts` и
      `docs/features/autopilot-faults.md` совпадают с новым текстом.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs` over all 42 test/unit and test/contract autopilot-*.test.ts exit 0; `pnpm lint` (check-feature-docs) exit 0 · mac - · 2c347bb81d232f90a16cc2a09aefc3666add4340
  - evidence: test-run pass · `node scripts/vitest-electron.mjs` over all 42 test/unit and test/contract autopilot-*.test.ts exit 0; `pnpm lint` exit 0 · mac - · 21ef295727ebd5cc4f48627d7fdd6250d98bb300
  - evidence: review pass · PR #2102 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0; `pnpm lint` exit 0; `pnpm typecheck` exit 0 · mac - · afc1146d4794844532b64d11723baf365e02c7ee
  - evidence: gate pass · `gate fast` exit 0; `pnpm lint` exit 0; `pnpm typecheck` exit 0 · mac - · efeb1df63474580925d8ff01fa8ca8438ae85c07
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44783618672/job/136473542242 · ci - · 4a517c31c4d32601f74753cc0a37e8072e52a4a3

## Где в коде

- `src/shared/autopilot/continuation.ts:31-48` (`setAsideText`, `toolWord`)
- `src/main/autopilot/run.ts:2905-2916` — вызов `setAsideText`, откуда брать ветку или worktree Ticket-а
- `test/contract/autopilot-faults-codex.test.ts:150`, `test/contract/autopilot-faults-ladder.test.ts:47,192`
- `docs/features/autopilot-faults.md:254`
- `harness/skills/epic-wave/SKILL.md:376-399` — только читать: правило worfy-polish 131
- `src/shared/autopilot/cycle.ts` — только читать: какие Ticket-ы Autopilot считает застрявшими

## Вне скоупа

- worfy сам статус не пишет (ADR-0002): команду по-прежнему запускает Orchestrator.
- Правило skill-а epic-wave — его уже исправил worfy-polish 131.

## Итог

- `setAsideText` (`src/shared/autopilot/continuation.ts`) после команд `ticket block … --waits owner` говорит, где их
  запускать, теми же словами, что абзац «Where the owner-stop status is written» skill-а epic-wave: `Run it in the
  Ticket's own worktree (branch <branch>) and commit only the Ticket file on its branch: git -C <worktree> commit -m
  "<message>" -- <ticket file>. A Ticket with no worktree gets the block on the main branch the way the documents PR
  carries statuses, never by a direct commit to main. Then end the turn.` Для нескольких Ticket-ов — `Run each in its
  Ticket's own worktree (05: branch …; 07: branch …)`.
- Silent mode (раунд 2 review): файлы Ticket-ов в папке Workflow вне репозитория, поэтому вместо worktree и commit текст
  говорит `Run it from any directory, with no commit: in Silent mode the status goes straight into the Workflow folder.`
  Mode run берёт из нового dep `projectMode` (`readProjectLayout(...).mode`, проведён в `src/main/ipc/autopilot.ts` —
  файла нет в «Где в коде»); без dep или при ошибке чтения — Full. Решено без владельца, подтвердить.
- Ветку run берёт из свежего чтения workflow (`setAside` в `src/main/autopilot/run.ts`): `fromBranch` Ticket-а —
  ветка worktree, из которой worfy прочёл его claim. Нет `fromBranch` (claim уже в main, или ветка не читалась) —
  скобок нет, правило только словами. Путь worktree в модели worfy не хранится, поэтому текст называет ветку, а
  `<worktree>` остаётся местом для Orchestrator-а. Решено без владельца, подтвердить.
- Кто что сторожит. Unit test-ы `test/unit/autopilot-continuation.test.ts` (место без ветки, с веткой одного и двух
  Ticket-ов) были красными до правки (3 failed, exit 1). Contract test scenario 2 `autopilot-faults-ladder.test.ts`
  читает claim Ticket-а 01 из ветки `demo/01` и ждёт её имя в сообщении: mutant «run.ts не передаёт branches» — красный
  (1 failed). Mutant «место убрано из текста» — 7 test-ов красные в unit, ladder и codex. Раунд 2: новые test-ы (Silent
  в unit и contract, новая оговорка про docs PR) красные до правки (9 failed, exit 1). У Ticket-а 01 второго Epic-а в
  scenario 2 своя ветка `demo-b/01`: mutant «убран фильтр по Epic-у в run.ts» — красный; mutant «run.ts не передаёт
  mode» — Silent-сценарий красный.
- Для contract test-а `test/contract/autopilot-faults-setup.ts` получил опции `fromBranch` (список Epic, номер,
  ветка; Ticket не blocked и не done читается с этой веткой, без настоящего worktree) и `silent` (dep `projectMode`
  отвечает `silent`). Файла нет в «Где в коде» — решено без владельца, подтвердить.
- Тексты в `autopilot-faults-codex.test.ts`, `autopilot-faults-ladder.test.ts` и `docs/features/autopilot-faults.md`
  (и перевод `docs/features/ru/autopilot-faults.md`, по брифу) — новые.
