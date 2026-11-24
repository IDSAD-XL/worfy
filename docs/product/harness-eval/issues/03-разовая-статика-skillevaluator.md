# 03 — Разовая статика SkillEvaluator на 34 skill-ах

Type: task
Status: open
Blocked by: —
Source: [research-nvidia-skillevaluator.md](../research-nvidia-skillevaluator.md), разделы 1, 4 и 8;
`harness/README.md`, раздел «On Codex»

## Question

Загружают ли Claude Code и Codex каждый из 34 skill-ов Harness целиком? Что находит Tier 1 SkillEvaluator?

- `skillevaluator harness-check` читает файлы skill-а и предсказывает, загрузит ли его агент, обрежет или выбросит
  без ошибки. Проверяет шесть агентов, среди них Claude Code и Codex. Модель и ключ не нужны
  (`docs/harness-check.mdx` в репозитории SkillEvaluator).
- worfy ставит папку Harness plugin-ом и в Codex. Ни один run нашего eval-а Codex не проверяет.
- Tier 1 — schema, качество `SKILL.md`, сканеры безопасности. Нужны Python 3.12–3.14 и внешние сканеры. На каждый
  command hook Harness придёт находка BH1 «hook не разобран» (`docs/tier1-reference.mdx:362`). Это ожидаемый шум,
  не дефект.

Делает Orchestrator, если владелец согласен. Product Session ничего не запускает. Установка — во временное окружение,
не в репозиторий. Результат записывается сюда, в раздел Answer.

## Comments

- 2026-11-24, владелец: «да». Бриф для Orchestrator-а —
  [для-orchestrator-а-статика-skillevaluator.md](../для-orchestrator-а-статика-skillevaluator.md).
