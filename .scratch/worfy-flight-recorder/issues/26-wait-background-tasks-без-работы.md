# 26 — Wait `background-tasks` считается только там, где не идёт работа Run

Type: task
Status: done 2026-11-01T07:06Z
PR: #1196
Branch: worfy-flight-recorder/26
Blocked by: 13
Source: [spec.md](../spec.md), «Модель» («Wait, блокировка, повтор»; «Собственное время и итог»), «Ticket-ы» (26); решение 03, Q5 ([03-модель-spans.md](03-модель-spans.md)): Wait — время, когда работа стоит по внешней причине; «Итог» Ticket-а 13 ([13-факты-из-journal.md](13-факты-из-journal.md)), ограничение Wait-ов `background-tasks`. Правило принял Orchestrator без владельца (ночь 2026-11-01), владелец подтверждает утром: изменение маленькое и обратимое.

## Что происходит

- Reader Journal (Ticket 13, `src/shared/flight-recorder/from-journal.ts`) отдаёт Wait `background-tasks` на каждый
  отрезок, когда у Session Orchestrator-а живы background tasks (строки `background-tasks` в Journal).
- Эти background tasks — сами implementer-ы, verifier-ы и scripts gate Orchestrator-а: Wait покрывает их собственную
  работу. На fixture ночного Run — 13 Wait-ов, 15 808 с, 0,915 Run.
- Итог (`summarize`, `src/shared/flight-recorder/summary.ts`) суммирует Wait-ы по причинам целиком: блок «Waits by
  cause» скажет «ждали background tasks» почти о каждом настоящем Run, хотя работа шла.
- Решение 03, Q5: Wait — время, когда работа стоит по внешней причине. Пока идёт агент, gate run, CI run или script
  Run-а, работа не стоит.

## Что делаем

1. Wait `background-tasks` в итоге считается только за время, когда не идёт ни один span работы Run (виды `agent`,
   `ci`, `gate`, `script`; где бы он ни висел — в Stage или на Run). Пересечения работ — объединением, не суммой.
   Работа с потерянным источником реальных времён не имеет и не вычитается.
2. Решить, где правило: span Wait режется на части без работы (на шкале видны разрывы) или остаётся целым, а
   вычитает только итог. Выбор и довод — в «Итог».
3. Остальные причины (`limits`, `limits-budget`, `gate-queue`, `other-machine`) не меняются: считаются целиком.
4. Экспортируемое API `spans.ts` и `summary.ts` не меняется (его читает Ticket 17); readers (`from-*.ts`) и контракт
   `facts.ts` не трогаются.

Не входит: Wait-ы других причин, ходы Orchestrator-а как работа, новые поля фактов.

## Готово, когда

- [ ] Unit test на fixture ночного Run: Journal, транскрипты, логи gate и ответы `gh` → `buildTimeline` →
      `summarize`; доля `background-tasks` падает с 0,915 до времени без работы (число в test-е и в «Итог»).
- [ ] Unit test-ы-литералы: работа покрывает Wait целиком (0), работы нет (Wait целиком), частичное пересечение, две
      пересекающиеся работы (объединение, не сумма).
- [ ] Unit test: Wait-ы `limits`, `limits-budget`, `gate-queue`, `other-machine` под работой считаются целиком.
- [ ] Test baseline Ticket-а 13 («pins the raw background-tasks Waits of the night Run») не меняется и зелёный.
- [ ] Каждое новое поведение красное на своём мутанте.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/flight-recorder-summary-waits.test.ts` (новый): литералы и fixture ночного Run.
- Сначала падающий: Wait 10:30–11:30, агент 11:00–12:00 — итог 30 мин, а не 60.
- Прогнать `test/unit/flight-recorder-*.test.ts`, `test/contract/flight-recorder*.test.ts`,
  `test/unit/critical-path.test.ts`.

## Где в коде

- `src/shared/flight-recorder/summary.ts`
- `src/shared/flight-recorder/spans.ts` — если правило окажется там
- `test/unit/flight-recorder-summary-waits.test.ts` (новый)
- `.scratch/worfy-flight-recorder/spec.md` — строка Ticket-а 26 в списке «Ticket-ы», строка в таблице «Волны», «Собственное время и итог»
- `.scratch/worfy-flight-recorder/issues/18-экран-шкала.md` — п. 3, пометка строки «without work»
- `.scratch/worfy-flight-recorder/issues/25-приёмка-с-владельцем.md` — `Blocked by`

Только читать: `src/shared/flight-recorder/from-journal.ts`, `facts.ts`, `src/main/flight-recorder/` (Ticket 17
строится параллельно), `test/fixtures/flight-recorder/night-run/`.

## Итог

- **Где правило: span Wait остаётся целым, вычитает только итог.** Правка — один `summary.ts`; `spans.ts` не
  тронут, формы `Span`, `Timeline`, `WaitRow`, `Summary` те же (Ticket 17 читает их без изменений). Довод: шкала
  остаётся честной — Journal действительно видел живые background tasks весь отрезок, и на дорожке Wait это видно
  целиком, а работа под ним видна в дереве. Резать span на части без работы — значит выдумать много коротких Wait-ов
  (между концом одного агента и стартом следующего — секунды), а Wait, целиком покрытый работой, исчез бы или стал
  нулевым span-ом; панель деталей потеряла бы начало и конец из Journal. Откат — одна строка: множество
  `COUNTED_WITHOUT_WORK` (summary.ts:66). Цена: длина полосы Wait на шкале и её доля в итоге расходятся — полоса
  показывает, сколько жили background tasks, итог — сколько из этого Run стоял без работы.
- **Читатель итога знает о правиле** (круг 2 ревью): `COUNTED_WITHOUT_WORK` экспортирован (summary.ts:66), рядом —
  `WITHOUT_WORK_NOTE = 'without work'` (summary.ts:69), пометка строки такой причины, как `WORK_NOTE` у работы.
  Форма `WaitRow` и `Summary` не менялась (их читает Ticket 17, #1198): поле в строке сломало бы сравнения `toEqual`
  итога целиком. Экран (Ticket 18, п. 3) ставит пометку на строку причины из этого множества; spec.md, «Собственное
  время и итог», говорит то же. Test: экспортированное множество — то самое, по которому считает итог (под работой,
  покрывающей все Wait-ы, в 0 падают ровно причины из него).
- **Правило** (summary.ts:139–143): для причины `background-tasks` в итог идёт длительность Wait минус объединение
  частей всех span-ов работы Run внутри него (`clipTo`, summary.ts:41). Работа — виды `agent`, `ci`, `gate`, `script`
  где угодно (в Stage или на Run, например агент без Ticket-а); пересечения — объединением; работа с потерянным
  источником (`lost`) не вычитается: реальных времён у неё нет. В живом Run работа и Wait тянутся до «сейчас»
  (сегменты модели), и вычитание идёт по ним. Причина, чьи Wait-ы целиком покрыты работой, остаётся в итоге с 0 и
  долей 0 — Wait-ы были, без работы из них не осталось ничего.
- **Остальные причины** (`limits`, `limits-budget`, `gate-queue`, `other-machine`) считаются целиком, работа под ними
  ничего не меняет (test).
- **Ночной Run** (fixture, test на Journal + транскрипты + логи gate + ответы `gh` → `buildTimeline` → `summarize`):
  13 Wait-ов `background-tasks` — было 15 808 308 мс, 0,915 Run; стало 921 911 мс (15 мин 22 с), 0,053 Run из 4 ч 48
  мин. Работа: 15 агентов из транскриптов, 2 запуска gate full, 2 CI run на `main`, привязанных к PR #460 и #467 по
  merge commit. Остаток — в основном background task «Retry merge of PR #467 with full gate» (02:48–03:02): лога gate
  этого запуска в fixture нет (там два иллюстративных лога, README fixture-а), и span-а у этой задачи нет ни в одном
  источнике: 819,5 с из 921,9 с; остальное — 6 зазоров по 7–34 с. Test перечисляет все 7 отрезков без работы
  явно. **Число 0,053 опирается на два иллюстративных лога gate** fixture-а: без работы видов `gate` и `script` —
  0,098 Run (test).
- Baseline Ticket-а 13 (`test/unit/flight-recorder-journal.test.ts`, «pins the raw background-tasks Waits of the night
  Run») не менялся и зелёный: там только Journal, работы нет, и Wait-ы считаются целиком — 0,915.
- Ходы Orchestrator-а работой не считаются: правило берёт только span-ы работы (`WORK_KINDS`), ход — отдельная
  дорожка. Test-литерал: ход 10:30–11:30 под Wait-ом — Wait считается целиком, 60 мин. Вопрос владельцу: считать ли ход Orchestrator-а работой (тогда Wait стоит, только когда не идёт ни работа,
  ни ход).
- Tests: `test/unit/flight-recorder-summary-waits.test.ts` (13 test-ов после круга 2): литералы — Wait покрыт целиком (0), работы
  нет (целиком), частичное пересечение, две пересекающиеся работы (объединение, не сумма), работа всех видов и вне
  Stage, потерянная работа, два Wait-а, другие причины целиком, span на шкале целый, живой Run; и fixture ночного Run.
  Сначала красные: 6 из 10 литералов на коде до правки. Мутанты — 7, все убиты: без вычитания, сумма вместо
  объединения, правило на все причины, вычитание потерянной работы, только агенты, без обрезки по Wait, только работа
  внутри Stage. Круг 2: test-ы хода Orchestrator-а и экспорта, явный список отрезков без работы ночного Run и доля без
  gate и script; новые мутанты — 5, все убиты: экспортированное множество шире, итог по своему правилу вместо
  экспортированного, другой текст пометки, ход Orchestrator-а как работа, без работы вида `gate`; 7 мутантов круга 1
  прогнаны снова и убиты.
- Прогнаны `test/unit/flight-recorder-*.test.ts`, `test/contract/flight-recorder*.test.ts`,
  `test/unit/critical-path.test.ts` — 12 файлов, 270 test-ов, exit 0; в круге 2 — те же и `test/unit/wave-plan.test.ts`: 13 файлов, 294 test-а, exit 0.

Не проверено:
- Сборка фактов в test-е повторяет то, как их соединит сервис Ticket-а 17 (он ещё строится): Journal, транскрипты
  (`readRunTranscripts`), логи gate (`readGateLogs`), ответ `gh`, собранный из файлов fixture-а так же, как его
  собирает `src/main/flight-recorder/github.ts` (PR, runs ветки, runs merge commit). На живом сервисе число может
  отличаться.
- Правило принял Orchestrator без владельца; подтверждено владельцем 2026-11-01.

**Решено без владельца, подтверждено владельцем 2026-11-01.** Доля Wait `background-tasks` в ночном Run: 0.915 (один
Journal) → 0.053 (921.9 s без работы ни в одном источнике; `test/unit/flight-recorder-summary-waits.test.ts:198`, `:217`).
Альтернатива — не считать `background-tasks` Wait-ом вовсе. Второй вопрос — считать ли ход Orchestrator-а работой (выше).
