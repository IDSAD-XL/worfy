---
type: regex
target: { source: file, path: review-greet.md }
pattern: '^### (?:(?:(?!^Fact:[ \t]*\S)[\s\S])*?|(?:(?!^Owner decision:)[\s\S])*?)(?:^#{1,3} |(?![\s\S]))'
flags: m
match: not_contains
---

An objection of the review of the greet plan, if it has any, has a `Fact:` line with a fact on it
and an `Owner decision:` line.
