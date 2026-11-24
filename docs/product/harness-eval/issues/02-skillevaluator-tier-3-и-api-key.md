# 02 — Брать ли SkillEvaluator для проверки поведения и заводить ли API key

Type: grilling
Status: done 2026-11-24T18:50Z
Blocked by: —
Source: [research-nvidia-skillevaluator.md](../research-nvidia-skillevaluator.md), разделы 2, 4 и 8

## Question

Tier 3 SkillEvaluator — запуск настоящего агента с skill-ом и без него. Используем ли его для Harness?

Факты, сверенные с кодом SkillEvaluator на коммите `aa401c794bf1`:

- Tier 3 работает только по API key. Claude Code получает только `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` или
  Vertex. Входа по подписке Claude нет (`src/skillevaluator/tier3/harbor/runner.py`, функция
  `_independent_anthropic_agent_credentials`).
- Публичный путь кладёт в sandbox папку одного skill-а. Hooks, subagents и правила Harness туда не попадают.
  Загрузка plugin-а целиком в CHANGELOG 1.2.0 названа «reserved for prepared runtime packages»
  (`CHANGELOG.md:107-111`).
- Бесплатный ключ NVIDIA Build переводит Claude Code на модель Nemotron и убирает у него tools `Agent` и `Task`, то
  есть subagents (`src/skillevaluator/tier3/harbor/nvidia_build_bridge.py:56-76`).
- Judge Tier 3 на собственном проверочном наборе проекта засчитал успехом 15 из 15 известных провалов
  (`docs/metrics-reference.mdx:607-610`).
- Проект помечен «Experimental». Версия 1.2.0 вышла 2026-11-24.

Наш `claude plugin eval` грузит весь plugin — skills, hooks и subagents — и идёт на подписке.

## Answer

Владелец 2026-11-24: API-кредиты подписки Ultra, 200 USD в месяц, тратить на проверку Harness («можно их здесь и
потратить»). Затем «все да» на два предложения:

- Платные eval-ы идут с API key организации Console, привязанной к Ultra. Auto-reload выключен, так что 200 USD в
  месяц — жёсткий потолок. Ключ хранится только на машине, вне репозитория. Первым шагом — один маленький run и
  проверка, что расход попал в Console, а не в лимит подписки.
- Tier 3 SkillEvaluator — только проба на diagnosing-bugs и research, с skill-ом и без, до 50 USD. Если числа
  окажутся шумом, Tier 3 дальше не используется. Поведение Harness целиком меряет `claude plugin eval`.

## Comments

- 2026-11-24, владелец: «у меня ультра подписка клода, которая предполагает 200$ на апи в месяц, помимо самой
  подписки, можно их здесь и потратить». Совет «API key не заводить» отклонён. Как работают кредиты —
  [research-api-кредиты-ultra.md](../research-api-кредиты-ultra.md).
- Два ограничения Tier 3 от денег не зависят: в sandbox попадает одна папка skill-а, без hooks, subagents и скриптов
  Harness; judge на проверочном наборе проекта засчитал успехом 15 из 15 известных провалов. Следующий раунд
  вопросов: eval-ы на API key и проба Tier 3 на двух skill-ах.
- 2026-11-24, уточнено ответом Ticket-а 04: eval-ы `--changed` по PR остаются на подписке; кредиты идут на измерения
  Epic-а, ежемесячный полный прогон и SkillEvaluator.
