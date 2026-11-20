# 128 — Hook compaction: eval `compaction-state` с hook-ом лучше, чем без него

Type: task
Status: claimed 2026-11-20T12:38Z
Blocked by: none
Source: владелец 2026-11-19 на приёмке worfy-continuity 15: пункт 8 «Готово, когда» spec-а (eval `compaction-state`
показывает, что с hook-ом лучше) принят как есть, «плюс Ticket на переделку hook-а».

Кто: агент. Платный eval — по правилу evals: сначала `--dry-run`, потолок на вызов.

## Что происходит

- После compaction (сжатия разговора в summary) Harness возвращает агенту состояние работы двумя путями:
  - hook `PreCompact` (`harness/hooks/inject-rules.mjs compaction`, правила `harness/hooks/rules/compaction.md`) —
    инструкции для summary;
  - hook `SessionStart` ветки `compact` (`harness/hooks/after-compact.mjs`) — файл Ticket-а и `git status --short`
    implementer-у, `wave-brief` Orchestrator-у;
  - пункт «After a compaction…» в `harness/hooks/rules/common.md`.
- Eval `harness/evals/compaction-state/` (Ticket worfy-continuity 13) сравнивает Harness с этими hook-ами и копию без
  них (`baseline.mjs`). Шесть probes (вопросов после compaction) судит haiku, три run-а на вариант.
- Раунд 3 (2026-11-18, head 98a0cc68d; таблица — «Итог» Ticket-а worfy-continuity 13): с hook-ом хуже, чем без него.

  | | с hook-ом | без hook-а |
  |---|---|---|
  | overallScore | 0,64 | 0,73 |
  | probe о Ticket-е | 1/3 | 1/3 |
  | probe о пунктах «Готово, когда» | 1/3 | 0/3 |
  | probe о следующем шаге | 1/3 | 3/3 |

- Причины, которые «Итог» 13 называет, но не проверил (trace-ы run-ов удалены):
  - run 2 с hook-ом не ответил: «Autocompact is thrashing». Вероятно, порог кейса 5 % от окна 100000 (5 тыс.
    токенов) ниже контекста после compaction (около 9,7 тыс.), и каждый лишний turn снова сжимает разговор;
  - ответившие run-ы с hook-ом называют fix `exports`, но не повторный `node --test`. Без hook-а все три называют оба
    шага. Почему, не установлено;
  - судья ошибается в обе стороны (probe-ticket, probe-goal), а три run-а на вариант не различают разницу в один run.

## Что делаем

1. Повторить оба варианта с сохранёнными trace-ами и понять, откуда провал: механика кейса (порог, thrash), текст
   `compaction.md`, текст `after-compact.mjs` или судья.
2. Исправить кейс, если виновата механика: порог compaction без thrash (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` и окно в
   `scripts/eval-harness.mjs:105`), число run-ов, при котором разница видна (`--runs`), и критерии судьи
   (`harness/evals/compaction-state/graders/probe-*.md`).
3. Переделать hook и правила так, чтобы после compaction агент знал Ticket, пункты «Готово, когда» с состоянием и
   следующий шаг. Например: `after-compact.mjs` называет следующий шаг из ticket-файла и `git status`, а
   `compaction.md` просит сохранить последнюю красную команду и что запустить после fix.
4. Прогнать eval с hook-ом и `HARNESS_DIR="$(node harness/evals/compaction-state/baseline.mjs)"` без него. Числа обоих
   вариантов, команды и путь к результатам — в «Итог».

## Где в коде

- `harness/hooks/after-compact.mjs` — текст после compaction (`:195` implementer, `:213` Orchestrator).
- `harness/hooks/rules/compaction.md`, `harness/hooks/rules/common.md`, `harness/hooks/inject-rules.mjs`,
  `harness/hooks/hooks.json` (`PreCompact` и `SessionStart` с matcher-ом `compact`).
- `harness/evals/compaction-state/` — `case.yaml`, `prompt.md`, `probes.md`, `history.mjs`, `scaffold.sh`,
  `baseline.mjs`, `graders/`.
- `scripts/eval-harness.mjs:105` — переменные compaction кейса.
- Test-ы: `harness/hooks/tests/session-hooks.test.sh` (раздел after-compact), `harness/hooks/tests/rules-hooks.test.sh`
  (PreCompact и `compaction.md`), `test/contract/harness-evals.test.ts` (кейс полон, fixture строится).

## Готово, когда

- [ ] Eval `compaction-state` с hook-ом выше baseline по overallScore.
  - evidence: test-run pass · `pnpm eval:harness -- --case compaction-state --runs 6 --max-cost-usd 5` exit 0, overallScore 0.985 vs baseline 0.924 · mac - · f180f57dd
- [ ] С hook-ом выше baseline по каждой группе probes: Ticket, пункты «Готово, когда», следующий шаг.
- [ ] Log прогона обоих вариантов (команды, overallScore, баллы по probes, цена) — в «Итог».
  - evidence: commit pass · worfy-polish/128: run log of both eval variants in the ticket · - - · 0f135b8cc402ce75b51d89808689ed8d26849fa6
- [ ] Shell test-ы hook-ов и contract test eval-а зелёные; CI зелёный.

## Итог

Сделано 2026-11-20, ветка `worfy-polish/128`. Пункт 1 выполнен в двух повторах окончательного варианта. Пункт 2
буквально не выполним на исправленном кейсе: probes о Ticket-е и о следующем шаге оба варианта проходят 100 %, «выше»
некуда; probe о пунктах «Готово, когда» с hook-ом выше в каждом прогоне. Это — решение владельца (ниже, «Вопрос
владельцу»).

### Откуда был провал: четыре причины, все проверены

1. **Механика кейса: две compaction в каждом run-е.** Порог Claude Code 2.1.322 (функции `g4`/`ntt` бинарника) —
   `min((окно − 20000) × pct / 100, окно − 33000)`. При окне 100000 и 5 % это 4000 токенов. Реальный контекст сразу
   после compaction — около 29–30 тыс. токенов (system prompt, правила, summary). Поэтому каждый следующий вызов снова
   сжимал разговор. Прогон 0 (код до правки, trace-ы сохранены `--keep-temp`): во всех шести run-ах по две compaction,
   в одном — три. Вторая summary писалась, когда `PROBES.md` уже прочитан. Вопросы оказывались внутри summary, и один
   run baseline принял запрос на summary за prompt injection.
2. **Судья читал ответ целиком.** Судья (haiku) получал все шесть разделов ответа сразу. Проверено повтором ответов на
   настоящем судье (свой маленький кейс с `focus: { source: file }`): раздел о Ticket-е из run-а с hook-ом отдельно —
   PASS ×3; тот же раздел внутри полного ответа — FAIL ×3, дважды подряд. Эталонный ответ, написанный по критериям, —
   1,00. Сам prompt судьи ответ агента получает: это проверено на местном stand-in Messages API, без платных вызовов.
3. **Текст hook-а.** Фраза «check each item of its done section against the work before the next step» агент читал как
   приказ открыть файлы. Run с hook-ом прямо пишет: hook просит запустить `git status` и открыть Ticket, а `PROBES.md`
   запрещает, поэтому он hook не слушает. Файл Ticket-а не говорит, что закоммичено и что в `package.json` сейчас.
   Агент колебался: «I do not know the current exact content of package.json».
4. **Следующий шаг.** `PROBES.md` спрашивал «the one step», grader требовал fix и повторный `node --test`.
   `compaction.md` тоже говорил «the one step». Run-ы с hook-ом называли один fix.

### Что изменено

- `harness/hooks/after-compact.mjs` (implementer): как Ticket заканчивается (`workflow.finish` профиля); commit-ы ветки
  от `worktree.base` с файлами (`git log --name-status`, до 40 строк); `git status --short`; файл Ticket-а со строкой о
  пустых флажках «Готово, когда»; `git diff HEAD` после Ticket-а, до 3000 символов. Текст описывает состояние и не
  велит запускать команды.
- `harness/hooks/rules/compaction.md`: Next action — шаг и проверка, что он сработал (после fix — упавшая команда
  снова). Implementer хранит пункты «Готово, когда» дословно и последнюю упавшую команду с ошибкой и причиной.
- Кейс: порог 50 % (40000 токенов, `scripts/eval-harness.mjs`). `BASE_TOKENS` истории — 38000 вместо 21000, так что
  usage истории (~45 тыс.) выше порога, а реальный контекст после compaction (~30 тыс.) ниже. Grader `compacted` —
  ровно одна граница (`match: count:1`). Каждый ответ — в свой файл `answers/N-*.md` (`Write` разрешён), и судья
  каждого probe читает только свой файл. Вопрос 6 — «what you do next … and how you then check that it worked». Судья
  probe-ticket принимает и абсолютный путь, который кончается на `.scratch/demo/issues/01-alpha.md`.
- Test-ы: `session-hooks.test.sh` (commit-ы и diff, текст без команд, длинный diff режется после Ticket-а, финиш),
  `rules-hooks.test.sh` (три новые фразы `compaction.md`), `harness-evals-run.test.ts` (переменные 100000/50; порог не
  ниже 36000 и ниже usage истории).

### Log прогонов

Все прогоны: Claude Code 2.1.322, агент `claude-sonnet-5`, судья `claude-haiku-4-5` (три голоса), `--max-cost-usd 5`
на вызов. С hook-ом — `pnpm eval:harness -- --case compaction-state --max-cost-usd 5 --runs N [--keep-temp]`, без
hook-а — то же с `HARNESS_DIR="$(node harness/evals/compaction-state/baseline.mjs)"`; новая копия baseline на каждый
прогон, из того же дерева. Оба варианта шли одновременно, на одном наборе кейсов. Результаты — в
`harness/evals/results/` worktree (с hook-ом) и `harness/evals/results/baseline-copies/` (без hook-а); в репозиторий
не входят. Группы — probe-ticket / probe-done-items / probe-next-step; в скобках — goal / files / decisions.

| Прогон | Код | Run-ов | overallScore с hook-ом | без hook-а | Ticket | «Готово, когда» | Следующий шаг | Цена с / без |
|---|---|---|---|---|---|---|---|---|
| 0 | до правки, порог 5 % | 3 | 0,67 | 0,70 | 1/3 · 2/3 | 0/3 · 0/3 | 2/3 · 2/3 | 1,52 / 1,37 USD |
| 1 | попытка 1: механика, судья по файлам, commit-ы и diff, `compaction.md` | 5 | 0,927 | 0,945 | 5/5 · 5/5 | 4/5 · 3/5 | 5/5 · 5/5 | 2,00 / 1,85 USD |
| 2 | попытка 2: + строка финиша (`workflow.finish`) | 6 | 0,955 | 0,924 | 6/6 · 6/6 | 5/6 · 1/6 | 6/6 · 6/6 | 2,32 / 2,37 USD |
| 3 | повтор прогона 2 без правок | 6 | 0,985 | 0,924 | 6/6 · 6/6 | 6/6 · 2/6 | 6/6 · 6/6 | 2,31 / 2,28 USD |

В ячейках групп — «с hook-ом · без hook-а». Остальные probes, с hook-ом · без hook-а: прогон 1 — goal 3/5 · 5/5, files
5/5 · 5/5, decisions 4/5 · 4/5; прогон 2 — goal 5/6 · 6/6, files 6/6 · 6/6, decisions 5/6 · 6/6; прогон 3 — goal
5/6 · 5/6, files 6/6 · 6/6, decisions 6/6 · 6/6. В прогонах 1–3 `compacted`, `probes-read` и `from-memory` —
100 % в обоих вариантах: ровно одна compaction в каждом run-е. Прогон 0 — на старых grader-ах (раздел ответа, а не
файл), его числа говорят только о механике.

Run-ы прогона 3 по оценке: с hook-ом 1,00 / 1,00 / 0,91 / 1,00 / 1,00 / 1,00, без hook-а 0,91 × 5 и 1,00.

Повтор ответов судье (диагностика причины 2, свой кейс вне репозитория): 0,53 + 0,24 + 0,17 USD.

**Цена всего:** 2,89 + 3,85 + 4,69 + 4,59 USD за четыре прогона пар и 0,94 USD за повторы ответов судье — **16,96 USD**.

**Чем hook лучше.** Без hook-а агент обычно не помнит пунктов «Готово, когда» и пишет «I am not quoting the exact
Russian wording» с тремя–семью своими пунктами. С hook-ом — четыре пункта Ticket-а дословно и с верным состоянием.
О Ticket-е и следующем шаге summary без hook-а помнит всё сама: 100 % в обоих вариантах.

### Решено без владельца

- Порог кейса 50 % и `BASE_TOKENS` 38000 (usage истории — число, а не реальные токены; реальная часть до первого
  сообщения около 23 тыс.) — решено без владельца: так получается ровно одна compaction.
- Ответы в файлы `answers/` и `Write` в кейсе — решено без владельца: судья целого ответа ошибался детерминированно.
- Вопрос 6 спрашивает и о проверке после шага — решено без владельца: вопрос и grader противоречили друг другу.
- В hook-е нет чтения transcript-а (последней упавшей команды): у Subagent-а `transcript_path` — transcript главной
  Session — решено без владельца.
- Пункт `common.md` «After a compaction…» не тронут — решено без владельца: он нужен, когда hook не сработал.
- Русский перевод `docs/features/ru/` не правился — по правилу проекта (правится английская страница).

### Вопрос владельцу

Пункт 2 требует «выше» по каждой группе. На исправленном кейсе Ticket и следующий шаг — 100 % в обоих вариантах
(прогоны 1–3, 17 run-ов на вариант). Варианты: (а) принять пункт для группы «Готово, когда» и «не хуже» для двух
других; (б) отдельный Ticket на более трудную историю кейса, где summary без hook-а теряет Ticket или следующий шаг.
Рекомендация — (а): трудная история проверяла бы уже сценарий, а не hook.

### Раунд ревью 1

Review PR #2095 на head e698c2965: одна находка med и три low. Все исправлены test-first в commit-е e5aae3c6a.
До правки `bash harness/hooks/tests/session-hooks.test.sh` — exit 1 (57 passed, 4 failed), после — exit 0 (61 passed).

1. [med] Commit-ы стояли перед Ticket-ом без лимита в символах. У длинного Ticket-а лимит hook-а в 10 000 символов
   срезал пункты «Готово, когда». Теперь commit-ы идут после Ticket-а, рядом с diff-ом, со своим лимитом: 40 строк и
   2000 символов. Test: Ticket, чей раздел «Готово, когда» кончается после символа 7 700, и commit из 45 файлов. До
   правки последний пункт срезался (9923 символа), после правки все четыре пункта на месте (9953 символа).
2. [low] Упавший `git diff HEAD` молча пропадал из текста. Теперь печатается строка `(git diff failed: exit N)`, как
   у `git status`. Test: из object store удалён blob закоммиченного файла. `git status` при этом работает, а
   `git diff HEAD` падает.
3. [low] Git печатал имена на кириллице octal escape-ами. Теперь `git log`, `git status` и `git diff` hook-а идут с
   `-c core.quotePath=false`. Test проверяет имена в commit-ах и в `git status`. Mutant без опции только у
   `git log` — test красный, exit 1.
4. [low] Строка Ticket-а теперь кончается фразой «Before your report, check each done item against the work.».
   Это просьба проверить пункты перед отчётом, а не приказ на сейчас. Test проверяет фразу и отсутствие «before the
   next step».

Правки меняют то, что видит агент: порядок разделов и новую фразу п. 4, а прежняя фраза такого рода сбивала агента
(причина 3). Поэтому был ещё один платный прогон пары — решено без владельца. Сначала `--dry-run` обоих вариантов
(exit 0), потолок 5 USD на вызов.

| Прогон | Код | Run-ов | overallScore с hook-ом | без hook-а | Ticket | «Готово, когда» | Следующий шаг | Цена с / без |
|---|---|---|---|---|---|---|---|---|
| 4 | раунд ревью 1 (e5aae3c6a) | 6 | 0,955 | 0,894 | 6/6 · 6/6 | 5/6 · 0/6 | 6/6 · 6/6 | 2,32 / 2,26 USD |

Остальные probes, с hook-ом · без hook-а: goal 4/6 · 6/6, files 6/6 · 6/6, decisions 6/6 · 5/6. `compacted`,
`probes-read` и `from-memory` — 6/6 в обоих вариантах. Фраза п. 4 не заставила агента открывать файлы.

Результаты:
- с hook-ом — `harness/evals/results/2026-11-20T14-44-50-654Z-alone-compaction-state`;
- без hook-а — `harness/evals/results/baseline-copies/2026-11-20T14-44-50-655Z-alone-compaction-state`.

Цена раунда — 4,58 USD. **Цена Ticket-а всего — 21,54 USD.**

`git status` (до 50 строк) по-прежнему стоит перед Ticket-ом, как в main — решено без владельца: его размер
ограничен, и в находке его не было.

### Раунд ревью 2

Review PR #2095 на head b8109292a нашёл одну проблему уровня med. Перед Ticket-ом стоят шапка и `git status` до 50
строк (3–4 тыс. символов). Последний `cut` оставлял первые строки, поэтому Ticket в 9 000 символов с разделом
«Готово, когда» в конце доходил без единого пункта. В репозитории 596 из 1126 Ticket-ов длиннее 8 000 символов.

Исправлено test-first в commit-е 1b18780eb.

Порядок обрезки теперь такой:
1. Шапка и `git status`. У `git status` к 50 строкам добавлен свой лимит в 1500 символов.
2. Ticket. Если он сам не влезает, остаются его первые строки и весь раздел «Готово, когда». Вместо строк между ними
   стоит одна строка: сколько строк вырезано и путь к файлу. Разделы после «Готово, когда» тоже заменяет одна строка.
3. Commit-ы и diff. Последний `cut` режет сначала их.

Раздел «Готово, когда» hook ищет так же, как `bin/ticket`: через `parseDoneSection` из `lib/evidence.cjs`. Это
заголовок профиля, заголовок по умолчанию и старый русский. Раздел, который сам длиннее лимита, теряет хвост.

Test-ы:
- Новый test: Ticket около 12 000 символов, `git status` на 56 строк, commit из 45 файлов. Раздел стоит в конце
  Ticket-а и, во втором варианте, перед разделом «Итог». До правки `bash harness/hooks/tests/session-hooks.test.sh` —
  exit 1 (61 passed, 2 failed), после — exit 0 (63 passed).
- Mutant-ы с exit 1: без обрезки середины; без лимита `git status` в символах; без `core.quotePath=false`.
- Test `core.quotePath` теперь идёт с `GIT_CONFIG_GLOBAL`. Этот файл сам просит escape-ы (`quotePath = true`), так
  что настройка пользователя не делает test пустым.

На fixture кейса eval-а текст hook-а до правки и после отличается одной строкой. Вместо «in its section of done
items» теперь «in its section ## Готово, когда»: раздел найден по правилам `bin/ticket`. Строка касается пунктов,
которые eval меряет. Поэтому был ещё один прогон пары — решено без владельца. Сначала `--dry-run` обоих вариантов
(exit 0), потолок 5 USD на вызов.

Первый запуск с hook-ом упал сразу (exit 1, 0 USD). Оба варианта стартовали в одну миллисекунду, и имя папки кэша git
совпало: `cannot create …/worfy-eval/<время>-git: EEXIST`. Вариант с hook-ом запущен снова, отдельно, на том же дереве.

| Прогон | Код | Run-ов | overallScore с hook-ом | без hook-а | Ticket | «Готово, когда» | Следующий шаг | Цена с / без |
|---|---|---|---|---|---|---|---|---|
| 5 | раунд ревью 2 (1b18780eb) | 6 | 0,955 | 0,909 | 6/6 · 6/6 | 5/6 · 2/6 | 6/6 · 6/6 | 2,32 / 2,30 USD |

Остальные probes, с hook-ом · без hook-а: goal 5/6 · 4/6, files 6/6 · 6/6, decisions 5/6 · 6/6. `compacted`,
`probes-read` и `from-memory` — 6/6 в обоих вариантах.

Результаты:
- с hook-ом — `harness/evals/results/2026-11-20T15-30-38-172Z-alone-compaction-state`;
- без hook-а — `harness/evals/results/baseline-copies/2026-11-20T15-12-11-169Z-alone-compaction-state`.

Цена раунда — 4,62 USD. **Цена Ticket-а всего — 26,16 USD.**

Совпадение имён кэша git у одновременных вызовов `eval:harness` — дефект `scripts/eval-harness.mjs`. В этом Ticket-е
он не исправлен: вне раздела «Где в коде».
