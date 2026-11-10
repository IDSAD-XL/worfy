# 98 — Epics в sidebar: порядок по последней работе, время с последней работы и свёрнутая группа «Older»

Type: feature
Status: claimed 2026-11-10T10:49Z
PR: #1783
Branch: worfy-polish/98
Blocked by: —
Source: владелец 2026-11-10, решения «все да» (бриф Orchestrator-а).

## Что происходит

За долгую разработку секция Epics в sidebar копит десятки Epic-ов (`audit-…`, `worfy-auto-approve`,
`worfy-autopilot-queue`, `worfy-browser…`). Они идут по алфавиту, у каждого progress bar и `N/M`. Нужный Epic — тот, в
котором идёт работа, — теряется среди давно законченных и брошенных.

## Что делаем

1. **Последняя работа Epic-а** — самое новое время смены статуса среди его Ticket-ов (`statusAt` из `epic-status`:
   claim, block, done…). У Epic-а, ни один Ticket которого ещё не менял статус, — время, когда добавлен его spec:
   mtime файла `spec.md` (самый дешёвый источник: один `stat` рядом с уже идущим чтением заголовка spec-а). Рядом с
   progress — сколько прошло («2h», «3d») в стиле, который приложение уже использует (`ageText` PR inbox-а).
2. **Порядок.** Сначала Epic-и, где сейчас идёт работа (Ticket в `work`: claimed / in progress), потом все остальные
   по последней работе, новые сверху. Алфавитного порядка больше нет.
3. **Группа «Older · N».** Epic без работы дольше порога и без Ticket-а в работе уходит в свёрнутую группу
   «Older · N» внизу секции; один клик её разворачивает. Свёрнута или нет — помнится для каждого Project-а, как
   другие складки sidebar (`sidebar.collapsed` в app settings). Правило одно для закрытых Epic-ов и для Epic-ов с
   открытыми Ticket-ами. Ничего не пропадает совсем: Command palette по-прежнему находит каждый Epic.
   Порог — в Settings → General: Never / 3 days / 7 days / 30 days, по умолчанию 7 days; устроен как настройка
   автоархива Session (`sessionArchive.after`, ADR-0076).

## Готово, когда

- [ ] Модель workflow несёт время spec-а Epic-а (`specAt`), `statusAt` Ticket-ов уже доходит до renderer-а; contract
      test на чтение.
  - evidence: test-run pass · `pnpm test test/contract/workflow-reader.test.ts` exit 0 · mac - · b68f0bbb30f7ef1f115ac8d79b72c81160d8c578
- [ ] Порядок и группа «Older» посчитаны чистой функцией; unit test-ы на порядок, порог, «Never», Epic в работе
      со старой датой, Epic без времени.
  - evidence: test-run pass · `pnpm test test/unit/epics-order.test.tsx` exit 0 · mac - · b68f0bbb30f7ef1f115ac8d79b72c81160d8c578
- [ ] Секция Epics показывает время с последней работы, порядок и группу «Older · N», клик разворачивает её,
      состояние складки — по Project-у; unit test на render.
  - evidence: test-run pass · `pnpm test test/unit/epics-section-order.test.tsx test/unit/epics-section-reading.test.tsx` exit 0 · mac - · b68f0bbb30f7ef1f115ac8d79b72c81160d8c578
- [ ] Настройка порога в app settings (схема, store, patch) и строка в Settings → General; contract и unit test-ы.
  - evidence: test-run pass · `pnpm test test/contract/app-settings.test.ts test/unit/settings-epics-older.test.tsx` exit 0 · mac - · b68f0bbb30f7ef1f115ac8d79b72c81160d8c578
- [ ] e2e spec секции: Epic в работе, свежий, закрытый 8 дней назад и открытый 8 дней назад → порядок и группа;
      порог Never показывает всё. Время fixture-ов — от `Date.now()`, без фиксированных дат.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/epics-older.spec.ts test/e2e/epic-frame.spec.ts test/e2e/epics-reading.spec.ts test/e2e/sidebar-sections.spec.ts` exit 0 (15 passed) · mac - · b68f0bbb30f7ef1f115ac8d79b72c81160d8c578
- [ ] Страница `docs/features/workflow.md` (и перевод `ru`) описывает новый порядок и группу.
  - evidence: commit pass · Order the sidebar's Epics by last work and fold the old ones into «Older» (worfy-polish 98) · - - · b68f0bbb30f7ef1f115ac8d79b72c81160d8c578
- [ ] Снимки секции: 1280 px, тёмная и светлая тема, группа свёрнута и развёрнута.
  - evidence: screenshot pass · 4 shots of the window at 1280 px, dark and light, Older folded (in-work, fresh, Older 2) and open (plus closed-old, open-old, 8d); e2e build of b68f0bbb3 by test/e2e/epics-older.spec.ts; test-results/worfy-polish-98-screens/epics-{folded,open}-{dark,light}.png in the PR worktree; the orchestrator and the reviewer looked at all four · mac dev · b68f0bbb30f7ef1f115ac8d79b72c81160d8c578
- [ ] gate fast — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · b68f0bbb30f7ef1f115ac8d79b72c81160d8c578

## Где в коде

- `src/renderer/shell/sidebar/EpicsSection.tsx` — секция.
- `src/renderer/shell/sidebar/epics-order.ts` — новый: последняя работа, порядок, группа «Older».
- `src/shared/workflow/types.ts` — `specAt` у Epic-а.
- `src/main/workflow/reader.ts` — mtime `spec.md` в `enrichSnapshot`.
- `src/shared/settings/app-settings.ts`, `src/main/settings/store.ts` — порог `epicsOlderAfter`.
- `src/renderer/settings/GeneralSection.tsx` — строка порога.
- `test/unit/epics-order.test.tsx`, `test/unit/epics-section-order.test.tsx`, `test/unit/epics-section-reading.test.tsx`,
  `test/unit/settings-epics-older.test.tsx`, `test/contract/app-settings.test.ts`, `test/contract/workflow-reader.test.ts`,
  `test/e2e/epics-older.spec.ts`, `test/e2e/epic-frame.spec.ts` (fixture с датой 2026-10-17 теперь уходит в «Older»).
- `docs/features/workflow.md`, `docs/features/ru/workflow.md`, `docs/features/app-shell.md`, `docs/features/ru/app-shell.md`.

## Вне скоупа

- Раскладка sidebar за пределами секции Epics (редизайн sidebar — polish 94).
- Порядок Epic-ов в Command palette и на Canvas.

## Итог

PR #1783. Код — commit `b68f0bbb3`.

**Что изменилось.**
- **Порядок.** Секция Epics больше не идёт по алфавиту. Сначала Epic-и с Ticket-ом в `work` (claimed / in progress),
  потом остальные по последней работе, новые сверху. Epic-и без известного времени — в конце; при равном времени —
  по имени, чтобы список не прыгал между двумя чтениями (`src/renderer/shell/sidebar/epics-order.ts`, `arrangeEpics`).
- **Последняя работа** — самый новый `statusAt` среди Ticket-ов Epic-а (`lastWorkOf`). Если ни один Ticket ещё не
  менял статус — время `spec.md` (новое поле `Epic.specAt`). Дата без времени (Ticket после `ticket migrate`)
  читается как полночь UTC.
- **Время рядом с progress.** После `N/M` строка показывает, сколько прошло с последней работы, через `ageText`
  PR inbox-а («now», «5m», «2h», «3d»); tooltip — полная дата.
- **«Older · N».** Epic без Ticket-а в работе и без работы дольше порога (строго дольше) уходит в группу внизу
  секции — и закрытый, и с открытыми Ticket-ами. Группа свёрнута по умолчанию, клик её разворачивает. Складка
  хранится в `sidebar.collapsed` app settings под ключом `EpicsOlder-<8 hex hash из id Project-а>` — отдельно для
  каждого Project-а и переживает перезапуск. Свёрнутые строки не рисуются; Command palette и Canvas показывают все
  Epic-и, как раньше.
- **Настройка.** Новое поле app settings `epicsOlderAfter`: Never / 3d / 7d / 30d, по умолчанию 7d
  (`epicsOlderAfterOf`). Устроено как `sessionArchive.after`: хранится, только когда выбрано; значение, которого
  эта версия не знает, читается как «не выбрано»; IPC отказывает значению вне списка. Строка «Fold Epics without
  work after» — в Settings → General.

**Время spec-а: mtime, не первый commit.** `enrichSnapshot` (`src/main/workflow/reader.ts`) после чтения
`spec.md` делает один `stat` и пишет mtime в `specAt`. Почему: это один системный вызов рядом с уже идущим чтением
заголовка spec-а; он работает в Silent mode (Workflow folder не в git) и для незакоммиченного spec-а. Первый commit
стоил бы процесса git на каждое чтение модели, а модель перечитывается на каждое сохранение. Предел: checkout,
`git pull` или правка `spec.md` делают время новее, и такой Epic выглядит свежим. Это касается только Epic-ов, у
которых ни один Ticket не менял статус, и ошибка всегда в сторону «виден», не «спрятан». В коде это помечено
`shortcut:` в `reader.ts` с условием переделки: когда Epic-и без смены статуса должны сохранять возраст между
клонами. Spec за ссылкой на share `stat` не получает (`specAt: null`).

**Что убрано или заменено.**
- Алфавитный порядок Epic-ов в sidebar. `test/unit/epics-section-reading.test.tsx` ждал порядок ответа epic-status;
  теперь ждёт порядок по имени — в его stub-е нет времён.
- При пороге по умолчанию Epic-и без работы больше 7 дней и без Ticket-а в работе не видны в списке сразу — они в
  свёрнутой «Older · N».
- `test/e2e/epic-frame.spec.ts`, test длинных имён: у его Epic-а только blocked-дата 2026-10-17 и нет Ticket-а в
  работе, поэтому без правки строка ушла бы в «Older». Test теперь ставит порог Never: он проверяет длинное имя
  строки, а не группу.

**Решено без владельца.**
- Источник времени spec-а — mtime (см. выше); ревьюер принял.
- Место настройки — Settings → General, а не Canvas: секция Epics — часть sidebar, а не Canvas.
- Подпись «Fold Epics without work after» и варианты «Never / 3 days / 7 days / 30 days».
- Epic без известного времени (нет ни `statusAt`, ни spec-а) остаётся в списке, в конце: ничто не говорит, что он
  старый.
- Порог сравнивается строго («дольше порога»), как `idle > threshold` автоархива Session.
- Время показано в стиле `ageText` PR inbox-а; для этого секция импортирует функцию из `pr-inbox/usePrInbox.ts`.
