#!/usr/bin/env bash
# Fixture of the case: project demo, finish local-green, variant ui (harness/evals/lib/demo-project.sh).
exec bash "$(dirname "$0")/../lib/demo-project.sh" local-green ui
