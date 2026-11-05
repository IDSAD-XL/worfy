# 12 — Меню Modes: перенести Eco mode и Auto-approval

Type: task
Status: claimed 2026-11-05T08:19Z
Blocked by: —
Source: [spec.md](../spec.md), «Что видит владелец», п. 1; «Решения владельца 2026-11-05», Q10–Q14; [worfy-throughput 60](../../worfy-throughput/issues/60-переключатель-eco-mode-в-чате-orchestrator-а.md) (переключатель Eco mode); [worfy-auto-approve](../../worfy-auto-approve/spec.md), Ticket 06 (переключатель Auto-approval, PR #1368)

## Что происходит

- Строка controls под полем ввода Orchestrator-а — элементы `src/renderer/session/composer/*.tsx`, их собирает
  `import.meta.glob('./*.tsx')` (`src/renderer/session/composer/index.ts:46`). Каждый такой файл обязан
  default-export-ить компонент и export-ить числовой `order`, иначе сборка списка падает
  (`collectExtensions`, `src/renderer/shell/registry.ts:41-47`).
- Сегодня там два переключателя Orchestrator-а: Eco mode (`EcoMode.tsx`, `order = 15` — `:18`; кнопка `role="switch"`,
  класс `w-eco` — `:107-127`) и Auto-approval (`AutoApprove.tsx`, `order = 17` — `:29`; кнопка `w-eco w-eco--three`
  с меню из трёх `menuitemradio` — `:201-251`). Оба — только у Orchestrator-а (`EcoMode.tsx:137-143`,
  `AutoApprove.tsx:256-262`).
- Места нет (Q10): при 1280×800 с открытым sidebar в строке остаётся около 30 px; третий переключатель (Auto-continue,
  Ticket 02) столкнул бы Send со строки pickers. Это ловят e2e `test/e2e/session-controls.spec.ts:315` и
  `test/e2e/context-meter.spec.ts:128`.
- Подписи прячутся по правилу pickers: шаг `eco` (`src/renderer/session/composer/Pickers.tsx:68-91`, атрибут
  `data-eco-caption` — `:423`), CSS — `src/renderer/session/session.css:1617-1618` (Eco mode) и `:1676-1677`
  (Auto-approval); порядок снятия подписей проверяет `test/e2e/session-controls.spec.ts:491-531`.
- Окно Linked machine: оба переключателя недоступны при любом уровне доступа и ничего не читают — `elsewhere`
  (`EcoMode.tsx:52`, чтение пропущено — `:59-60`; `AutoApprove.tsx:85`, `:96-97`), tooltip-ы `ECO_MODE_ELSEWHERE`
  (`EcoMode.tsx:23`) и `AUTO_APPROVAL_ELSEWHERE` (`AutoApprove.tsx:48`). Eco mode ещё берёт подсказку Read only из
  `useReadOnly` (`EcoMode.tsx:51`, `:104`; `src/renderer/projects/useProjects.ts:263-270`).
- Auto-approval при открытом debugging port показывает Off, недоступен, с причиной и сохранённым режимом
  (`blockedTitle`, `AutoApprove.tsx:54-57`, `:116-117`).

## Что делаем (решения владельца Q10–Q14)

1. **Один элемент `src/renderer/session/composer/Modes.tsx`**, `order = 15` (место Eco mode), только у Orchestrator-а
   (тот же поиск через `useOrchestratorViews`). Кнопка: подпись «Modes», `aria-haspopup="menu"`, `aria-expanded`;
   справа — иконки состояния каждого пункта меню, всегда все, в постоянном порядке: Eco mode, Auto-approval (третью,
   Auto-continue, добавляет Ticket 02). Включённый пункт — яркая иконка, выключенный — приглушённая, Auto-approval Shadow —
   контур (Q12). Ширина кнопки от состояний не зависит: иконки стоят в слотах постоянной ширины.
2. **Меню** открывается над кнопкой, как меню Auto-approval сегодня (portal в `document.body`, сдвиг от правого края
   окна, закрытие по клику снаружи, resize и blur — `AutoApprove.tsx:139-177`):
   - «Eco mode» — `role="menuitemcheckbox"`, `aria-checked`, tooltip `ECO_MODE_TITLE` (`EcoMode.tsx:21`);
   - «Auto-approval» — подзаголовок и группа из трёх `role="menuitemradio"` Off / Shadow / On с теми же подписями,
     строками под ними и tooltip-ами (`AutoApprove.tsx:32-45`).
   Клавиатура: Enter / Space / ArrowDown на кнопке открывают меню; ArrowUp / ArrowDown ходят по пунктам, Home / End —
   к первому и последнему; Enter / Space выбирают; Escape закрывает и возвращает фокус на кнопку, не закрывая то, что
   под строкой (как `AutoApprove.tsx:179-197`); Tab закрывает. Выбор Eco mode меню не закрывает (видно новое
   состояние), выбор положения Auto-approval — тоже.
3. **Логика переезжает из элементов в модули без `order`**: `src/renderer/session/modes/eco-mode.ts` и
   `src/renderer/session/modes/auto-approval.ts` — hook-и `useEcoMode(projectId)` и `useAutoApproval(projectId)`:
   состояние, причина недоступности, запись, toast-ы. Тексты (`ECO_MODE_*`, `AUTO_APPROVAL_*`, `blockedTitle`)
   переезжают с ними без изменений. Каналы `ecoMode.*` и `autoApproval.*` и main не меняются. `EcoMode.tsx` и
   `AutoApprove.tsx` удаляются: в папке `composer/` любой `.tsx` — элемент строки (`registry.ts:41-47`).
4. **Состояния пункта** — те же, что у переключателей сегодня: чтение идёт — пункт недоступен с «Reading…»; запись
   идёт — `aria-busy`; отказ записи — toast и новое чтение (`EcoMode.tsx:71-101`, `AutoApprove.tsx:125-137`);
   Auto-approval при debugging port — Off, все три положения недоступны, tooltip `blockedTitle`.
5. **Окно Linked machine — как сегодня** (Q15–Q17 вступают с Ticket-ом 13): ничего не читается и не пишется; кнопка
   открывает меню, иконки — в виде «неизвестно» (кнопка недоступна, `session.css:1603-1606`), каждый пункт
   `aria-disabled` с тем же tooltip-ом, что сегодня: `ECO_MODE_ELSEWHERE`, `AUTO_APPROVAL_ELSEWHERE`, у Eco mode при
   Read only — подсказка `useReadOnly`.
6. **CSS** `session.css`: класс `w-modes` (кнопка, слоты иконок, меню) вместо `w-eco`, `w-eco--three` и
   `w-auto-approval__*` (`:1580-1745`); вид кнопки — тот же, что у pickers и `w-eco` сегодня (24 px, рамка 1 px).
   Подпись «Modes» прячется первой по тому же шагу pickers; шаг переименовывается `eco` → `modes`
   (`Pickers.tsx:68-91`, `:423`). Иконки не прячутся.
7. **Страницы Feature** — описание меню вместо двух переключателей: `docs/features/sessions.md:164-173`, `:196-197`,
   таблица `:267-268`; `docs/features/ru/sessions.md:126`, `:143`, `:204`; `docs/features/skills-agents-and-hooks.md:68`,
   `docs/features/ru/skills-agents-and-hooks.md:66`. Страница описывает только настоящее (`docs/features/README.md`).

## Готово, когда

- [x] У Orchestrator-а одна кнопка «Modes» вместо двух переключателей; в обычной Session её нет.
- [x] Меню: Eco mode (on/off) и Auto-approval (Off/Shadow/On); выбор пишет то же, что сегодня, в те же места
      (Profile через `ecoMode.set`, `app-settings.json` через `autoApproval.set`).
- [x] Кнопка всегда показывает иконку каждого пункта; on — яркая, off — приглушённая, Shadow — контур; ширина кнопки
      одинакова во всех сочетаниях состояний (unit test сравнивает ширину слотов, e2e — `boundingBox` кнопки).
- [x] Клавиатура: роли `menu`, `menuitemcheckbox`, `menuitemradio`; открыть, пройти, выбрать и закрыть меню без мыши.
- [x] Окно Linked machine — как сегодня: ничего не читается и не пишется, пункты недоступны с прежними tooltip-ами.
- [x] Debugging port: Auto-approval Off, недоступен, tooltip с причиной и сохранённым режимом.
- [x] Снимки кнопки и открытого меню в светлой и тёмной теме.
  - evidence: screenshot pass · `../evidence/12-modes-eco-on-light.png` · mac dev · db7ded110ffcfd647a68441cc164a1e3b654372e · scrub: 2026-11-05
  - evidence: screenshot pass · `../evidence/12-modes-eco-on-dark.png` · mac dev · db7ded110ffcfd647a68441cc164a1e3b654372e · scrub: 2026-11-05
  - evidence: screenshot pass · `../evidence/12-modes-menu-light.png` · mac dev · db7ded110ffcfd647a68441cc164a1e3b654372e · scrub: 2026-11-05
  - evidence: screenshot pass · `../evidence/12-modes-menu-dark.png` · mac dev · db7ded110ffcfd647a68441cc164a1e3b654372e · scrub: 2026-11-05
- [x] Ширины окна 800–1600 px с открытым sidebar: Send на строке pickers (`session-controls.spec.ts:315`,
      `context-meter.spec.ts:128`); порядок снятия подписей проверен заново (`session-controls.spec.ts:491-531`).
- [x] Страницы Feature EN и RU описывают меню Modes.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/modes-menu.test.tsx` (новый): все случаи из `test/unit/eco-mode-switch.test.tsx` и
  `test/unit/auto-approve-switch.test.tsx` переезжают на меню (только у Orchestrator-а, состояния, conflict / busy /
  too-old / invalid Eco mode, отказ записи Auto-approval, debugging port, Linked machine — ничего не прочитано и не
  записано, Read only); плюс клавиатура и постоянная ширина. Два старых файла удаляются.
- E2e `test/e2e/eco-mode.spec.ts` и `test/e2e/auto-approve.spec.ts` — переписать на открытие меню; их снимки — снимки
  кнопки и меню. `test/e2e/session-controls.spec.ts` — селекторы подписи (`.w-eco__label`, `:491`, `:528`, `:572`) и
  ширины.
- Contract `test/contract/eco-mode.test.ts` и `test/contract/auto-approve-setting.test.ts` не меняются: main тот же.
- Сначала падающий: e2e — у Orchestrator-а нет кнопки «Modes».

## Где в коде

- `src/renderer/session/composer/Modes.tsx` (новый); `src/renderer/session/composer/EcoMode.tsx`,
  `src/renderer/session/composer/AutoApprove.tsx` (удалить)
- `src/renderer/session/modes/eco-mode.ts`, `src/renderer/session/modes/auto-approval.ts` (новые)
- `src/renderer/session/composer/Pickers.tsx`, `src/renderer/session/session.css`
- `test/unit/modes-menu.test.tsx` (новый); `test/unit/eco-mode-switch.test.tsx`, `test/unit/auto-approve-switch.test.tsx`
  (удалить); `test/e2e/eco-mode.spec.ts`, `test/e2e/auto-approve.spec.ts`, `test/e2e/session-controls.spec.ts`
- `docs/features/sessions.md`, `docs/features/ru/sessions.md`, `docs/features/skills-agents-and-hooks.md`,
  `docs/features/ru/skills-agents-and-hooks.md`

Только читать: `src/renderer/session/composer/index.ts`, `src/renderer/shell/registry.ts`,
`src/shared/ipc/eco-mode.ts`, `src/shared/ipc/auto-approve.ts`, `src/main/ipc/eco-mode.ts`, `src/main/ipc/auto-approve.ts`,
`src/renderer/projects/useProjects.ts`, `test/e2e/context-meter.spec.ts`.

## Итог

Кнопка «Modes» (`src/renderer/session/composer/Modes.tsx`, `order = 15`) заменила переключатели Eco mode и Auto-approval;
логика и тексты переехали без изменений в `src/renderer/session/modes/eco-mode.ts` и `src/renderer/session/modes/auto-approval.ts`,
каналы `ecoMode.*`, `autoApproval.*` и main не тронуты. Шаг подписей pickers переименован `eco` → `modes`
(`data-modes-caption`). Unit `test/unit/modes-menu.test.tsx` (34 случая) заменил два старых файла; e2e `eco-mode.spec.ts`,
`auto-approve.spec.ts` переписаны на меню, `session-controls.spec.ts` проверяет ширины 800–1600 px с открытым sidebar
(ни один элемент строки не выпадает, Send на строке pickers от 1280 px) и порядок снятия подписей заново.

Снимки (Playwright fixture build, `captureScreenshot`): кнопка с Eco mode on — [светлая](../evidence/12-modes-eco-on-light.png),
[тёмная](../evidence/12-modes-eco-on-dark.png); открытое меню — [светлая](../evidence/12-modes-menu-light.png),
[тёмная](../evidence/12-modes-menu-dark.png). Пиксели проверил implementer (агент), не человек.

### Решено без владельца

- **Кнопка в окне Linked machine не `aria-disabled`.** Тикет требует, чтобы кнопка открывала меню, а недоступная кнопка,
  которая открывает меню, — противоречие для screen reader-а. Кнопка остаётся рабочей, вид «недоступна» (без заливки,
  приглушённый текст) даёт атрибут `data-read-only`; недоступны сами пункты, с прежними tooltip-ами.
- **Ошибка чтения или debugging port у одного режима не закрывает меню.** Раньше Auto-approval в этих случаях не
  открывал меню; теперь меню открывается (в нём есть Eco mode), а три положения Auto-approval — `aria-disabled` с той же
  причиной в tooltip.
- **Фокус при открытии — на первый пункт (Eco mode)**, а не на отмеченное положение Auto-approval, как было в старом меню:
  в общем меню первый пункт — обычное поведение `menu`.
- **Иконки:** Eco mode — лист, Auto-approval — щит. On — зелёный «ready», off — приглушённый (opacity 0.6), Shadow —
  контур, «неизвестно» (чтение, недоступно, другая Machine) — бледный (opacity 0.3). Слот иконки — 14 px, иконка — 10 px.
- **Tooltip кнопки** перечисляет состояния: «Orchestrator modes. Eco mode: On. Auto-approval: Shadow.».
- **Строка под пунктом Eco mode** — «Fewer agents, Sonnet» (по образцу строк Auto-approval); полный текст — в tooltip
  `ECO_MODE_TITLE`.
- **Снимки — четыре файла** (кнопка и меню, две темы); остальные снимки e2e пишет в свою папку вывода.
- **Красный тест сначала — unit**, не e2e: `modes-menu.test.tsx` падал на отсутствии `Modes.tsx` до кода; e2e на старом
  коде не гонялся (отдельная сборка старого дерева).

