#!/usr/bin/env bash
# Fixture of the case: project demo, finish pr-green-ci, variant none (harness/evals/lib/demo-project.sh).
exec bash "$(dirname "$0")/../lib/demo-project.sh" pr-green-ci none
