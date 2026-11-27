# Technical design review round 3

Verdict: approve. Root identified initial-versus-refresh explicit-hint admission
inconsistency before release. Independent reviewer confirmed major: a new
Claude owner could be accepted with remote R/hint P then fail identical refresh.
Design now requires each caller/daemon assertion independently agree on every
Claude registration before lifecycle mutation. Internal re-review approved.
External re-review approved with two minors: new-conversation activation within
the same process and removal after checkout deletion; both clarified with tests.
Compatibility tightening is explicit and must be in release notes.

Earlier full-record CAS major was fixed in round2. File descriptor/private lock
criteria retained. No board history merge/current-seat reassignment promised.
Budget6 authorized; design concludes at round3. Code/QA qualifications separate.
