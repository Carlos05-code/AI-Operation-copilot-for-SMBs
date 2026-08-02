#!/usr/bin/env python3
"""Offline AI evaluation harness.

Computes faithfulness/relevance/citation metrics over grounded-truth fixtures
and fails the process when any metric is below the per-fixture minimum.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

TOKEN_RE = re.compile(r"\w+")


def tokens(text: str) -> set[str]:
    return set(TOKEN_RE.findall(text.lower()))


def overlap(a: str, b: str) -> float:
    ta, tb = tokens(a), tokens(b)
    if not tb:
        return 0.0
    return len(ta & tb) / len(tb)


def faithfulness(answer: str, context: str) -> float:
    """Fraction of answer tokens present in the retrieved context."""
    ta, cctx = tokens(answer), tokens(context)
    if not ta:
        return 1.0
    return len(ta & cctx) / len(ta)


def relevance(answer: str, gold: str) -> float:
    return overlap(answer, gold)


def citation_precision(citations: list[str], context: str) -> float:
    ctx = context.lower()
    if not citations:
        return 0.0
    hits = 0
    for c in citations:
        if c and c.lower() in ctx:
            hits += 1
    return hits / len(citations)


def context_coverage(context: str, gold: str) -> float:
    if not tokens(gold):
        return 1.0
    return overlap(context, gold)


def evaluate(fixture: dict) -> dict:
    context = " ".join(fixture.get("retrieved", []))
    return {
        "qid": fixture.get("qid", "?"),
        "faithfulness": faithfulness(fixture.get("answer", ""), context),
        "relevance": relevance(fixture.get("answer", ""), fixture.get("gold", "")),
        "citation_precision": citation_precision(
            fixture.get("citations", []), context
        ),
        "context_coverage": context_coverage(context, fixture.get("gold", "")),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", required=True, type=Path)
    args = parser.parse_args()

    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    minimum = fixture.get("minimum", {})

    failed = False
    for case in fixture.get("cases", []):
        results = evaluate(case)
        print(f"[{results['qid']}] faithfulness={results['faithfulness']:.2f} "
              f"relevance={results['relevance']:.2f} "
              f"citation={results['citation_precision']:.2f} "
              f"coverage={results['context_coverage']:.2f}")
        for metric, threshold in minimum.items():
            if results[metric] < threshold:
                failed = True
                print(f"  FAIL {metric}: {results[metric]:.2f} < {threshold}", file=sys.stderr)

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())