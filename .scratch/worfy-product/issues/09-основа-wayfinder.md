# 09 — Основа — wayfinder

Type: grilling
Status: done 2026-11-07T18:50Z
Blocked by: 08
Source: [map.md](../map.md), ответы [05](05-экран-product-session-и-mind-map.md) и [08](08-поведение-советника.md)

## Question

На каком процессе стоит Product Session, как папка темы в `docs/product/` связана с картой поиска пути (wayfinder) и с Mind map, и кто проверяет формат?

## Answer

Владелец 2026-11-07: «Да» на Q1–Q3.

- Q1: Product Session — это процесс wayfinder + grilling + research + prototype + to-spec, плюс наши слои: критик, генерация идей, Mind map, доля принятых советов.
- Q2: папка темы `docs/product/<тема>/` — карта wayfinder (`map.md` и `issues/`) плюс файл Mind map с более мелкими узлами и их положением. Ticket-ы карты — крупные узлы Mind map.
- Q3: формат карты, который worfy описывает сам, worfy же читает и проверяет, поэтому смена формата видна сразу.
- Затем владелец решил перенести skills Matt Pocock в плагин worfy: Epic `worfy-skills`, spec принят 2026-11-07. Это заменяет прежнее «без fork-а».
