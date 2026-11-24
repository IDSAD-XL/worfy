# 01 — Что значит «проверить весь Harness»

Type: grilling
Status: done 2026-11-24T18:50Z
Blocked by: —
Source: [map.md](../map.md); [research-текущие-eval-ы.md](../research-текущие-eval-ы.md);
[research-вызовы-skill-ов-за-30-дней.md](../research-вызовы-skill-ов-за-30-дней.md); слова владельца 2026-11-24

## Question

Что должна показать проверка всего Harness и в каком объёме?

Что есть сейчас:

- case есть у 11 из 34 skill-ов, у 3 из 4 subagent-ов и у 3 из 11 команд hook-ов;
- срабатывание skill-а на обычные слова проверяют 4 case-а;
- сравнение «с worfy исход лучше, чем у Claude Code без plugin-а» не запускалось ни разу. Это пилот Ticket-а
  worfy-harness 52: 4 задачи, 80 run-ов, оценка 31–70 USD. Владелец принял его 2026-11-08 (идея 4 карты
  `roadmap-worfy`);
- полный набор шёл один раз, 2026-10-18. Результаты не хранятся в git, версии Harness сравнить не с чем.

Варианты, их можно сочетать:

- A. Срабатывание. Каждый из 21 skill-а, которые модель вызывает сама, получает фразы «должен сработать» и
  «не должен». Остальные skill-ы Harness в том же run-е и есть соперники.
- B. Пилот 52: те же задачи с plugin-ом и без него.
- C. Новые case-ы для непокрытого. Либо по риску (hook-и guard, stop и gate, subagent scout, skill-ы, которые
  вызывались за 30 дней без case-а), либо для всех 23 skill-ов.
- D. Результаты каждого полного прогона в git; в отчёте «k из n run-ов» с интервалом Wilson вместо одного среднего.
  Плюс `--changed` начинает видеть правки hook-скриптов, `harness/bin/`, `harness/lib/` и общих fixture-ов.

## Answer

Владелец 2026-11-24: «да» на D, затем «все да» на перепроверенные A–C. Проверка всего Harness — это:

- A. Срабатывание всех 21 skill-а, которые вызывает модель: на каждый 2 фразы «должен сработать» и 1 «не должен»,
  по 3 run-а. 189 коротких run-ов, 20–60 USD за прогон по ценам Sonnet.
- B. Пилот worfy-harness 52: 8 пробных run-ов, потом 80. 34–77 USD по ценам Sonnet.
- C. 12 новых case-ов: hook guard; hook-и stop и gate; subagent scout; skill connect-project; skill-ы research,
  grill-with-docs, diagnosing-bugs, continuous-audit, prototype, writing-for-agents, owner-check, max-review. Разово
  100–200 USD на отладку.
- D. Результаты каждого полного прогона в git; в отчёте «k из n run-ов» с интервалом Wilson; `--changed` видит
  правки hook-скриптов, `harness/bin/`, `harness/lib/` и общих fixture-ов.

13 skill-ов без вызовов за 30 дней отдельных case-ов не получают. Пять из них модель может вызвать сама, их проверяет
пункт A.

## Comments

- 2026-11-24, владелец о варианте D (результаты в git, «k из n run-ов» с интервалом Wilson, `--changed` видит
  hook-скрипты, `harness/bin/`, `harness/lib/` и общие fixture-ы): «да».
- 2026-11-24, владелец о вариантах A–C: «перепроверь». Перепроверка того же дня:
  - подтвердилось: 21 skill модель вызывает сама; case есть у 11 из 34 skill-ов; ни один grader не смотрит на
    hook-и guard, stop и gate; у scout нет case-а; пилот 52 — сначала 8 пробных run-ов (3–7 USD), потом 80 run-ов
    (31–70 USD), платные шаги только по слову владельца; отладка нового case-а стоила 8.83, 16.75 и 16.96 USD;
  - исправлено: подсчёт вызовов теперь по Session-ам, а не по строкам; continuous-audit вызывался (его читали
    файлом); в список «вызывались, но без case-а» добавлены continuous-audit, prototype, connect-project и wait-what.
    Подробно — [research-вызовы-skill-ов-за-30-дней.md](../research-вызовы-skill-ов-за-30-дней.md).
