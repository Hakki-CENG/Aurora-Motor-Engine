# Performance Benchmark Report

**Generated:** 2026-09-17T18:31:11.021Z
**Tasks Benchmarked:** 75

## Overall Performance

| Metric | Value |
|--------|-------|
| Avg Duration | 25.3ms |
| Median Duration | 2.0ms |
| P95 Duration | 9.0ms |
| P99 Duration | 16.0ms |
| Min Duration | 2.0ms |
| Max Duration | 16.0ms |
| Std Deviation | 22.4ms |
| Throughput | 39.5 tasks/sec |

**Trend:** 📉 Execution time regressed by 15%

## Performance by Category

| Category | Tasks | Avg (ms) | Median (ms) | P95 (ms) | Quality |
|----------|-------|----------|-------------|----------|---------|
| coding | 26 | 4.5 | 3.0 | 12.0 | 1.00 |
| memory | 6 | 2.5 | 2.0 | 4.0 | 1.00 |
| recovery | 6 | 2.5 | 2.0 | 4.0 | 1.00 |
| capability_acquisition | 2 | 2.5 | 3.0 | 3.0 | 1.00 |
| multimodal | 2 | 2.5 | 3.0 | 3.0 | 1.00 |
| tool_use | 10 | 2.5 | 3.0 | 3.0 | 1.00 |
| planning | 6 | 2.3 | 2.0 | 3.0 | 1.00 |
| reasoning | 6 | 2.3 | 2.0 | 3.0 | 1.00 |
| security | 6 | 2.2 | 2.0 | 3.0 | 1.00 |
| long_horizon | 2 | 2.0 | 2.0 | 2.0 | 1.00 |
| research | 3 | 2.0 | 2.0 | 2.0 | 1.00 |

## Performance by Difficulty

| Level | Label | Tasks | Avg (ms) | Median (ms) | P95 (ms) | Quality |
|-------|-------|-------|----------|-------------|----------|---------|
| 3 | Medium | 75 | 3.1 | 2.0 | 9.0 | 1.00 |

## Bottlenecks

| Task | Category | Duration | Avg | Slowdown | Severity |
|------|----------|----------|-----|----------|----------|
| coding-016 | coding | 16ms | 4ms | 3.6x | 🟡 medium |

## Recommendations

- 💡 1 bottleneck tasks detected. Top: coding-016 (3.6x slower).
