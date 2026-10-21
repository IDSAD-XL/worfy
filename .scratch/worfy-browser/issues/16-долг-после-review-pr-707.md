# 16 — Долг после review PR #707: комментарий и пустое ожидание в test-е Browser layer

Type: task
Status: open
Blocked by: —
Source: ревью PR [#707](https://github.com/IDSAD-XL/worfy/pull/707) (Ticket 15), 2026-10-21. Low.

## Готово, когда

- [ ] `test/unit/browser-layer.test.tsx:84-85`: комментарий вводит в заблуждение, а ожидание 50 ms ничего не
      проверяет. Поправить комментарий; ожидание убрать или заменить ожиданием того, что оно должно ловить.
- [ ] `pnpm test test/unit/browser-layer.test.tsx` — exit 0.

## Итог

Заполняется при закрытии.
