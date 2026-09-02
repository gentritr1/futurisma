#!/usr/bin/env python3
"""P20.4 review harness: pull the numbers the phase is gated on out of a
scripts/visual/diag.mjs dump (which prints the whole diagnostics JSON, sometimes
after a TIMEOUT line)."""
import json
import re
import sys

text = open(sys.argv[1]).read()
match = re.search(r"\{.*\}", text, re.S)
report = json.loads(match.group(0))
current = report.get("current", report)
peak = report.get("peak", {})
print("lapTimesMs   ", current.get("lapTimesMs"))
print("p95FrameMs   ", current.get("p95FrameMs"))
print("avgFrameMs   ", current.get("averageFrameMs"), " frames", current.get("frames"))
print("calls        ", current.get("calls"), " peakCalls", peak.get("calls"))
print("triangles    ", current.get("triangles"))
print("livingWorld  ", {k: v for k, v in current.items() if k.startswith("livingWorld")})
