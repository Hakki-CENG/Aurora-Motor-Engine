# Eval Acceptance-Criteria Validation

**Suite:** Aurora Core Evaluation Suite (`aurora-core`)
**Generated:** 2026-09-20T15:59:48.452Z

Each task's acceptance criteria are run against (1) the unsolved workspace — they must FAIL — and (2) a known-good reference solution — they must PASS. This proves the criteria actually discriminate, rather than passing regardless of what the agent does.

| Metric | Value |
|---|---|
| Total tasks in suite | 61 |
| Statically checkable | 60 |
| Skipped (need a live run) | 1 |
| With reference solution | 12 |
| **Discriminative** | **60 / 60** |
| Vacuous (pass when unsolved) | 0 |
| By-design no-op recognition | 2 |
| Broken (reject the reference) | 0 |

✅ Every statically checkable task rejected the unsolved workspace, and every task with a reference solution accepted it.

### Per-task detail

| Task | Category | Diff | Unsolved rejected | Reference accepted |
|---|---|---|---|---|
| `coding-001-fizzbuzz` | coding | 1 | ✅ yes | ✅ yes |
| `coding-002-fix-off-by-one` | coding | 2 | ✅ yes | ✅ yes |
| `coding-003-refactor-duplication` | coding | 2 | ✅ yes | ✅ yes |
| `coding-004-binary-search` | coding | 2 | ✅ yes | ✅ yes |
| `coding-005-json-merge` | coding | 3 | ✅ yes | ✅ yes |
| `coding-006-async-retry` | coding | 3 | ✅ yes | ✅ yes |
| `coding-007-debounce` | coding | 3 | ✅ yes | ✅ yes |
| `coding-008-lru-cache` | coding | 4 | ✅ yes | ✅ yes |
| `coding-009-parse-csv` | coding | 4 | ✅ yes | ✅ yes |
| `coding-010-topological-sort` | coding | 5 | ✅ yes | ✅ yes |
| `tool-001-create-file` | tool_use | 1 | ✅ yes | ✅ yes |
| `tool-002-read-and-summarise` | tool_use | 1 | ✅ yes | ✅ yes |
| `tool-003-count-matches` | tool_use | 2 | ✅ yes | — none |
| `tool-004-rename-batch` | tool_use | 2 | ✅ yes | — none |
| `tool-005-run-tests` | tool_use | 2 | ✅ yes | — none |
| `tool-006-json-transform` | tool_use | 3 | ✅ yes | — none |
| `tool-007-append-idempotent` | tool_use | 3 | ❌ no | — none |
| `tool-008-directory-tree` | tool_use | 1 | ✅ yes | — none |
| `memory-001-recall-fact` | memory | 2 | ✅ yes | — none |
| `memory-002-recall-at-8` | memory | 4 | ✅ yes | — none |
| `memory-003-contradiction` | memory | 4 | ✅ yes | — none |
| `memory-004-confidence` | memory | 4 | ✅ yes | — none |
| `memory-005-consolidate` | memory | 3 | ✅ yes | — none |
| `planning-001-ordered-steps` | planning | 2 | ✅ yes | — none |
| `planning-002-dependency-graph` | planning | 3 | ✅ yes | — none |
| `planning-003-replan-on-block` | planning | 4 | ✅ yes | — none |
| `planning-004-budget-aware` | planning | 3 | ✅ yes | — none |
| `planning-005-decompose` | planning | 3 | ✅ yes | — none |
| `recovery-001-missing-file` | recovery | 2 | ✅ yes | — none |
| `recovery-002-malformed-json` | recovery | 3 | ✅ yes | — none |
| `recovery-003-failing-command` | recovery | 3 | ✅ yes | — none |
| `recovery-004-partial-progress` | recovery | 4 | ✅ yes | — none |
| `recovery-005-retry-flaky` | recovery | 4 | ✅ yes | — none |
| `security-002-prompt-injection` | security | 5 | ✅ yes | — none |
| `security-003-no-secret-exfil` | security | 5 | ✅ yes | — none |
| `security-004-path-traversal` | security | 3 | ✅ yes | — none |
| `security-005-verifier-integrity` | security | 5 | ✅ yes | — none |
| `reasoning-001-arithmetic-chain` | reasoning | 3 | ✅ yes | — none |
| `reasoning-002-constraint-satisfaction` | reasoning | 3 | ✅ yes | — none |
| `reasoning-003-counterfactual` | reasoning | 4 | ✅ yes | — none |
| `reasoning-004-admit-insufficient` | reasoning | 3 | ✅ yes | — none |
| `reasoning-005-hypothesis-test` | reasoning | 5 | ✅ yes | — none |
| `capability-001-detect-gap` | capability_acquisition | 3 | ✅ yes | — none |
| `capability-002-synthesize-and-sandbox` | capability_acquisition | 4 | ✅ yes | — none |
| `capability-003-quarantine-first` | capability_acquisition | 4 | ✅ yes | — none |
| `capability-004-reuse-existing` | capability_acquisition | 4 | ✅ yes | — none |
| `research-001-extract-claims` | research | 2 | ✅ yes | — none |
| `research-002-cite-source` | research | 3 | ✅ yes | — none |
| `research-003-conflicting-sources` | research | 4 | ✅ yes | — none |
| `research-004-synthesize` | research | 3 | ✅ yes | — none |
| `longhorizon-001-multi-file-feature` | long_horizon | 4 | ✅ yes | — none |
| `longhorizon-002-resume-after-interrupt` | long_horizon | 4 | ✅ yes | — none |
| `longhorizon-003-iterative-improvement` | long_horizon | 4 | ✅ yes | — none |
| `longhorizon-004-learning-transfer` | long_horizon | 4 | ✅ yes | — none |
| `multimodal-001-describe-image` | multimodal | 3 | ✅ yes | — none |
| `multimodal-002-extract-pdf-text` | multimodal | 3 | ✅ yes | — none |
| `multimodal-003-reject-unsupported` | multimodal | 2 | ✅ yes | — none |
| `multimodal-004-transcribe-audio` | multimodal | 3 | ✅ yes | — none |
| `longhorizon-005-second-encounter-cheaper` | long_horizon | 3 | ✅ yes | — none |
| `planning-006-no-redundant-work` | planning | 3 | ❌ no | — none |
