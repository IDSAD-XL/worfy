# 151 — Замер старта attention core на Project-е из 155 Ticket-ов и предел Auberge-test-а от замеренной базы

Type: bug
Status: claimed 2026-11-25T19:13Z
Branch: worfy-polish/151
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
  - evidence: test-run pass · `WORFY_QUARANTINE=only pnpm test:e2e test/e2e/epic-frame.spec.ts --repeat-each=5` exit 0 with temporary timing marks: core 96 writes 51 ms before, 1 write 9 ms after, numbers in Итог · mac - · b1e938b20b23d52d6d8577e39dfc29078c2d8d88
- [ ] Если записи заметны — одно сохранение на scope за tick, test на ядро это проверяет; иначе в «Итог» — почему
      код не тронут.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-attention-core.test.ts test/unit/assistant-attention-sources.test.ts` exit 0 (36 passed) · mac - · b1e938b20b23d52d6d8577e39dfc29078c2d8d88
- [ ] Предел Auberge-test-а на CI зависит от замеренной базы, не от потолка; `START_MS` = 3000 не поднят;
      `test/unit/e2e-start-budget.test.ts` проверяет новое правило.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/e2e-start-budget.test.ts` exit 0 (6 passed) · mac - · b1e938b20b23d52d6d8577e39dfc29078c2d8d88
- [ ] Карантин снят: записи и метки нет; `test/unit/quarantine.test.ts` зелёный.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/quarantine.test.ts test/unit/quarantine-suggest.test.ts` exit 0; `pnpm test:e2e test/e2e/epic-frame.spec.ts` exit 0 (8 passed) · mac - · b1e938b20b23d52d6d8577e39dfc29078c2d8d88
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` зелёный на head PR, test идёт в
      `macos-e2e` и зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · c99782d9974662198eb19d49b7e65f0fcd5f1310

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

## Итог

### Замер

Project e2e test-а — не 155 Ticket-ов, а 682 (42 Epic-а, `generateAuberge` в `test/e2e/epic-frame.spec.ts`), из них 96
в состоянии `blocked`. Первое чтение workflow этого Project-а в attention core дало 96 items, и каждый `ingest`
переписывал весь `assistant-items.json` с проверкой zod: **96 записей**, не 23.

Как мерили. Временные timing marks (в PR их нет) в main process вокруг `workflowAttention` первого чтения workflow и
счётчик записей store; `WORFY_QUARANTINE=only pnpm test:e2e test/e2e/epic-frame.spec.ts --repeat-each`, Mac владельца,
2026-11-25, тот же build. `N` — время до интерактивного окна, которое печатает test.

| Сборка | Старт-ов | Записей за первое чтение | Время ядра на первое чтение, ms | `N`, ms (min / медиана / max) |
| --- | --- | --- | --- | --- |
| `main` (ядро пишет на каждый item) | 8 | 96 | 42–70, медиана 51 | 723 / 825 / 909 |
| этот PR (одна запись на scope за чтение) | 5 | 1 | 8.8–12.9, медиана 9 | 786 / 796 / 801 |
| без ядра (`startAttentionCore` не запущен) | 8 | — | — | 690 / 734 / 847 |

- Ядро на `main` — 51 ms из медианных 825 ms `N`, **6 % `N`** на Mac владельца: больше «нескольких процентов», то есть
  заметно. Если runner медленнее Mac в той же пропорции, что `N` (медиана 4963 ms против 825 ms, ×6), это около 300 ms
  на runner-е.
- Тот же расчёт в vitest без окна (Electron Node, тот же `workflowAttention` на 682 Ticket-ах, файловый store): 96
  записей, 21–26 ms на все записи, 24–35 ms всего → после правки 1 запись, 0.5–2.8 ms на неё, 3–12 ms всего.
- Ядро — не главная причина красных job-ов: 300 ms из превышений 400–2958 ms над 7300 ms; три из четырёх красных
  job-ов шли на коде без ядра (таблица Ticket-а 150). Главная причина — потолок 7300 ms, который решал предел в 58 из 84 job-ов (Ticket 150).

### Правка ядра

`AttentionCore.batch(take)` (`src/main/assistant/core/attention-core.ts`): изменения внутри `take` пишут каждый
scope один раз, в конце; слушатели `subscribe` получают итог один раз на scope; каждый item по-прежнему уходит
слушателям `onItem` сразу, как взят. Вложенный batch пишет в конце внешнего. То, что `take` успел изменить до
исключения, записывается, исключение идёт дальше; если при этом падает и запись, её ошибка уходит в log и не прячет
ошибку источника. Scope, чья запись упала, не мешает записи остальных, первая ошибка бросается после них. Внутри
batch `onItem` зовётся до записи файла (раньше — после): если запись упадёт, после перезапуска событие возьмётся
снова и снова уйдёт слушателю; это безопасно, пока слушатели идемпотентны — единственный, правила Project-а
(`src/main/assistant/duties/app.ts`), называет условие по правилу, subject и revision, а `expect` не взводит его
дважды. Синхронно, без `setImmediate`: записи не теряются при выходе (`will-quit`), источник видит ошибку
записи в том же вызове, как раньше. В batch идут источники, которые отдают много событий за раз
(`src/main/assistant/core/sources.ts`): чтение workflow, PR inbox, Health check report, Limits. Те же items, тот же
файл. Test-ы: `test/unit/assistant-attention-core.test.ts` («a batch of changes», 6 test-ов) и
`test/unit/assistant-attention-sources.test.ts` (чтение Project-а из 682 Ticket-ов — одна запись и один вызов
слушателей; без правки — 112 записей).

### Предел от замеренной базы

Выбран вариант «отношение `N / R` против предела из распределения»: на GitHub Actions предел — `START_RATIO × R`
(6 × медиана трёх стартов Project-а из одного Ticket-а в том же job-е), не меньше `START_MS`, без потолка в ms.
`START_MS` = 3000 и `START_RATIO` = 6 не тронуты; `RUNNER_START_CAP_MS` удалён, не поднят.

Числа базы (84 первые попытки `macos-e2e` 2026-11-22..25, Ticket 150): `N / R` 1.83–5.19, медиана 3.56; четыре
красных — 2.66, 4.03, 4.10, 5.02, все внутри 6. Калибровка 2026-10-28: 3.07–4.3. Ни один из 84 + 4 замеров не выше 6.

Цена: задержка, которая одинаково добавилась бы к каждому старту, поднимает `R` вместе с `N` и на CI больше не
ловится — её ловит только `START_MS` = 3000 вне GitHub Actions. Раньше её ловил потолок 7300 ms, ценой того, что
медленный runner краснил test. Второй вариант из Ticket-а — база «тот же старт без ядра» — не взят: он мерит только
долю ядра и не убирает зависимость от скорости runner-а.

`N / R` теперь печатается в строке `auberge-size: interactive …` test-а, так что распределение можно пересчитать по
log-ам job-ов.

Карантин снят: `test/quarantine/epic-frame-auberge-start-macos-ci.json` удалён, test объявлен через `test`.
