# 09 — Окно запуска Autopilot в приложении: кнопка Canvas, канал `autopilot.prepare`

Type: task
Status: done 2026-11-06T16:03Z
PR: #1507
Blocked by: 07
Source: [spec.md](../spec.md), «Что видит владелец», п. 1–2; «Окно запуска (прототип)»; «Как работает» → «Окно запуска»; «Решения владельца», 8, 10, 11, 13, 15; [02](02-старт-при-идущей-работе.md), решения 10–15; прототип — Card `card-918c77d9`

## Что происходит

- Кнопка Autopilot на рамке Epic-а стартует Run сразу, без окна, в Run mode из Settings
  (`run={() => start(projectId, epic.epic)}`, `src/renderer/canvas/actions/AutopilotAction.tsx:445`; `start`, `:210-219`).
  Отказ — toast (`refused`, `:229-232`).
- Прогноз кнопки уже читается (`autopilot.estimate`, `AutopilotAction.tsx:335-342`); прогноз системного окна агента —
  `forecastLines` (`src/main/autopilot/chat-confirm.ts:217-228`) из тех же источников (`appAutopilotStarter`, `:271-313`).
- Образец окна в приложении — `MachineDialogFrame` (`src/renderer/machines/ChangeAddressDialog.tsx:30-60`: portal,
  `role="dialog"`, `aria-modal`, Esc) и хозяин окон в `AppShell` (`src/renderer/shell/AppShell.tsx:124`).
- e2e нажимают кнопку `action-autopilot` и ждут старт сразу — 27 мест в 7 spec-ах.

## Что делаем

1. **Канал чтения `autopilot.prepare`** (`src/shared/ipc/autopilot-prepare.ts`, `src/main/ipc/autopilot-prepare.ts`,
   `project`, `read`): вход `{ projectId, epics: string[], tickets? }`, ответ — Project, по Epic-у Ticket-ы и Wave-ы
   осталось и дата принятия (пока `null`, заполнит 16), Vendor и Session Orchestrator-а, прогноз (время, токены,
   budget), Limits сейчас, Modes (Eco mode, Auto-approval, Auto-continue), Run mode по умолчанию, `busy` —
   `Orchestrators.busy` из 07 (ход, число сообщений, задачи по именам). Сборка — `src/main/autopilot/prepare.ts`,
   источники — как у `appAutopilotStarter`.
2. **Окно** `src/renderer/autopilot/StartAutopilotModal.tsx` + store `start-modal.ts` + `autopilot-modal.css`: вид
   «Canvas button» и «Orchestrator busy» прототипа — сетка фактов, Mode (сегменты, «(default)», строка пояснения),
   уведомление занятости, подсказка клавиш, Cancel и «Start Autopilot» / «Start when free». Фокус на Cancel при
   открытии, Tab по кругу внутри, Esc — Cancel, ⌘↩ — старт. «change in Modes» открывает меню Modes Orchestrator-а.
   Окно монтируется в `AppShell`, как `<MachineDialogs />`.
3. **Кнопка Canvas** открывает окно; старт — `autopilot.start` с выбранным `mode`; отказ — toast, как сейчас; окно
   закрывается после старта или принятого ожидания.
4. **Цвет `--danger`** и кнопка `danger` (для «Interrupt and start» Ticket-а 10) — в `autopilot-modal.css` и в
   `docs/design/F-SPEC.md` (раздел кнопок), обе темы.
5. **e2e-helper** `test/e2e/autopilot-start.ts`: `startAutopilot(page, { mode? })` — кнопка, окно, старт; все 27 мест
   переходят на него.

## Готово, когда

- [ ] Unit test окна: факты из ответа `prepare`, Run mode по умолчанию отмечен, Esc и Cancel не стартуют, ⌘↩ стартует,
      фокус на Cancel, Tab не выходит из окна; при `busy` — уведомление и «Start when free».
  - evidence: test-run pass · node scripts/vitest-electron.mjs test/unit/start-autopilot-modal.test.tsx: 10 passed, exit 0 (commit e7702b6f4) · mac - · e7702b6f4f86cf1d217b02b2e8ce70444b9b067d
  - evidence: review pass · PR #1507 · - - · b875fb7cb452cdaccdbde58283359e6678c14efe
- [ ] Contract test `autopilot.prepare`: прогноз и Limits — те же строки, что `forecastLines` на том же журнале;
      Orchestrator на Codex — Vendor и окно Codex.
  - evidence: test-run pass · node scripts/vitest-electron.mjs test/contract/autopilot-prepare.test.ts: 9 passed, exit 0 (commit e7702b6f4) · mac - · e7702b6f4f86cf1d217b02b2e8ce70444b9b067d
  - evidence: review pass · PR #1507 · - - · b875fb7cb452cdaccdbde58283359e6678c14efe
- [ ] e2e: кнопка → окно → «Start Autopilot» → Run идёт; Orchestrator в ходе → «Start when free» → строка ожидания.
  - evidence: test-run pass · pnpm test:e2e test/e2e/autopilot-start-modal.spec.ts: 2 passed, exit 0 · mac - · e7702b6f4f86cf1d217b02b2e8ce70444b9b067d
  - evidence: review pass · PR #1507 · - - · b875fb7cb452cdaccdbde58283359e6678c14efe
- [ ] Снимки окна (Canvas button, Orchestrator busy) в обеих темах — `../evidence/09-окно-запуска-*.png`, ссылка в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.
  - evidence: gate pass · gate fast: [gate] green (fast): worfy/.:lint worfy/.:typecheck worfy/.:test, exit 0 on e7702b6f4 · mac - · e7702b6f4f86cf1d217b02b2e8ce70444b9b067d
  - evidence: review pass · PR #1507 · - - · b875fb7cb452cdaccdbde58283359e6678c14efe
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42244367283 · ci - · b875fb7cb452cdaccdbde58283359e6678c14efe

## Тесты

- Unit `test/unit/start-autopilot-modal.test.tsx`, contract `test/contract/autopilot-prepare.test.ts`, e2e
  `test/e2e/autopilot-start-modal.spec.ts` (новые).
- Правка e2e на helper: `test/e2e/autopilot.spec.ts`, `autopilot-chat.spec.ts`, `autopilot-faults.spec.ts`,
  `linked-autopilot.spec.ts`, `linked-read-only.spec.ts`, `linked-machines.spec.ts`, `packaged.spec.ts`.
- Сначала падающий: кнопка → ожидалось окно, сейчас Run стартует сразу.

## Где в коде

- `src/renderer/autopilot/StartAutopilotModal.tsx`, `src/renderer/autopilot/start-modal.ts`,
  `src/renderer/autopilot/autopilot-modal.css` (новые)
- `src/shared/ipc/autopilot-prepare.ts`, `src/main/ipc/autopilot-prepare.ts`, `src/main/autopilot/prepare.ts` (новые)
- `src/renderer/canvas/actions/AutopilotAction.tsx`
- `src/renderer/shell/AppShell.tsx`
- `docs/design/F-SPEC.md`
- `test/unit/start-autopilot-modal.test.tsx`, `test/contract/autopilot-prepare.test.ts`,
  `test/e2e/autopilot-start-modal.spec.ts`, `test/e2e/autopilot-start.ts` (новые)
- `test/e2e/autopilot.spec.ts`, `test/e2e/autopilot-chat.spec.ts`, `test/e2e/autopilot-faults.spec.ts`,
  `test/e2e/linked-autopilot.spec.ts`, `test/e2e/linked-read-only.spec.ts`, `test/e2e/linked-machines.spec.ts`,
  `test/e2e/packaged.spec.ts`

Только читать: `src/main/autopilot/chat-confirm.ts`, `src/renderer/machines/ChangeAddressDialog.tsx`,
`src/renderer/machines/MachineDialogs.tsx`, прототип `card-918c77d9` (путь — spec, «Окно запуска»).

## Итог

Кнопка Autopilot рамки Epic-а больше не запускает run по клику: она открывает окно **Start Autopilot**
(`src/renderer/autopilot/StartAutopilotModal.tsx`, store `start-modal.ts`, стили `autopilot-modal.css`, смонтировано в
`AppShell`). Факты окна main отдаёт по новому read-каналу `autopilot.prepare` (`src/shared/ipc/autopilot-prepare.ts`,
`src/main/ipc/autopilot-prepare.ts`, построитель `src/main/autopilot/prepare.ts`): Project, Epic-и, Ticket-ы и Wave-ы,
Vendor и Session Orchestrator-а, прогноз (те же строки `dialogLines`, что в диалоге `autopilot_start`), бюджет, Limits,
Run mode по умолчанию, часы Start window, занятость Orchestrator-а. `run.ts` только читается (`startRefusal`).
Раздел «Start Autopilot window» — в `docs/design/F-SPEC.md`; абзацы — в `docs/features/autopilot.md` и `ru/`.

Тест первым: `test/unit/start-autopilot-modal.test.tsx` был красным на старой кнопке
(«Unable to find role="dialog" and name "Start Autopilot"»). Тесты: unit 10, contract 9, e2e 2
(`autopilot-start-modal.spec.ts`); 22 клика старта в `autopilot.spec.ts`, `autopilot-faults.spec.ts`,
`linked-autopilot.spec.ts`, `linked-machines.spec.ts` идут через helper `startAutopilot(button)`; остальные совпадения
`action-autopilot` только проверяют видимость и не менялись. Вне списка «Где в коде» поправлены
`test/unit/canvas-actions.test.tsx` (старт через окно) и `test/unit/link-access.test.ts` (новый read-канал).

Решено без владельца:
- Modes окно читает хуками меню Modes, а не из `prepare`.
- Прогноз — время и доля недели, без token-ов: данных о token-ах нет.
- Пункт «Start now (later, from the Autopilot line)…» не сделан до ticket 10.
- `startAutopilot` принимает locator кнопки, а не page.
- Start anyway по-прежнему стартует сразу, в режиме по умолчанию, без окна.
- Отказ старта закрывает окно; отказ — toast и tooltip кнопки, как раньше.
- Если факты не прочитались, окно показывает ошибку, а старт всё равно работает.
- `accepted` в ответе — `null` до ticket 16.
- «change in Modes» открывает меню Modes кликом по DOM (`shortcut:` в `start-modal.ts`).
- Снимки названы латиницей (`09-start-window-*`): helper не принимает кириллицу.

Снимки ждут проверки человеком и поэтому не закоммичены: `09-start-window-canvas-button-{light,dark}.png`,
`09-start-window-orchestrator-busy-{light,dark}.png` лежат в `test-results/evidence-09/` worktree-а
`agent-afce7bf5f5c7003d2`. Данные на них тестовые (Project `demo`, фейковая Session).
