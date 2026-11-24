# Проверка всего Harness: NVIDIA SkillEvaluator или свой eval — карта

Тема Product Session `harness-eval`, начата 2026-11-24. Вход — сообщение владельца 2026-11-24: «Нашел такую
замечательную вещь от нвидиа, думаю что провести тестирование всего харнесса было бы не лишним». К нему две ссылки:
блог NVIDIA о SkillEvaluator
(https://developer.nvidia.com/blog/evaluating-ai-agent-skill-performance-with-nvidia-skillevaluator/) и репозиторий
https://github.com/NVIDIA/SkillEvaluator.

Harness — plugin worfy в папке `harness/` репозитория: skills, subagents, hooks и правила. worfy ставит ту же папку
plugin-ом и в Claude Code, и в Codex (`harness/README.md`, раздел «On Codex»).

## Destination

Владелец решил три вещи: что значит «проверить весь Harness», каким инструментом это делать и сколько на это
тратить. После этого он принял черновик Epic-а `drafts/<epic>.md`; первая строка под заголовком — `Advisor draft`.

Другой допустимый финал: владелец решил Epic не делать, и это решение записано здесь.

Владелец подтвердил финал 2026-11-24: «да».

Финал достигнут 2026-11-24. Сначала черновик [drafts/worfy-harness-eval.md](drafts/worfy-harness-eval.md) разобрал
критик ([critic/worfy-harness-eval-2026-11-24.md](../critic/worfy-harness-eval-2026-11-24.md), вердикт Reorder), и
владелец принял все три возражения. Затем он принял черновик (Q26) и велел сохранить тему (Q27): «да да».

## Notes

- Research темы:
  - [research-nvidia-skillevaluator.md](research-nvidia-skillevaluator.md) — что умеет SkillEvaluator, что ему
    нужно для запуска и чем он отличается от `claude plugin eval`;
  - [research-текущие-eval-ы.md](research-текущие-eval-ы.md) — как Harness проверяется сейчас и что не
    проверяется совсем;
  - [research-вызовы-skill-ов-за-30-дней.md](research-вызовы-skill-ов-за-30-дней.md) — какие skill-ы вызывались
    на Mac владельца за 30 дней и у каких из них есть case;
  - [research-api-кредиты-ultra.md](research-api-кредиты-ultra.md) — как работают 200 USD API-кредитов подписки
    Ultra и можно ли на них запускать eval-ы;
  - [research-модели-и-расход-за-30-дней.md](research-модели-и-расход-за-30-дней.md) — на каких моделях шла работа
    владельца и сколько стоили eval-ы по PR за 30 дней.
- Skills темы: `worfy:grilling` для вопросов; `worfy:research` для фактов, заметки — в этой папке; `worfy:to-spec`
  для черновика; `worfy:critic` перед приёмкой.
- Ограничения, известные до первого вопроса:
  - на машине владельца нет `ANTHROPIC_API_KEY`. Eval-ы Harness идут на подписке: `scripts/eval-harness.mjs`
    вызывает `claude plugin eval` установленного Claude Code;
  - у подписки Ultra есть 200 USD API-кредитов в месяц. Владелец 2026-11-24: «можно их здесь и потратить».
    Неистраченное сгорает в конце месяца;
  - у аккаунта с 2026-11-13 снова есть окно лимита на 5 часов, кроме недельного;
  - решение владельца 2026-11-02 по Epic-у worfy-multi-vendor: «под апи-ключи поддержки не планируется». Это
    решение о продукте. API key только для eval-ов владелец разрешил 2026-11-24 (Ticket 02);
  - Product Session ничего не запускает: ни eval, ни установку SkillEvaluator. Прогон — работа Orchestrator-а.

## Decisions so far

- [01 — Что значит «проверить весь Harness»](issues/01-что-значит-весь-harness.md): срабатывание всех 21 skill-а,
  которые вызывает модель; пилот worfy-harness 52; 12 новых case-ов по риску; результаты в git с интервалом Wilson и
  `--changed`, который видит hook-скрипты, `harness/bin/`, `harness/lib/` и fixture-ы.
- [02 — Брать ли SkillEvaluator для проверки поведения и заводить ли API key](issues/02-skillevaluator-tier-3-и-api-key.md):
  платные eval-ы — на API-кредитах Ultra, жёсткий потолок 200 USD в месяц; Tier 3 SkillEvaluator — только проба на
  diagnosing-bugs и research до 50 USD.
- [04 — Бюджет и частота полного прогона](issues/04-бюджет-и-частота.md): кредиты — на измерения Epic-а, полный
  прогон раз в месяц и SkillEvaluator; `--changed` по PR остаётся на подписке; остаток месяца — на пилот 52.
- [05 — Что делать с case-ом или skill-ом, который провалил проверку](issues/05-что-делать-с-провалом.md): два
  провала подряд — Ticket в worfy-polish; убрать или слить skill решает владелец.
- [06 — На каких моделях идут eval-ы](issues/06-модели-eval-ов.md): регулярные прогоны на `claude-sonnet-5-5`, пилот
  52 и judge на `claude-opus-5-5`.
- [07 — Что показать внешнему человеку и что гнать в этом месяце](issues/07-что-показать-внешнему-человеку.md):
  в этом месяце — проверка, что расход виден в Console, статика SkillEvaluator, проба Tier 3 и полный прогон 28
  case-ов как точка отсчёта. Пилот 52 ждёт новых задач. Задачи, grader-ы и сырые результаты пилота публикуются.
- [08 — Задачи пилота 52: показательные и релевантные](issues/08-задачи-пилота-52.md): в заголовке пилота —
  ложное «готово», правка test-ов, дефекты, найденные на ревью, и опасные действия. Задачи — из ImpossibleBench,
  DeepSWE или SWE-rebench, BugsJS и своя задача про опасные действия. Ветки: worfy в обычной работе, worfy в
  Autopilot, Claude Code без plugin-а, плюс auto mode на опасных задачах. Отдельно меряется расход на простом и на
  сложном запросе. Пилот и эти замеры идут на подписке, в container-ах, ночью; кредиты API — на Tier 3 и регулярные
  замеры.

## Not yet specified

## Out of scope

- Запуск eval-ов и установка SkillEvaluator из Product Session: это работа Orchestrator-а.
- Поведение Harness под Codex и платные run-ы на Windows. Владелец 2026-11-24: «кодекс и виндовс пока откладываем,
  верно». Загружает ли Codex skill-ы Harness, покажет разовая статика SkillEvaluator (Ticket 03).
