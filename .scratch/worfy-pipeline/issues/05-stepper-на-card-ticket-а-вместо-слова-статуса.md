# 05 — Stepper на Card Ticket-а вместо слова статуса; бейдж вердикта — из отметки `review`

Type: task
Status: claimed 2026-10-18T13:53Z
Branch: worfy-pipeline/05
Blocked by: 03
Source: решение владельца 2026-10-17, grilling о Pipeline, пункты 2, 5 ([spec.md](../spec.md),
«Решения владельца»); [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md).

## Что происходит

- **Card Ticket-а показывает слово статуса:** чип `claimed`, `open`, `no status`, `blocked`, `done`
  (`src/renderer/canvas/nodes/TicketNode.tsx:31-45`), то же слово — в `aria-label` (`:112`, `:131`).
- **Бейджи PR, CI и вердикта** — `src/renderer/canvas/badges/ChecksBadges.tsx:60`, `:69`. Вердикт —
  поле `verdict` снимка `checks` (`src/shared/ipc/checks.ts:87-90`), его находит `verdictOf` в тексте
  комментариев PR (`src/main/github/prs.ts:164-176`, вызов в `parsePrList`).
- После Ticket-а 03 Stage каждого Ticket-а и отметки на head SHA приходят через
  `src/renderer/pipeline/usePipeline.ts`.

## Что делаем

1. **`src/renderer/pipeline/Stepper.tsx`** — ряд точек по Stage Pipeline Project-а: пройденные,
   текущий (с подписью Stage и «кого ждёт»), будущие; пропущенный Check (`skipped`) — отдельным
   видом; `blocked` — пометка на текущем шаге с причиной в подсказке; `rework` — на Implementing.
   Узкая Card показывает только текущий Stage и «N/M».
2. **`TicketNode.tsx`:** stepper вместо чипа статуса; `aria-label` — `Ticket NN, <Stage>`; бейджи PR,
   CI и вердикта остаются под ним как подробности.
3. **Вердикт из отметки.** Поле `verdict` снимка `checks` берётся из отметки `review` на head SHA
   (`success` → `VERIFIED`, `failure` → `REJECTED`, `pending` и устаревшая — нет вердикта).
   `verdictOf` из `src/main/github/prs.ts` удаляется. Журнал узкого круга Autopilot
   (`narrowRoundsOf`, `src/main/autopilot/run.ts:67-68`) — вне этого Ticket-а: он не Stage.
4. Слово статуса в `epic-layout.ts` (прогресс Epic-а в боковой панели) не меняется: прогресс — по
   статусам, не по Stage.

Не входит: выделение застрявших (06).

## Готово, когда

- [ ] `pnpm test test/unit/ticket-stepper.test.tsx` — exit 0: Pipeline worfy и Atakama; текущий Stage
      и «кого ждёт» в подписи; `skipped`, `blocked`, `rework`; узкая Card.
- [ ] `pnpm test test/unit/checks-badges.test.tsx test/contract/github-prs.test.ts` — exit 0: вердикт —
      из отметки; комментарий `VERIFIED` без отметки вердикта не даёт.
- [ ] `pnpm test:e2e test/e2e/checks-badges.spec.ts` — exit 0 (сценарий вердикта переведён на отметку
      в stub-е `gh`).
- [ ] `grep -rn "verdictOf" src/main/github` — пусто (exit 1).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.
- [ ] (вручную) Stable copy после мержа: Card Ticket-а на CI и на Agent review — снимок в
      `../evidence/05-stepper.png`.

## Тесты

Сначала падающий `test/unit/ticket-stepper.test.tsx` на фикстуре снимка `pipeline.get`. Сценарий
e2e меняет только stub `gh` (commit status вместо комментария); `test/e2e/helpers.ts` не правится.

## Где в коде

- `src/renderer/pipeline/Stepper.tsx` (новый)
- `src/renderer/canvas/nodes/TicketNode.tsx`
- `src/renderer/canvas/badges/ChecksBadges.tsx`
- `src/shared/ipc/checks.ts`
- `src/main/github/prs.ts`
- `test/unit/ticket-stepper.test.tsx` (новый)
- `test/unit/checks-badges.test.tsx`
- `test/contract/github-prs.test.ts`
- `test/e2e/checks-badges.spec.ts`

## Итог

Сделано в ветке `worfy-pipeline/05`.

- **Stepper** — `src/renderer/pipeline/Stepper.tsx` и `stepper.css` (свой файл стилей; `pipeline.css` —
  Ticket-а 04). Точка на каждый Stage Pipeline: пройденные, текущий, будущие; Check, пройденный
  отметкой `skipped`, — пунктирное кольцо. Справа — имя текущего Stage (компактный чип; у Done — с
  галочкой, как у прежнего чипа done, F-SPEC) и «кого ждёт». `blocked` — кольцо на текущей точке и
  пометка «!» с причиной в подсказке; `rework` — кольцо у Implementing и пометка «↺» (слово — в
  подсказке и `aria-label`). Подсказка всего stepper-а — Stage, `sub` («failing», «waiting for gate»…),
  кого ждёт, «Stage N of M», пропущенные Check-и и причина блокировки. Узкий вид — только имя
  Stage и «N/M».
- **Card** (`TicketNode.tsx`): stepper в верхней строке вместо чипа статуса; `aria-label` —
  `Ticket NN, <Stage>`; бейджи PR, CI и вердикта — на прежнем месте под ним. Stage берётся из
  `usePipeline` (`pipeline.get`, Ticket 03), один запрос на Project.
- **Вердикт** — `reviewMarkVerdict` в `src/main/github/prs.ts`: отметка `review` среди commit status
  head-коммита: `SUCCESS` → `VERIFIED`, `FAILURE`/`ERROR` → `REJECTED`, `PENDING`/`EXPECTED` и
  отсутствие → нет вердикта. `verdictOf` и его regex удалены; `grep -rn "verdictOf" src/main/github` —
  пусто. Autopilot `verdictOf` не использовал: журнал узкого круга читает `pull.narrow`
  (`narrowRoundsOf`), он не тронут.

Выборы (вариант ближе к ADR-0067 и spec-у):

- **Пока Stage не пришёл** (main ещё не ответил, `pipeline.get` упал, снимок не называет Ticket) —
  прежний чип статуса и `aria-label` со словом статуса. Иначе Card была бы без состояния.
- **Когда stepper узкий.** Высота Card (`TICKET_HEIGHT` = 160) расписана по строкам, отдельной строки
  нет, поэтому stepper стоит в верхней строке (18 px). Узкий вид — когда в той же строке есть чип
  «Ready» или чип репозитория (Project из нескольких репозиториев), или Card уже 204 px; и сверх
  того — когда полный вид не помещается: stepper меряет себя (точки, имя Stage, пометки) до отрисовки
  и меряет снова, когда меняется Stage или ширина его места (ResizeObserver). Так у Pipeline worfy из
  девяти Stage Implementing с rework и blocked и Check «windows» на Card 204 px — узкий вид с целым
  именем и «N/M»; короткий CI — полный вид с точками. Чип репозитория уступает место stepper-у
  (`flexShrink`), имя репозитория остаётся в подсказке.
- **Цвета** — по таблице токенов F-SPEC: пройденный Stage — ready dot, текущий — working dot,
  blocked — ring. F-SPEC не говорит о точках Stage; мой выбор: у Done текущая точка — ready, у Queued
  — нейтральная (`--border-strong`). Имя Stage — чип в цветах заменённого чипа статуса: Queued —
  open (`--surface-raised`, `--text-secondary`), Done — done, blocked — blocked, остальные — working.
- **Тесная строка.** «Кого ждёт» занимает только место, оставшееся после имени Stage, и режется
  первым; узкий вид его не показывает (по Ticket-у — только Stage и «N/M»). Полный текст — в
  подсказке. Имя Stage режется только в последнюю очередь, когда даже узкий вид не помещается.
- **Silent mode.** Отметки там — локальный JSON, не commit status; снимок `checks` их не читает,
  поэтому бейджа вердикта в Silent mode нет (раньше его тоже не было: вердикт там — строка в файле
  Ticket-а, не комментарий PR). Пройденный Agent review виден в stepper-е.
- **Устаревшая отметка.** gh отдаёт `statusCheckRollup` только head-коммита, поэтому отметка на
  старом коммите в него не попадает и вердикта не даёт.

Правки вне «Где в коде» (с разрешения Orchestrator-а):

- `test/e2e/epic-frame.spec.ts:335` — ждал слово `claimed` на Card после `ticket claim`; теперь
  `aria-label` `Ticket 01, Implementing`. Замер «смена видна ≤ 1 s» по-прежнему по `data-state`
  (MutationObserver), он не менялся.
- `test/e2e/epic-frame.spec.ts:617-653` — test «state chips use the F tokens…» искал чипы статуса на
  Card-ах; теперь он проверяет stepper тех же четырёх Ticket-ов в обеих темах: имя Stage, его цвета
  (`--done-bg`/`--done-text`, `--working-bg`/`--working-text`, `--blocked-bg`/`--blocked-text`,
  `--surface-raised`/`--text-secondary` — все токены старого test-а) и цвет текущей точки
  (`--ready-dot`, `--working-dot`, кольцо `--blocked-ring`, `--border-strong`), пометку blocked.
  Проверка «у чипа есть иконка» ушла: у имени Stage иконки нет, состояние несёт слово.
- `harness/bin/tests/max-review.test.sh:132-141` — вырезал из `prs.ts` regex `VERDICT` (удалён вместе с
  `verdictOf`) и проверял, что worfy не видит вердикт `MAX-REVIEW:`. Теперь он читает `const NARROW`
  — единственный оставшийся читатель комментариев PR (журнал узкого круга) — и проверяет то же:
  regex найден, `NARROW: REJECTED` видит, `MAX-REVIEW: REJECTED` и `MAX-REVIEW: VERIFIED` не видит;
  `PRS_FILE` сохранён. Mutant (`NARROW` совпадает и с `MAX-REVIEW:`, через `PRS_FILE` на копию) —
  test красный, exit 1. Меняется только bash-test, скрипт Harness — нет: PR не платформенный.

Круг доработки после REJECTED (head до доработки 8b3cb187):

1. [med] Имя Stage резалось на Pipeline из девяти Stage — узкий вид теперь выбирается и по замеру
   (выше, «Когда stepper узкий»), «rework» стал пометкой «↺», чип репозитория уступает место.
   Test-ы: `test/unit/ticket-stepper.test.tsx` — «Stepper measures whether the full form fits»
   (шесть mutant-ов Stepper.tsx красные: без замера, без проверки имени, без повторного замера по
   ширине, без пометок в ключе замера, без галочки, без отписки ResizeObserver);
   `test/e2e/checks-badges.spec.ts` — два новых test-а с Profile из девяти Stage: Card 204 px,
   rework, blocked, оба сразу, Check «windows», CI; и Project из двух репозиториев с чипом
   репозитория и «Ready». Оба красные на mutant-ах «без замера» и «без flexShrink».
2. [low] Done — галочка в имени Stage; e2e `epic-frame.spec.ts` проверяет её у Done и её
   отсутствие у прочих.
3. [low] Комментарии `epic-frame.spec.ts:308-311` говорят о Card и stepper-е, не о чипе.

Проверки: `pnpm lint`, `pnpm typecheck` — exit 0; `pnpm test test/unit/ticket-stepper.test.tsx
test/unit/checks-badges.test.tsx test/contract/github-prs.test.ts` — exit 0; `pnpm test:e2e
test/e2e/checks-badges.spec.ts test/e2e/epic-frame.spec.ts` — exit 0 (9 passed), под замком e2e.
Снимок `../evidence/05-stepper.png` — шаг проверяющего, не сделан.

Третий круг (решение владельца 2026-10-18, одна находка [med] второго круга; head до него 94773dec,
ветка перед ним перенесена на `origin/main`):

- [med] Имя Stage резалось меньше чем на пиксель на Card 204 px с chip-ом репозитория и «Ready»
  («Queued» — 42.49 px в 42.09 px рядом с `app`, замер e2e). Причина: узкий stepper сжимался на свою
  долю нехватки места в строке (`flex-shrink` 1 против 100 у chip-а репозитория, доля пропорциональна
  ширине), а проверка `scrollWidth > clientWidth` округляет до целых пикселей.
  - `stepper.css`: узкий вид не сжимается (`.w-stepper[data-narrow='true'] { flex-shrink: 0 }`) —
    место отдаёт chip репозитория. Вариант ревьюера «имя Stage `flex: none`» в одиночку переносит тот же
    обрез на «N/M»: e2e на нём красный («the stepper beside app»: 74.37 px в 73.96 px).
  - `Stepper.tsx`: замер полного вида — в дробных пикселях: текст имени Stage — `Range.getBoundingClientRect()`,
    части stepper-а (точки, имя, пометки) — их прямоугольники, коробка — прямоугольник минус padding и
    border с учётом zoom React Flow; ResizeObserver сравнивает дробную ширину. «Кого ждёт» в замер не
    входит: он режется «…» в своей коробке по замыслу (первый вариант замера через Range по всему
    stepper-у делал узким каждый Card с «кого ждёт» — его поймал e2e `epic-frame.spec.ts`).
  - Test-ы: `test/e2e/checks-badges.spec.ts` — замер в дробных пикселях (имя Stage, «N/M», stepper,
    верхняя строка внутри Card); test с chip-ами репозитория и «Ready» — три Ticket-а с именами
    репозиториев ревьюера (`app`, `web-client`, `application-server`). Красный без правки CSS и на
    варианте «только `flex: none`». `test/unit/ticket-stepper.test.tsx` — заглушки прямоугольников вместо
    `scrollWidth`/`clientWidth`, два новых test-а на перерасход меньше пикселя; mutant-ы «целые пиксели в
    замере», «Range по всему stepper-у», «ResizeObserver по `clientWidth`» — красные.

Долг (пункты [low] второго круга, в этот круг не входят):

- В полном виде «кого ждёт» может сжаться до одной метки «·» («Implementing ·..»): у `.w-stepper__waits`
  `flex: 1 1 0` (`stepper.css`), замер на него не смотрит. Прятать его, когда не помещается.
- Комментарий над ResizeObserver в `Stepper.tsx` говорил, что ширина коробки не зависит от вида
  stepper-а; рядом с chip-ом репозитория — зависит. Исправлен в четвёртом круге (ниже).

Четвёртый круг (разрешение владельца 2026-10-18, «27 ок»; одна находка [med] ревью третьего круга,
head до него a065de16, ветка перед ним перенесена на `origin/main` 3b26e1f9):

- [med] `flex-shrink: 0` узкого stepper-а ломал правило «имя Stage режется только в последнюю очередь»:
  когда не помещается даже узкий вид, вся строка уходила за край Card и обрезалась без «…» — пропадали
  «N/M», «!» blocked и Ready (Queued с `label` «Waiting to start», chip репозитория и Ready — 214.61 px в
  182 px, замер e2e). Длина `name` Check-а и `label` не ограничена (`src/shared/workflow/pipeline.ts`).
  - `stepper.css`: правило `flex-shrink: 0` убрано, узкий stepper снова сжимается.
  - `TicketNode.tsx`: `flexShrink` chip-а репозитория — 100000 вместо 100. Flex делит нехватку места
    пропорционально `flexShrink` × ширина: при 100 stepper отдавал 0.4 px имени («Queued» рядом с `app`),
    при 100000 — меньше 1/64 px, пока chip не сжат до padding. Потом сжимается stepper, и имя режется «…».
  - `Stepper.tsx`: комментарий над ResizeObserver говорит, когда ширина коробки зависит от вида.
  - Test-ы: `test/e2e/checks-badges.spec.ts` — новый test «a Stage name too long even for the narrow
    form…»: Pipeline с Queued `label` «Waiting to start» и Check `windows-full-e2e`, Project из двух
    репозиториев, Card 204 px — Queued с Ready и blocked Check: имя режется «…», «N/M», «!» и Ready целые,
    верхняя строка внутри Card. Красный на CSS третьего круга (строка 214.61 в 182). Mutant
    `flexShrink: 100` — красный test «nine Stages, a repository chip and the Ready chip…» (42.49 в 42.09).
    `test/unit/ticket-stepper.test.tsx` — test «the box narrows by less than a pixel» (200 → 199.7 px);
    mutant `Math.round` на ширине ResizeObserver — красный.
