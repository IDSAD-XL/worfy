# 08: Редактор Schedule-а и Run now

Type: task
Status: open
Blocked by: 02, 05, 07
Source: [spec.md](../spec.md), «Ticket-ы», 08; «Решения по реализации» («Вид Schedules» — редактор, «Согласие»);
«Решения по test-ам» (`schedule-editor.test.tsx`, `schedules.spec.ts`); решения владельца Q3, Q7, Q13, Q18 grilling-а и Q4
spec-а; разбор critic-а, возражение 2; «Волны», Wave 6

Кто: агент. Глубина ревью — `medium`.

## Что происходит

- Создать Schedule без Assistant-а нельзя: формы нет. Q7: Schedules работают без Assistant-а.
- e2e этого Ticket-а ждёт планировщик (05) и run (06): поэтому он после них (возражение 2 critic-а).

## Что строить

- Редактор (New schedule и Edit): Name, Project, Vendor, Model (picker Vendor-а; Accept записывает точный id), Prompt
  (точный текст, моноширинный, до 20 000 символов), When — пресеты, время, дни, Time zone (по умолчанию пояс Machine),
  у Custom — поле RRULE; Limits — «Use global threshold (80 %)» или свои значения.
- «Next runs:» — три даты, которые считает main через канал (не renderer); ошибка правила под полем («More often than
  once an hour is not allowed»).
- Project без git — «Schedules need a git repository: each run works in its own worktree.», Accept неактивен.
- Правка Prompt, Project, Vendor или Model — строка «This change needs a new Accept» и кнопка Accept; остальное — Save.
- Кнопка **Run now** на карточке (Ticket 07): run вида run now, недоступна, пока идёт run этого Schedule или Schedule не
  Active.
- «Review and Accept» у Needs Accept открывает редактор.

## Где в коде

- `src/renderer/schedules/ScheduleEditor.tsx` (новый), `src/renderer/schedules/ScheduleCard.tsx`
- `src/main/ipc/schedules.ts` — канал ближайших дат и run-now
- `test/unit/schedule-editor.test.tsx`, `test/e2e/schedules.spec.ts` (новые), строка в `scripts/e2e-specs.table.json`

## Test-ы

- Unit: три даты; «This change needs a new Accept» на правке четырёх полей и Save на остальных; Accept неактивен без git;
  Run now недоступен во время run-а.
- E2E `schedules.spec.ts`: Assistant выключен; New schedule, три даты, Accept; `WORFY_NOW` за 30 с до даты → Node
  Session с принятым текстом и строка Done; Run now; Pause/Resume; Delete с подтверждением; View button переносится в
  Header. `WORFY_AGENT=fake`.
- Сначала падающий test.

## Готово, когда

- [ ] Schedule создаётся и правится в форме при выключенном Assistant-е; Run now стартует run.
- [ ] `schedule-editor.test.tsx` и `schedules.spec.ts` зелёные.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
