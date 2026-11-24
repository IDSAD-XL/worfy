# Для Orchestrator-а: один прогон статики NVIDIA SkillEvaluator на skill-ах Harness

Дата: 2026-11-24. Это просьба владельца, записанная Product Session `harness-eval`, Ticket 03 темы («Разовая статика
SkillEvaluator на 34 skill-ах»). Product Session ничего не запускает, поэтому прогон делает Orchestrator.

Слова владельца: «да». Это ответ на вопрос: «Orchestrator ставит SkillEvaluator во временное окружение и один раз
прогоняет `harness-check` и Tier 1 на 34 skill-ах».

## Зачем

worfy ставит папку `harness/` plugin-ом и в Claude Code, и в Codex (`harness/README.md`, раздел «On Codex»). Ни один
run нашего eval-а Codex не проверяет. `skillevaluator harness-check` читает файлы skill-а и предсказывает, загрузит ли
агент skill целиком, обрежет его или выбросит без ошибки. Модель и ключ ему не нужны. Агентов шесть, среди них
Claude Code и Codex.

## Что сделать

1. Поставить SkillEvaluator 1.2.0 (пакет `skillevaluator` на PyPI, https://github.com/NVIDIA/SkillEvaluator) в
   отдельное окружение Python 3.12–3.14 в новой папке из `mktemp -d`: venv или `uv tool install`. Не в репозиторий и
   не в main checkout.
2. Взять копию `harness/` с main через `git archive` или отдельный worktree, не из Stable copy.
3. Для каждого из 34 skill-ов `harness/skills/*/` выполнить `skillevaluator harness-check <папка skill-а> -v`.
4. Выполнить Tier 1 по plugin-у целиком и по каждому skill-у. Описание — `docs/tier1-reference.mdx` их репозитория.
   Tier 1 нужны внешние сканеры (Gitleaks, Bandit). Без них он отвечает `INCOMPLETE` и ненулевым exit code; такой
   ответ — «не проверено», а не «чисто». Tier 2 не запускать: ему нужен провайдер embeddings.
5. Отчёт — файлом вне `docs/product/` (папки тем правит только Product Session) и коротко владельцу:
   - по каждому skill-у: что `harness-check` сказал для Claude Code и для Codex — loads, degrades или drops — и почему;
   - находки Tier 1 уровня High и Critical. Кроме BH1 «hook payload unmodeled» на command hook-ах: она придёт на
     каждый из 20 command hook-ов Harness заранее (`docs/tier1-reference.mdx:362` их репозитория), это шум;
   - версии: SkillEvaluator, профили агентов (их печатает `-v`), commit main;
   - exit code каждой команды.

   Product Session перенесёт итог в `## Answer` Ticket-а 03.

## Ограничения

- Модель не вызывается. Если команда просит API key — остановиться, ключ не вводить.
- Из их репозитория ничего не запускать, только установленный пакет. Версия 1.2.0 вышла 2026-11-24, проект помечен
  «Experimental».
- Находки — не Ticket-ы. Что из них станет работой, решает владелец в теме `harness-eval`.
- После прогона удалить временную папку и окружение. Фоновых процессов не оставлять.
