---
type: regex
target: { source: file, path: review-limit.md }
pattern: '^### (?:(?:(?!^Fact:[ \t]*\S)[\s\S])*?|(?:(?!^Judgement:[ \t]*\S)[\s\S])*?|(?:(?!^Owner decision:)[\s\S])*?)(?:^#{1,3} |(?![\s\S]))'
flags: m
match: not_contains
---

An objection of the review of the limit plan, if it has any — a `### ` heading up to the next
heading — has a `Fact:` line with a fact on it, a `Judgement:` line with the critic's judgement on it
and an `Owner decision:` line.
