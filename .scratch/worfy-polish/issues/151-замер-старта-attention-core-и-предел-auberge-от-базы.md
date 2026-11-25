# 151 — Замер старта attention core на Project-е из 155 Ticket-ов и предел Auberge-test-а от замеренной базы

Type: bug
Status: open
Blocked by: 150
Source: Ticket worfy-polish 150 (карантин flaky e2e test-а старта Auberge-проекта на macOS CI) и его таблица evidence;
бриф Orchestrator-а 2026-11-25.

Кто: агент. Снимает карантин `test/quarantine/epic-frame-auberge-start-macos-ci.json` (owner `worfy-polish 151`,
срок 2026-12-09).

## Что происходит

`test/e2e/epic-frame.spec.ts` — «an Auberge-sized Project is interactive within 3 s and pans and zooms smoothly over
its biggest Epic» — на GitHub Actions меряет старт Project-а из 155 Ticket-ов (`N`) против предела
`min(6 × R, 7300)`, где `R` — медиана трёх стартов Project-а из одного Ticket-а на том же runner-е
(`test/e2e/start-budget.ts`). В 58 из 84 job-ов `macos-e2e` с 2026-11-22 предел — потолок 7300 ms, то есть его решает
скорость runner-а; 4 первые попытки из 84 красные (таблица — Ticket worfy-polish 150). Test в карантине до
2026-12-09.

Вторая возможная причина — не замерена: с worfy-assistant 03 attention core Assistant-а в main process при загрузке
Project-а пишет `assistant-items.json` синхронно и с проверкой zod при каждом изменении — по оценке из чтения кода
около 23 записей на 155 Ticket-ов (`src/main/assistant/core/sources.ts:133-150` → `core.ingest` / `core.resolve`,
`src/main/assistant/core/attention-core.ts:96-101` — `save` пишет весь файл, `src/main/storage/json-file.ts:81-93` —
`safeParse`, `writeFileSync`, `renameSync`). Оценка — десятки ms; два из четырёх красных job-ов шли на коде без ядра.

## Что делаем

1. **Замер, не оценка.** Стоимость старта ядра в main process на Project-е из 155 Ticket-ов — CPU profile
   (`--cpu-prof` main process-а в e2e) или timing marks в test-е (`performance.mark` вокруг первого чтения workflow и
   записей ядра). Числа — в «Итог» этого Ticket-а: сколько записей, сколько ms всего, доля в `N`.
2. **Если записи заметны** (больше нескольких процентов `N` на Mac владельца или на runner-е): записи ядра за один
   tick — одним сохранением на scope (например, отложенный `save` через `queueMicrotask`/`setImmediate` с флагом
   «грязный»), слушатели получают итог один раз. Поведение для пользователя не меняется: те же items, тот же файл.
   Test на ядро: N изменений за tick — одна запись файла. Если не заметны — так и записать в «Итог», код ядра не
   трогать.
3. **Предел от замеренной базы, не от потолка.** Предел test-а на CI зависит от замеренной на том же runner-е базы, а
   не от потолка, который решает скорость runner-а: например, отношение `N / R` против предела, выведенного из
   распределения 84 job-ов (`N / R` 1.83–5.19, медиана 3.56), или база — замеренный в том же job-е старт с тем же
   числом Ticket-ов без ядра. Выбор и его числа — в «Итог». Продуктовая цель 3 s (`START_MS`) не поднимается; потолок
   7300 ms не поднимается.
4. Снять карантин: удалить `test/quarantine/epic-frame-auberge-start-macos-ci.json` и метку
   `quarantined('epic-frame-auberge-start-macos-ci')`.

## Готово, когда

- [ ] Стоимость старта attention core на Project-е из 155 Ticket-ов замерена (CPU profile или timing marks), числа в
      «Итог».
- [ ] Если записи заметны — одно сохранение на scope за tick, test на ядро это проверяет; иначе в «Итог» — почему
      код не тронут.
- [ ] Предел Auberge-test-а на CI зависит от замеренной базы, не от потолка; `START_MS` = 3000 не поднят;
      `test/unit/e2e-start-budget.test.ts` проверяет новое правило.
- [ ] Карантин снят: записи и метки нет; `test/unit/quarantine.test.ts` зелёный.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` зелёный на head PR, test идёт в
      `macos-e2e` и зелёный.

## Где в коде

- `test/e2e/epic-frame.spec.ts` (test старта Auberge-проекта, метка карантина)
- `test/e2e/start-budget.ts`, `test/unit/e2e-start-budget.test.ts`
- `test/quarantine/epic-frame-auberge-start-macos-ci.json` (удалить)
- `src/main/assistant/core/attention-core.ts`, `src/main/assistant/core/sources.ts` (только если записи заметны) и
  test ядра рядом с ними
- Только читать: `src/main/storage/json-file.ts`, `test/quarantine.ts`

## Вне скоупа

- Подъём `START_MS`, `START_RATIO` или `RUNNER_START_CAP_MS` — запрещён правилами проекта.
- Ускорение старта renderer-а (ELK, React Flow) — отдельный Ticket, если замер покажет, что время там.
