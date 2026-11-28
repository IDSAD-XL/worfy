# 07: Вид Schedules — View button, список, карточка, история

Type: task
Status: open
Blocked by: 03
Source: [spec.md](../spec.md), «Ticket-ы», 07; «Решения по реализации» («Вид Schedules»); решения владельца Q9, Q19, Q20
grilling-а; разбор critic-а, возражение 2 (Run now — в Ticket-е 08); «Волны», Wave 3

Кто: агент. Глубина ревью — `medium`.

## Что происходит

- Видов шесть: реестр `src/renderer/shell/views.tsx`, id — `VIEW_BUTTON_IDS` (`src/shared/layout/view-buttons.ts`).
  Ремонт расстановки (`repairViewButtons`) ставит недостающий id в его зону по умолчанию.
- Q19: своя View button, которую можно переносить. Q9: удаление только кнопкой. Q20: 50 run-ов в истории.

## Что строить

- View button `schedules`: седьмая в реестре и в `VIEW_BUTTON_IDS`, зона по умолчанию — Footer после Runs; подпись
  «Schedules», tooltip «Schedules — sessions that start by time on this machine», строка Command palette `view:schedules`,
  бейдж — число Schedules в Needs Accept и Paused after failures.
- Вид: все Schedules Machine по Project-ам, текущий сверху; строка «Schedules run only on this machine while worfy is
  open and the machine is awake.»; место под кнопку New schedule (её действие — Ticket 08).
- Карточка: имя, Project, Vendor · модель, правило словами, «Next: …» или причина, chip состояния, последний исход;
  кнопки Pause / Resume, Edit (открывает редактор Ticket-а 08), History, Delete. Delete — диалог «Delete schedule
  "<name>"? Its history goes too; worktrees and branches stay.» с Delete и Cancel. Needs Accept — «Review and Accept».
  Run now — не здесь, а в Ticket-е 08.
- История под карточкой: до 50 строк, новые сверху; вид, исход с причиной, длительность, Open Session, ветка, PR,
  «worktree kept» с Remove worktree.

## Где в коде

- `src/renderer/shell/views.tsx`, `src/shared/layout/view-buttons.ts`, `src/renderer/palette/commands.ts`
- `src/renderer/schedules/SchedulesView.tsx`, `ScheduleCard.tsx`, `ScheduleHistory.tsx` (новые, имена — предложение)
- `test/unit/schedules-view.test.tsx` (новый), `test/unit/view-buttons.test.ts`

## Test-ы

- Unit вида: состояния карточки, Delete с подтверждением, Cancel ничего не удаляет, история из 50 строк.
- `view-buttons.test.ts`: старая расстановка получает `schedules` в Footer.
- Сначала падающий test.

## Готово, когда

- [ ] View button Schedules стоит в Footer по умолчанию и переносится, как остальные; вид показывает карточки и историю.
- [ ] `schedules-view.test.tsx` и `view-buttons.test.ts` зелёные; снимки обеих тем приложены к PR.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
