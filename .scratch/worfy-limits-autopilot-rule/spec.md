# worfy-limits-autopilot-rule: новый Orchestrator после ожидания Limits, когда перечитывание старой Session дороже

Status: черновик 2026-11-28, ждёт данных Epic-а 1; владельцем не принят. Открывается, когда вкладка Cache losses
Epic-а [worfy-limits-ledger](../worfy-limits-ledger/spec.md) покажет потери «after a Limits wait» на данных владельца.
Critic: [docs/product/critic/worfy-limits-ledger-2026-11-28.md](../../docs/product/critic/worfy-limits-ledger-2026-11-28.md) — Split;
возражение 2 (правило строится для случая, которого журналы не видели) принято владельцем 2026-11-28.
Решение владельца 2026-11-28: Split — «Epic 2 позже — правило Autopilot Ticket-а 12, когда вкладка Cache losses покажет
случай».
Source: бывший Ticket 12 и вопрос Q3 черновика worfy-limits-ledger от 2026-11-13 (`git show c66e7215a:.scratch/worfy-limits-ledger/spec.md`,
пункт 5 «Где это видно», «Правило Autopilot-а» в «Решениях по реализации»).
Зависит от: [worfy-limits-ledger](../worfy-limits-ledger/spec.md) — потери cache с причиной «after a Limits wait»
(Ticket 04) и оценка перечитывания (Ticket 04, Ticket 07).
Ticket-ы: ещё не нарезаны. Нарезка — после условия начала ниже.

## Условие начала

Вкладка Cache losses (worfy-limits-ledger, Ticket-ы 04 и 08) за неделю работы владельца показывает строку «after a
Limits wait» с долей, которую владелец считает стоящей правила. Без неё Epic не открывается: правило меняет то, что
делает Autopilot посреди Wave, а цена его — новые поля журнала, настройка и e2e Run.

## Факты на 2026-11-28

- В 47 журналах Autopilot-а этого Mac (последний — 2026-11-19) нет ни одной строки `limits-hit` и `resumed`
  (critic 2026-11-28, возражение 2; повторено `grep -l '"kind":"limits-hit"'`, 0 файлов).
- Вне Autopilot-а отказы Limits бывают: грубый `grep` нашёл ответ `<synthetic>` с текстом отказа Limits в 3 из 40 главных
  транскриптов Project-а worfy за 30 дней. Это не разбор: сколько стоило продолжение, покажет учёт.
- Продолжение после ожидания идёт в ту же Session тремя путями: Run Autopilot-а (`CONTINUE_TEXT`,
  `src/main/autopilot/limits-wait.ts:37-43`), Auto-continue Orchestrator-а (`src/main/agent/orchestrator-continue.ts`) и
  закрытый список действий Assistant-а (`src/main/assistant/actions/limits-waits.ts:1-9`, worfy-assistant Ticket 08).
- Новую Session Autopilot берёт только между Wave-ами: `run.wavesSent > 0 && !run.turnMayCome && harness !== 'legacy'`
  (`src/main/autopilot/run.ts:2996`), сама смена — `newSession(run)` (`run.ts:3082`).

## Решение (набросок)

Когда окно сбросилось, а перечитывание старой Session дороже старта новой на порог и больше, Run начинает новую Session
Orchestrator-а. Она выполняет `wave-brief <epic>` (`harness/skills/epic-wave/SKILL.md:1989`) и продолжает Wave по «How
to resume a wave» (`:2001`); пауза, как сейчас, пишется в HANDOFF. Строка журнала `resumed` (сейчас без полей,
`src/shared/autopilot/journal.ts:266`, `:651`) получает необязательные `fresh` и `reread` (token-ы, которые перечитала
бы старая Session); старые строки читаются как раньше. В Settings → Autopilot — переключатель и порог
(`src/renderer/settings/AutopilotSection.tsx`, поле рядом с `autopilotBudget` и `autopilotRun`,
`src/shared/settings/app-settings.ts:47-56`). Только Claude.

Условия «новой Session» (`src/shared/autopilot/fresh-after-wait.ts`): (1) включено в Settings; (2) Vendor Run-а —
Claude; (3) Harness не `legacy`; (4) Orchestrator свободен — те же условия, что у новой Session между Wave-ами;
(5) оценка перечитывания старой Session минус оценка нового старта не меньше порога. Иначе — продолжение в ту же
Session, как сейчас.

## Не в этом Epic-е

- Auto-continue ручного хода: там решает человек, строка worfy-limits-ledger только показывает оценку.
- Продолжение Session-ов Canvas-а Assistant-ом — решается при открытии Epic-а, по данным учёта.
- Codex.

## Риски

- **Новая Session посреди Wave.** Orchestrator теряет рабочую память: каких агентов ждал, что уже решил. Правило
  срабатывает, только когда ничего не идёт; `wave-brief` и «How to resume a wave» рассчитаны на продолжение после
  перерыва; e2e (`test/e2e/autopilot.spec.ts`) проверяет, что Wave доходит до конца.

## Вопросы владельцу

1. **Q1 (бывший Q3 worfy-limits-ledger). Новый Orchestrator после ожидания Limits.**
   (а) Включено по умолчанию, порог — 150K token-ов разницы. Рекомендация: при включённом правиле дорогое продолжение
   не случается молча, а порог не трогает короткие разговоры; число порога уточняется по вкладке Cache losses.
   (б) Выключено по умолчанию.
   (в) Всегда новая Session после ожидания, без порога.
