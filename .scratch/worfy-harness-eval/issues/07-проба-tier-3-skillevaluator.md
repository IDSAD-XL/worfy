# 07: Проба Tier 3 SkillEvaluator на diagnosing-bugs и research

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Ticket-ы», 07; «Решения владельца», «SkillEvaluator» (Tier 3 — только проба на
diagnosing-bugs и research до 50 USD; если числа окажутся шумом, Tier 3 дальше не используется) и «Провал» (skill без
пользы по Tier 3 — вопрос владельцу); «Решения по реализации» («SkillEvaluator»); «Риски» (judge Tier 3 засчитал 15 из
15 известных провалов; лимит SkillEvaluator не считает judge);
[заметка SkillEvaluator](../../../docs/product/harness-eval/research-nvidia-skillevaluator.md), разделы 4, 5 и 8;
«Волны», Wave 2

Кто: агент. Глубина ревью — `low`: кода продукта нет, PR несёт отчёт в «Итог».

Платный Ticket: кредиты, API key организации Console (Ticket 01). Потолок Ticket-а — 50 USD (решение владельца).
Лимит SkillEvaluator не считает judge, поэтому лимит запуска ставится ниже: например 35 USD на агента; остаток —
запас на judge. Сначала бесплатный шаг: набор case-ов и план запуска без вызова модели.

## Что происходит

- Tier 3 SkillEvaluator гоняет case-ы с skill-ом и без него в Docker и сравнивает исход. Judge Tier 3 по собственному
  замеру проекта засчитал успехом 15 из 15 известных провалов, поэтому проба идёт и на skill-е с исходом, который
  проверяют test-ы (diagnosing-bugs).
- На Mac `claude plugin eval` с Bash отказывает, если в `~/.docker` есть symbolic link; обход Orchestrator-у известен.

## Что строить

- SkillEvaluator в отдельном окружении вне репозитория, как в Ticket-е 06.
- По 4 и больше case-ов на skill, с skill-ом и без, Docker, API key. Агент — только Claude Code; профиль Codex не
  запускается.
- Набор case-ов человек смотрит до запуска: Orchestrator кладёт его в «Итог» и показывает владельцу (ручной пункт).
- Run-ы, цена, исход по каждому case-у с skill-ом и без — в «Итог». Оценка judge сверяется с исходом test-ов там, где
  test-ы есть.
- Вывод: числа — шум или нет. Если шум, «Итог» так и пишет, и Tier 3 дальше не используется. Skill без пользы по Tier
  3 — вопрос владельцу в «Итог», ничего не удаляется.
- Временное окружение и container-ы удаляются в конце.

## Где в коде

- Только читать: `harness/skills/diagnosing-bugs/`, `harness/skills/research/`
- `docs/product/harness-eval/research-nvidia-skillevaluator.md` — как запускается Tier 3

## Test-ы

- Кода нет. Exit code каждого запуска и `costUsd` — в «Итог».
- Настоящий binary Codex не запускается.

## Готово, когда

- [ ] План запуска и набор case-ов в «Итог» до платного run-а.
- [ ] (вручную) Сделай: прочитай набор case-ов Tier 3 в «Итог» → Должно быть: у каждого case-а понятно, что считать
      успехом; набор одобрен или поправлен до запуска.
  - needs: mac
- [ ] Проба на кредитах, сумма Ticket-а не больше 50 USD вместе с judge; run-ы и цена в «Итог».
- [ ] Вывод «шум или нет» и решение по Tier 3 в «Итог».
- [ ] `pnpm lint` — exit 0; `ci-ok` зелёный на head PR.
