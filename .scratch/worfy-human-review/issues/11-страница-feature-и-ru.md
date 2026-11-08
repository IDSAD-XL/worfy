# 11 — Страница Feature «Team reviewer» и её `ru/` копия

Type: task
Status: open
Blocked by: 05, 08, 09, 10
Source: [spec.md](../spec.md), «Цель и что видит пользователь»; «Как работает»; «Не в этом Epic-е» (Session-ы терминала); «Риски», п. 5

Не платформенный: только документы. Глубина ревью — `low` и проверка утверждений страницы против кода (как у
worfy-feature-docs: каждое утверждение — путь и строка, проверено вторым агентом).

## Что происходит

- Страниц Feature о ревьюере команды нет. `docs/features/projects.md` не знает о строке после Connect и о разделе
  «Team reviewer» в Project settings.
- Stage Pipeline-а `human-review` (`harness/profiles/README.md:188`) — другая вещь с похожим именем.
- В `CONTEXT.md` нет термина для частного skill-а ревью.

## Что делаем

1. `docs/features/human-review.md` по шаблону страниц Feature (Behaviour, Windows, On a Linked machine, How it works,
   Implementation): строка при добавлении, «Build», оценка и «да», короткая история, частная папка и что в ней,
   проверка на 5 PR, загрузка в Session и кто её не получает, обновление, «Delete»; как дать skill Session-у терминала
   (`claude --add-dir <папка>`). Явно: это не Stage `human-review`.
2. `docs/features/ru/human-review.md` — перевод, термины латиницей.
3. Индексы `docs/features/README.md` и `ru/README.md`; в `projects.md` и `ru/projects.md` — строка о toast-е после
   Connect и разделе «Team reviewer» со ссылкой.
4. `CONTEXT.md` — термин **Team reviewer**: частный skill ревью проекта, собранный из истории PR, в папке Profile-а.

## Готово, когда

- [ ] Страница и `ru/` копия описывают сделанное в 03–10; каждое утверждение — со ссылкой на файл и строку, проверено
      вторым агентом.
  - evidence: commit pass · docs: add the Team reviewer feature page and its Russian copy (claims checked against the code by a second agent) · - - · 588c8b0531961928611ae8e691a397e8bd1879f1
- [ ] На странице нет ни одного текста комментария, логина, пути домашней папки и названия чужого проекта.
  - evidence: test-run pass · `node harness/bin/evidence-check docs/features/human-review.md docs/features/ru/human-review.md` exit 0 · mac - · 588c8b0531961928611ae8e691a397e8bd1879f1
- [ ] `node scripts/check-cyrillic.mjs`, `node scripts/check-handoff.mjs` — exit 0; `ci-ok` на PR зелёный.
  - evidence: test-run pass · `node scripts/check-cyrillic.mjs && node scripts/check-handoff.mjs` exit 0 · mac - · 588c8b0531961928611ae8e691a397e8bd1879f1

## Тесты

- Документы; test-ов нет. Проверка утверждений — второй агент.

## Где в коде

- `docs/features/human-review.md` (новый)
- `docs/features/ru/human-review.md` (новый)
- `docs/features/README.md`
- `docs/features/ru/README.md`
- `docs/features/projects.md`
- `docs/features/ru/projects.md`
- `CONTEXT.md`
