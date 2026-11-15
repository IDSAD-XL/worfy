# 05 — Code stories и черновики worfy-changes-view и worfy-acceptance

Type: grilling
Status: done 2026-11-15T15:14Z
Blocked by: —
Source: [черновик worfy-changes-view](../../../../.scratch/worfy-changes-view/spec.md) (критик — Split);
[черновик worfy-acceptance](../../../../.scratch/worfy-acceptance/spec.md) (критик — Defer);
[README исследования конкурентов](../../../research/2026-11-13-competitors/README.md), строки 1223–1226

## Question

Ждёт ли Epic Code stories экрана Changes (diff Ticket-а с комментариями к строкам) и приёмки владельца в одном виде,
входит ли в один из этих Epic-ов или идёт отдельно?

## Answer

Владелец 2026-11-15, Q5 раунда 1: «Со всем согласен».

Epic Code stories идёт отдельно и не зависит от черновиков `worfy-changes-view` и `worfy-acceptance`. Фрагменты кода в
story — неизменные цитаты, полный diff открывается ссылкой на PR. Когда экран Changes появится, вопрос к строке
добавится туда отдельным Ticket-ом.

Отклонённые альтернативы: ждать экрана Changes; сделать Code stories частью одного из этих Epic-ов.

Revisit when: владелец примет `worfy-changes-view` или `worfy-acceptance`.
