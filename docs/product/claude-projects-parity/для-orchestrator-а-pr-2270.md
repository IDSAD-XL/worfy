# Для Orchestrator-а: закрыть PR #2270

Решение владельца 2026-11-28, ответ на вопрос Q7 темы `claude-projects-parity`: «да».

Что сделать после того, как docs PR с этой темой влит в main:

1. Закрыть PR #2270 «docs: Claude Projects parity and native memory discovery proposal» без merge.
2. Оставить в нём комментарий, например:

   > The proposal now lives unchanged in `docs/product/claude-projects-parity/brief.md`. The Product Session topic
   > `claude-projects-parity` works through it there (map, Mind map and research notes). Closing without merge.

Почему так: файлы темы Product Session живут в `docs/product/<тема>/`. Документ PR лежит в корне `docs/`. Он скопирован
без правок в [brief.md](brief.md): 114 строк, как в PR на ветке `docs/claude-projects-parity-native-memory`.
