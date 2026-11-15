# 01 — Из чего строить Code story: что остаётся от работы агента

Type: research
Status: done 2026-11-15T15:33Z
Blocked by: —
Source: [map.md](../map.md), Notes — факты о transcript-ах; [README исследования конкурентов](../../../research/2026-11-13-competitors/README.md), строка 1223

## Question

Что остаётся от работы над одним Ticket-ом, из чего можно собрать Code story и ответить на вопрос к строке, и сколько
это живёт? Файл Ticket-а (вопрос, раздел done, Evidence), JSON-отчёт implementer-а, текст PR и комментарии review,
вердикты reviewer-ов, журнал run-а Autopilot-а, transcript-ы Claude Code и Codex. Видит ли Session, которую продолжили
(`resume`), свои прежние рассуждения, если блоки thinking в transcript-е пустые? Сколько стоит такое продолжение для
большой Session?

## Answer

Заметка: [research-из-чего-строить-code-story.md](../research-из-чего-строить-code-story.md). Главное:

- Рассуждения агента не потеряны, но прочитать их может только сама модель. Claude Code просит у API `display:
  "updates"`, поэтому текст thinking пустой, а полное рассуждение лежит зашифрованным в поле `signature`. Session,
  которую продолжили той же моделью без compaction, получает его целиком. Человек и worfy его не прочтут; живёт оно,
  пока жив transcript (35 дней после последней записи родительской Session). Насколько точно продолженный агент
  пересказывает отброшенные варианты, никто не измерял.
- Больше всего «почему» — в тексте PR на GitHub (медиана 359 слов); в git его нет. Дальше — раздел `## Итог` файла
  Ticket-а (у 78 из 142). Отброшенные варианты записаны редко: 9 из 142 Ticket-ов, 4 из 34 PR.
- JSON-отчёт implementer-а (что не проверено, что убрано) в файл не сохраняется — только в transcript-ах.
- Вердикты verifier-а — комментарии PR на GitHub, со строками `path:line`.
- Цена вопроса через resume implementer-а: первый вызов $1,20–2,65 по цене API, если prompt cache остыл (TTL 1 час), и
  $0,03–0,07, если тёплый. Новая Session с контекстом около 30 тыс. token-ов — около $0,15–0,24.
- Codex хранит rollout-ы без срока, рассуждения там тоже зашифрованы.
- API отказывает на просьбу вывести «a running log of its reasoning»; можно просить «a short explanation, the evidence
  behind a result, or a summary of the actions it took».
