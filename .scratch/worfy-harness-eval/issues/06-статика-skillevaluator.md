# 06: Статика SkillEvaluator по 35 skill-ам

Type: task
Status: open
Blocked by: None — can start immediately
Source: [spec.md](../spec.md), «Ticket-ы», 06; «Решения владельца», «SkillEvaluator» (Ticket 02 и 03 темы: бесплатная
статика один раз, «да»); «Решения по реализации» («SkillEvaluator»);
[бриф для Orchestrator-а](../../../docs/product/harness-eval/для-orchestrator-а-статика-skillevaluator.md);
[заметка SkillEvaluator](../../../docs/product/harness-eval/research-nvidia-skillevaluator.md); «Волны», Wave 1

Кто: агент. Глубина ревью — `low`: кода продукта нет, PR несёт отчёт в «Итог» этого Ticket-а.

Бесплатно: `harness-check` и Tier 1 моделей не зовут. Tier 2 и Tier 3 здесь не запускаются. Настоящий binary Codex не
запускается: `harness-check` предсказывает загрузку skill-а в Codex по файлам, сам Codex ему не нужен.

## Что происходит

- Ни один run наших eval-ов не проверяет, загружает ли Codex skill-ы Harness, хотя worfy ставит `harness/` plugin-ом и
  в Claude Code, и в Codex (`harness/README.md`, раздел «On Codex»).
- Бриф темы писался под 34 skill-а. На main `c66e7215a` их 35: добавился `orchestrator-rules` (worfy-polish 160, #2289).

## Что строить

- Шаги брифа `docs/product/harness-eval/для-orchestrator-а-статика-skillevaluator.md`, «Что сделать», 1–5:
  - SkillEvaluator 1.2.0 в отдельном окружении Python в новой папке из `mktemp -d` — не в репозитории и не в main
    checkout;
  - копия `harness/` с main через `git archive`, не из Stable copy;
  - `skillevaluator harness-check <папка skill-а> -v` для каждого из 35 skill-ов `harness/skills/*/`;
  - Tier 1 по plugin-у целиком и по каждому skill-у. Без внешних сканеров (Gitleaks, Bandit) ответ `INCOMPLETE` —
    это «не проверено», а не «чисто».
- Отчёт — в «Итог» этого Ticket-а (папки тем `docs/product/` правит только Product Session):
  - по каждому skill-у: что `harness-check` сказал для Claude Code и для Codex — loads, degrades или drops — и почему;
  - находки Tier 1 уровня High и Critical, кроме BH1 «hook payload unmodeled» на command hook-ах (бриф называет её
    шумом);
  - версии SkillEvaluator и профилей агентов, commit main.
- Находка, которую надо чинить, — по правилу провала (spec, «Решения владельца», «Провал»): вопрос владельцу в «Итог»,
  Ticket-ы не заводятся сами.
- Временное окружение удаляется в конце; фоновых процессов не остаётся.

## Где в коде

- Только читать: `harness/skills/*/SKILL.md`, `harness/hooks/hooks.json`, `harness/.claude-plugin/`
- `docs/product/harness-eval/для-orchestrator-а-статика-skillevaluator.md` — бриф

## Test-ы

- Кода нет. Exit code каждого запуска SkillEvaluator — в «Итог».

## Готово, когда

- [ ] `harness-check` по 35 skill-ам для Claude Code и Codex — таблица в «Итог».
- [ ] Tier 1 по plugin-у и по skill-ам — находки High и Critical в «Итог» или причина `INCOMPLETE`.
- [ ] Версии и commit main в «Итог»; временное окружение удалено.
- [ ] `pnpm lint` — exit 0; `ci-ok` зелёный на head PR.
