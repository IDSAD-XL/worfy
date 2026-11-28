# Code story — worfy-harness-eval 06: Статика SkillEvaluator по 35 skill-ам

Kind: pr · Epic: worfy-harness-eval · Ticket: 06 · PR: - · Language: ru

## 1. Что было не так

worfy ставит `harness/` plugin-ом и в Claude Code, и в Codex, но ни один run наших eval-ов не проверял, загружает ли
Codex skill-ы Harness. Владелец согласился на один бесплатный прогон статики NVIDIA SkillEvaluator. Код продукта PR
не меняет: он несёт итог прогона в «Итог» Ticket-а.

- Требование: [Что происходит](../issues/06-статика-skillevaluator.md#что-происходит)

## 2. Общая причина degraded у всех 35 skill-ов

Code: `.scratch/worfy-harness-eval/issues/06-статика-skillevaluator.md:84-90` · key lines: 84, 85, 87, 88

```md
Для всех 35 skill-ов ответ одинаковый: **Claude Code — degraded, Codex — degraded**; drops нет ни у одного. Причина
общая для каталога, не для skill-а: у 35 skill-ов 9 668 символов description, а список skill-ов, когда окно модели
неизвестно, вмещает 8 000 (`CC-LIST-BUDGET`: Claude Code укорачивает description; `CX-LIST-BUDGET`: Codex укорачивает,
потом убирает description, потом выбрасывает skill-ы). Это зависит от окна: на `qmd` с `--context-tokens 200000` —
Claude Code degraded, Codex loads; с `--context-tokens 1000000` — оба loads (exit 0 у обоих запусков). Сколько
символов занимают skill-ы других plugin-ов в той же сессии, `harness-check` не знает: он считает только папку
`harness/skills/`.
```

- Что делает: говорит, что одинаковый ответ degraded у всех skill-ов — свойство каталога (сумма description), а не
  отдельного skill-а, и что вердикт меняется с размером окна модели.
- Почему здесь: Ticket просит по каждому skill-у ответ для Claude Code и Codex «и почему» (`Что строить`); без этого
  абзаца таблица из 35 одинаковых строк читалась бы как 35 разных поломок.
- Без него: владелец не отличил бы общую причину (бюджет списка skill-ов) от находок отдельных skill-ов
  (`epic-wave`, `human-review-setup`, `overnight-fix-loop`).
- Требование: [Что строить](../issues/06-статика-skillevaluator.md#что-строить)
- Риски и пробелы test-ов: прогоны с `--context-tokens` сделаны на одном skill-е `qmd`; это допустимо, потому что
  находка считается по всей папке, но для других skill-ов этот прогон не повторялся.

## 3. Чего статика не проверила

Code: `.scratch/worfy-harness-eval/issues/06-статика-skillevaluator.md:117-120` · key lines: 117, 118, 120

```md
- **Hook-и и `bin/` Tier 1 не сканировал вовсе.** Ни одной находки по `hooks/hooks.json`, в выводе нет слова «hook»;
  ожидаемая по их docs находка BH1 «hook payload unmodeled» не пришла ни на один из 20 command hook-ов. Это совпадает с
  открытым issue #495 их репозитория (у plugin-а сканируются только bundled skills), а не с `docs/tier1-reference.mdx:362`. Значит,
  hook-и и скрипты Harness этой статикой не проверены.
```

- Что делает: записывает, что Tier 1 по plugin-у не сканировал `hooks/` и `bin/`, — «не проверено», а не «чисто».
- Почему здесь: бриф Orchestrator-а ждал на каждом command hook-е находку BH1 и велел считать её шумом; её отсутствие —
  факт о покрытии, а не чистый результат. Правило «`INCOMPLETE` — это не проверено» записано в Ticket-е
  (`Что строить`).
- Без него: отсутствие находок по hook-ам читалось бы как «hook-и Harness прошли проверку безопасности».
- Требование: [Готово, когда](../issues/06-статика-skillevaluator.md#готово-когда)
- Риски и пробелы test-ов: вывод сделан по отсутствию строк в отчёте; исходный код SkillEvaluator, который решает,
  что сканировать у plugin-а, не читался.

## 4. Что сознательно не меняли

- `harness/` и skill-ы: находки — вопросы владельцу в «Итог», Ticket-ы по правилу провала сами не заводятся.
- `docs/product/` — папки тем правит только Product Session.
- Tier 2 и Tier 3, `--llm` — не запускались: им нужны модель или embeddings.

## 5. Как проверено

- `skillevaluator harness-check <skill> -v --json …` — 35 запусков, exit 0 каждый.
- `skillevaluator validate <harness> --tiers 1 --no-llm` — exit 1 (`FAIL`, Security Scan `INCOMPLETE`).
- `skillevaluator tier1 <skill> --no-llm` — 35 запусков: exit 0 у двух, exit 1 у 33.
- `pnpm lint` — exit 0.

## Проверить себя

1. Почему все 35 skill-ов получили degraded и у Claude Code, и у Codex, хотя сами skill-ы разные?
   Ответ: Причина — сумма description всего каталога (9 668 символов) больше бюджета списка skill-ов (8 000 при
   неизвестном окне); при окне 1M tokens оба агента skill-ы загружают.
   Lines: `.scratch/worfy-harness-eval/issues/06-статика-skillevaluator.md:84-90`
2. Почему отсутствие находок по hook-ам — не «hook-и чисты»?
   Ответ: Tier 1 по plugin-у hook-и и `bin/` не сканировал вовсе: даже ожидаемая шумовая BH1 не пришла.
   Lines: `.scratch/worfy-harness-eval/issues/06-статика-skillevaluator.md:117-120`
