"""Held-out chatbot benchmark runner. The supplied CSV is never used for training."""
import argparse
import csv
import json
from pathlib import Path
import sys
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.db import SessionLocal  # noqa: E402
from app.services.chatbot import answer, detect_intent  # noqa: E402


def expected_intent(text: str) -> str | None:
    marker = "Expected intent: "
    return text.split(marker, 1)[1].split(".", 1)[0].strip() if marker in text else None


def run(source: Path, output: Path) -> dict:
    db = SessionLocal(); records = []
    try:
        with source.open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                question, expected = row["question"], expected_intent(row["answer"])
                started = perf_counter(); reply, intent, tool_data, citations = answer(db, question); elapsed = (perf_counter()-started)*1000
                records.append({"question": question, "expected_intent": expected, "intent": intent, "intent_correct": intent == expected, "tool_success": bool(tool_data), "latency_ms": round(elapsed, 2), "grounded": bool(tool_data or citations), "response": reply})
    finally:
        db.close()
    count = len(records) or 1
    summary = {"cases": len(records), "intent_accuracy": sum(r["intent_correct"] for r in records)/count, "tool_call_success_rate": sum(r["tool_success"] for r in records)/count, "groundedness_rate": sum(r["grounded"] for r in records)/count, "unsupported_claim_rate": 1-sum(r["grounded"] for r in records)/count, "mean_latency_ms": sum(r["latency_ms"] for r in records)/count, "results": records}
    output.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--input", default=str(ROOT / "data" / "chatbot_benchmark.csv")); parser.add_argument("--output", default=str(ROOT / "data" / "benchmark_results.json")); args = parser.parse_args()
    print(json.dumps(run(Path(args.input), Path(args.output)), indent=2))
