# Independent QA

Test-only commit5ed3c031e8b3ac083c922ef89b61668e38f5b9c7 adds real Unix IPC hello followed
by retained operation lookup while an unrelated hub response remains held; no queue mutation
or extra hub request is permitted. Additional cases fence lifecycle-epoch/session-UUID
replacement and await owner lifecycle work introduced during the second process probe.

Ordered build/typecheck and full workspace test passed first attempt:41 protocol,209 hub,
280 agentd,338 CLI —868 tests. Cold SessionStart116.844ms, below200ms target/strict300ms limit;
no above-target sample printed. No production edits/services or weakened assertions.
Logs /tmp/kom-local-rebind-qa-{build,types,test}.log. Synthetic clients do not establish real
vendor dialogue, native idle wake, day-long stability or historical outage causes.

Engineer intermediate fixture mistakes and one unchanged disk-backed timeout remain in
implementation.md; successful QA does not explain the earlier disk timeout.


Final0.17.2 follow-up after controlled observation-persistence test repair: ordered build,
typecheck and870/870 workspace tests passed first attempt (41/209/280/340). Controlled
observation-stall process185.726ms. No extra QA edits needed; exact CI interruption timing
remains unproven. Logs /tmp/kom-v0172-qa-{build,types,test}.log.
