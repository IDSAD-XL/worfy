# 32 — `wave-gate.test.sh` под нагрузкой дольше предела 120 s на файл в `harness-scripts.test.ts`

Type: task
Status: claimed 2026-10-18T13:04Z
Branch: worfy-polish/32-wave-gate-test-time
Blocked by: —
Source: замер [30](30-contract-test-ы-краснят-gate-full-чужих-pr-под-нагрузкой.md) 2026-10-17/18,
«Итог», раздел 5; решение Orchestrator-а 2026-10-18 — открыть отдельный Ticket, 30 ждёт его.

## Что происходит

- `test/contract/harness-scripts.test.ts` запускает каждый `harness/**/tests/*.test.sh` отдельным
  `bash` с пределом `FILE_TIMEOUT_MS` = 120 000 (`:28`, `:73`, `:97`). Скрипт, который не уложился, — красный
  test с `spawnSync bash ETIMEDOUT`.
- Замер Ticket-а 30 (два прогона `--project contract` разом под `yes > /dev/null` на 9 из 18 ядер, load
  13–15): `bin/tests/wave-gate.test.sh` до #401 (`66499375`) — 68,6 s; на `origin/main` `90c5e724` —
  118,7–120 s, 5 красных из 12 прогонов, все — timeout этого test-а. Остальные файлы Ticket-а 30 в тех
  же прогонах — 0 красных.
- Рост: после `66499375` в `wave-gate.test.sh` добавлено 252 строки, убрано 19 — #428 (отметки агентов
  на SHA, замок e2e), #433 (batch CI на main), #444 (stand-in `gh` на Windows). Сейчас 820 строк, 23
  раздела `# --- … ---` в одном файле.
- Пока он краснеет, замер Ticket-а 30 не может дать «после — 0 красных», а gate full под нагрузкой
  может краснеть у PR, которые Harness не трогали.

- **Windows (2026-10-20, Ticket worfy-windows 71, PR #555).** На ПК предел файла — 300 s
  (`FILE_TIMEOUT_MS = WINDOWS ? 300_000 : 120_000`, `harness-scripts.test.ts:28`). После Ticket-а 71
  `wave-gate.test.sh` в Git Bash на свободном ПК идёт 267 s (до него — 451 s, не укладывался); около 150 s
  из них — сам `wave-gate`, 77 запусков. Запас 33 s: под нагрузкой полного прогона файл может не уложиться.
  Разбиение файла на части из пункта «Что делаем» лечит и это.
## Что делаем

Направление выбирает тот, кто берёт Ticket, после замера, какие разделы дольше всего:

1. **Разбить файл по темам** на несколько `*.test.sh` — например, batch CI, merge (squash, resume,
   tree mismatch), замок e2e, состояние (pid-файл, resume, экран и `caffeinate`). Общие stub-ы и «мир»
   (bare origin, PR refs) — в общий файл, который части подключают через `source`. Каждая часть —
   отдельный test `harness-scripts.test.ts` со своим пределом.
2. **Или ускорить самые долгие разделы** — сначала замерить время каждого раздела под нагрузкой, потом
   убрать лишние повторы git-операций, лишние запуски `wave-gate` и ожидания.

Предел 120 s не поднимать: это правило Ticket-а 30 («`testTimeout`, `WAIT` и пределы в файлах не
поднимать как лечение»).

## Открытый вопрос

- Мутант Ticket-а 30 «stub снова пишется в каждом test-е» выжил: пять файлов зелёные и с ним, под
  нагрузкой тоже. Возможная причина: stub-ы `profile`, `ticket`, `epic-status` теперь Node-скрипты, а
  worfy запускает такой файл как `node <script>` (`harnessScriptCommand`,
  `src/main/workflow/profile.ts:189`); macOS тогда не проверяет его как новый исполняемый файл, и мутант
  не может покраснеть. Не проверено. Если это так, ускорение после #401 дал переход на Node-stub, а не
  symlink, и `wave-gate.test.sh` с его shell-stub-ами (`chmod +x`) может ждать ту же проверку macOS.

## Готово, когда

- [ ] `wave-gate.test.sh` или каждая его часть укладывается в 120 s в замере Ticket-а 30 (те же команды:
      «Итог» Ticket-а 30, «Команды замера»): после правки — 0 красных в N прогонах, N ≥ 6.
- [ ] Ни одна проверка `wave-gate.test.sh` не потеряна: число проверок до и после правки — в «Итог».
- [ ] Предел `FILE_TIMEOUT_MS` и другие пределы не подняты.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `bash harness/bin/tests/<файл>.test.sh` — exit
      0 для каждой части.

## Тесты

- `node scripts/vitest-electron.mjs --project contract test/contract/harness-scripts.test.ts` под
  нагрузкой и без; у каждого прогона — код выхода.
- Нагрузка — только когда других агентов на машине нет: она краснит gate соседей.

## Где в коде

- `harness/bin/tests/wave-gate.test.sh` — разбить или ускорить; новые `harness/bin/tests/*.test.sh`,
  если разбивать
- `test/contract/harness-scripts.test.ts` — только если новые файлы надо назвать явно

Только читать: `harness/bin/wave-gate`. Правка в `harness/` — PR со скриптами Harness: нужен вердикт
Windows (ADR-0056).

## Вне скоупа

- Другие долгие `*.test.sh` (`harness-home` 33–53 s, `gate-verdict` 31 s) — только запись в «Итог»,
  если они близки к пределу.
- Поведение `harness/bin/wave-gate`.

## Итог

Ветка `worfy-polish/32-wave-gate-test-time`, 2026-10-18. Направление — пункт 2 «Что делаем» (ускорить
самый долгий раздел); файл не разбит, `harness/bin/wave-gate` и `SKILL.md` не тронуты, пределы не подняты.

### Где уходило время

Замер по разделам (копия test-а с отметкой времени у каждого `# --- … ---` и каждого `new_world`,
без нагрузки, load ~4): всего 110 s, из них 43,6 s — раздел «the blocks of skills/epic-wave/SKILL.md».
Внутри него 20,1 s и 20,2 s — второй запуск блока «gate full одного PR» (bash и zsh), тот, что снимает
брошенный замок. Блок после `rm -f "$L/holder.json"; rmdir "$L"` всегда ждёт `sleep 20` перед новым
`mkdir`: 40 s фиксированного ожидания, которое нагрузка не сокращает и не удлиняет. Следующие разделы —
3,5–4 s каждый (`resume`, `screenblip`, `screenpkg`, `beat`, `screenpre`, `screenlock`, `lock`): их
`sleep` проверяют сам механизм (опрос экрана и замка раз в 1 s, heartbeat), их не трогал.

### Что изменено

- `harness/bin/tests/wave-gate.test.sh`: test подставляет в блок вместо строки `    sleep 20` цикла
  `until mkdir "$L"` опрос 0,2 s — так же, как `wave-gate` он гоняет с `WAVE_GATE_LOCK_POLL_S=1`.
  Подстановка ограничена 50 опросами (10 s): блок, который так и не берёт замок, выходит с 98, и его
  проверка краснеет вместо зависания всего файла до предела 120 s.
- Новая проверка: в блоке SKILL.md цикл `until mkdir "$L"` ждёт ровно `sleep 20`. Если строку
  поменяют, подстановка не совпадёт — проверка это назовёт, а не молча вернёт 20 s в каждый прогон.
- Число проверок: 150 `ok` до, 151 после (+1 — проверка `sleep 20` выше); ни одна не убрана.

### Замер (2026-10-18, Mac 18 ядер, на машине работали другие агенты)

Запуск как в `harness-scripts.test.ts` (пустой `HOME`, тот же env), `bash <файл>`; «до» — файл
`origin/main` `cf506ee0`, «после» — ветка; перед каждым запуском — нет `/tmp/worfy-e2e.lock` и нет
`gate.mjs full`. «Нагрузка» — разом с `pnpm typecheck` и
`node scripts/vitest-electron.mjs --project contract test/contract/workflow-reader.test.ts`.

| | Прогон 1 | Прогон 2 | Прогон 3 |
| --- | --- | --- | --- |
| до, один | 107,4 s | 134,2 s | 118,7 s |
| после, один | 72,5 s | 75,1 s | 71,6 s |
| до, под нагрузкой | 114,7 s | 125,5 s | 110,5 s |
| после, под нагрузкой | 82,8 s | 102,4 s | 70,0 s |

Все 12 — exit 0; typecheck и workflow-reader — exit 0 в каждом прогоне под нагрузкой. «После, нагрузка,
прогон 2» — load в конце 19,3: во время прогона начался чужой gate full. Два из шести прогонов «до»
(134,2 и 125,5 s) уже дольше предела 120 s.

### Мутанты (каждый в копии в scratchpad, дерево не менялось)

- `wave-gate`: `st.culprit = st.set[hi]` вместо `[hi - 1]` — exit 1, `FAIL red set: culprit 4`,
  `FAIL resume: … culprit 4`.
- `wave-gate`: порог брошенного замка 60 s вместо 1800 — exit 1, `FAIL e2e lock: a 25-min lock was taken`.
- `SKILL.md`: `sleep 30` вместо `sleep 20` в цикле блока одного PR — exit 1, `FAIL skill blocks: the
  one-PR gate full block has no 'sleep 20' in its until mkdir loop`.
- `SKILL.md`: брошенный замок не снимается (`then :; fi`) — exit 1 за 104 s, `FAIL bash: the one-PR
  block, abandoned lock`, то же для zsh. До правки этот мутант вешал файл: цикл `sleep 20` без конца.

### Проверки

`pnpm lint && pnpm typecheck && pnpm test` — exit 0 (290 файлов, 6209 test-ов); `gate.mjs fast` —
exit 0, «[gate] зелено (fast)».

### Не сделано

- Замер Ticket-а 30 («Команды замера»: два прогона `--project contract` разом под `yes` на половине
  ядер, N ≥ 6) не выполнен: на машине работали другие агенты, а нагрузка краснит их gate. Пункт
  «Готово, когда» о нём остаётся для Orchestrator-а; вместо него — замер выше.
- Остаток после правки — ~70 s без нагрузки; если под нагрузкой Ticket-а 30 его не хватит, следующий
  шаг — разбить файл (пункт 1 «Что делаем»).

### Повторы после мержа PR #497 (заметка 2026-10-20)

- 2026-10-18, Implementer PR #496: `harness/bin/tests/wave-gate.test.sh` — timeout 120 s при load
  average 9; отдельно и на повторе — зелёный.
- 2026-10-19, gate full PR #539 на Mac: дочерний процесс `Killed` в сценарии resume
  (`harness/bin/tests/wave-gate.test.sh:311-313`: stub gate убивает wave-gate, exit 137, потом снова
  `check`); отдельно — зелёный за 98 s. Предел обёртки — `FILE_TIMEOUT_MS` 120 s, на Windows 300 s
  (`test/contract/harness-scripts.test.ts:28`, один `it.for` на файл — `:70-73`).

- 2026-10-21, Implementer PR #716 (`worfy-ui` 24): `wave-gate.test.sh` убит по пределу 120 s в двух
  полных `pnpm test` подряд при load average 15–17 от соседних Session-ов; отдельно — зелёный,
  третий полный прогон — зелёный.

98 s без нагрузки — уже больше остатка ~70 s выше. Следующий шаг из «Не сделано» — разбить файл.
Сводка flaky test-ов этого дня — [34](34-flaky-test-ы-gate-full-2026-10-19.md).
