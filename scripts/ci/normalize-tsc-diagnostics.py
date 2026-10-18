#!/usr/bin/env python3
"""Normalizes `tsc --pretty false` diagnostics for the TypeScript regression gate (stdin -> stdout, one line per diagnostic).

1. Drops the `path(line,col): ` prefix, so a diagnostic that merely moved is not "new" (the gate's original behavior).
2. Sorts the members of printed string-literal unions wherever they appear (bare, quoted or inside `Omit<T, ...>`), e.g. `"warn" | "info"` -> `"info" | "warn"`. TypeScript prints union
   members in internal type-id order, which depends on the order in which the checker first met each literal. Adding an import to an
   early-checked file can reorder that, so the same unchanged diagnostic reads differently. Sorting makes the text a function of the
   type, not of checking order. Nothing is hidden: a diagnostic whose type, code or message really differs is still reported.
"""
import re
import sys

PREFIX = re.compile(r"^([^(:]+)\([^)]*\): ")
UNION = re.compile(r"\"[^\"]*\"(?: \| \"[^\"]*\")+")


def sort_union(match: "re.Match[str]") -> str:
    members = re.findall(r"\"[^\"]*\"", match.group(0))
    return " | ".join(sorted(members))


for line in sys.stdin:
    line = PREFIX.sub("", line.rstrip("\n"))
    print(UNION.sub(sort_union, line))
