# 04 — Где живёт Code story

Type: grilling
Status: done 2026-11-15T15:14Z
Blocked by: —
Source: [map.md](../map.md), Notes — срок жизни transcript-ов, режимы Full и Silent

## Question

Где лежит готовая Code story: файлом в папке Epic-а в tickets root (в git в режиме Full, в папке Workflow в режиме
Silent), в данных worfy на этой машине или в PR на GitHub? Сколько она живёт и в каких Project-ах работает?

## Answer

Владелец 2026-11-15, Q4 раунда 1: «Со всем согласен».

Code story Epic-а — markdown-файл в папке Epic-а в tickets root, рядом с файлами его Ticket-ов. В режиме Full он в
git, в режиме Silent — в папке Workflow вне git. Фрагменты кода взяты из commit-а merge-а и не меняются, когда код
правят дальше. Файл живёт дольше transcript-ов (35 дней), в режиме Full читается на GitHub и работает в любом
Project-е Harness-а.

Отклонённые альтернативы: данные worfy на этой машине (не видны ни на другой машине, ни в git); комментарий в PR (у
Epic-а много PR; в режиме Silent не работает).

Revisit when: где лежит story PR без Ticket-а — PR коллег, PR обычной Session — решается в
[Ticket 11](11-code-story-на-pr.md).

## Comments

- 2026-11-15, владелец, раунд 3, Q10: «9-10 да». Code story пишется на языке отчётов из profile (`language.reports`):
  она для человека, который отвечает за код. Код, имена и термины — как в коде и глоссарии.
- 2026-11-15: где лежит story PR, решено в [Ticket 11](11-code-story-на-pr.md), Q9.
