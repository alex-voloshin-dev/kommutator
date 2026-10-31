# Follow-up review, 2026-10-25

Historical English summary, curated for publication on 2026-10-29. The original Russian
report and annotations are retained privately; this is not a verbatim translation or a
claim of fresh verification.

The v0.2.4 follow-up required JSON-RPC envelope validation before field access and containment of handler exceptions, consistent Unicode-code-point preview limits, header packing at very small budgets, and app-server spike success only for turn.status completed. These changes closed scaffold findings; they did not themselves prove live vendor behavior.

Accepted behavior is maintained in [DESIGN](../DESIGN.md); current implementation and
remaining gates are in [ARCHITECTURE](../ARCHITECTURE.md) and [ROADMAP](../ROADMAP.md).
