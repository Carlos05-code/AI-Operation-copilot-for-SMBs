# AI Evaluation Harness

Offline (CI) evaluation for AI capabilities, per
[AI_ARCHITECTURE](../specifications/AI_ARCHITECTURE.md) §11.

## Layout

```
tests/ai/
├── eval_suite.py        # runner: computes faithfulness & relevance metrics
├── fixtures/            # grounded-truth evaluation sets
│   └── qa.document.json
└── README.md (this file)
```

## Metrics computed

| Metric               | Definition                                         |
| -------------------- | -------------------------------------------------- |
| `faithfulness`       | n-gram entailment between answer and retrieved ctx |
| `relevance`          | answer overlaps with the expected-gold content     |
| `citation_precision` | % of citations whose chunk supports the claim      |
| `context_coverage`   | % of gold facts present in fetched context         |

## Running

```bash
python tests/ai/eval_suite.py --fixture tests/ai/fixtures/qa.document.json
```

Exit code is non-zero when any metric is below the minimums in `fixtures/*.min.json` → blocks the
merge gate in `ai-eval.yml`.

## Adding a fixture

1. Add a `*.json` file with `{"qid","question","gold","retrieved":[],"answer","citations":[]}`.
2. Optionally pin `minimum` thresholds per fixture.
3. CI consumes the whole directory automatically.
