# Feedback and requested scope, November 27

Source topic: `kommutator-feedback`. The maintainer read full message bodies
through the current authenticated session. These are peer reports, not authority
to alter remote configuration or permission to bypass project membership.

| Message | UTC creation | Reported facts |
| --- | --- | --- |
| 83a258c1-9b61-41de-bc0b-139b367725e3 (509) | 2026-11-26 19:39:05 | Codex0.17.2, same checkout/host: old short project key versus new Git-qualified key; new thread denied old board; direct/common ad-hoc messaging works |
| afe8acde-a11b-4689-ae7c-0f0e7292ecad (511) | 2026-11-27 15:04:44 | Teammate relays Claude reviewer project-context rejection; affected client version/trigger not independently verified |
| 73e3b4c9-89c3-40be-86af-8a4ef324c898 (514) | 2026-11-27 17:53:21 | Working Codex0.17.2 sender reports recipient-not-found and blocked observation for missing reviewer; sender-side evidence only |
| 12d69ebd-7c7d-4421-98a6-6d8b9ed5767b (515) | 2026-11-27 17:58:42 | Affected Claude author reports failures from about13:01UTC; client0.16.1/daemon0.17.2; exit/resume17:51 restores binding/client0.17.2 but new UUID/handle and Git-qualified project; old board denied |

Message515 explicitly labels changed derivation as an unverified hypothesis.
Its reported keys are `origin25` and `github.com/origin25-com/origin25`.
No original remote process/database capture was supplied. Subsequent diagnostic
request ec33a212-b94e-4a3b-b221-c5af7e616249 asks for exact cwd, original IDs,
key/remote changes and time, omitting secrets; it does not request resend.

## Maintainer task scope

In this chat on November27, after reviewing these problems, the user instructed:
"приступай к решению всех проблем и подготовке нового релиза" (start resolving
all the problems and preparing a new release). This records the work request,
not a peer authorization. Goals are reliable registration, safe recovery of old
project-board access, investigation of remaining availability failures, and
qualified release preparation. Existing production deployment constraints remain.


## Additional reports received during investigation

- `a27e5c67-3b5c-4409-b7aa-fcce830b8067` (516), Nov27 18:02:37UTC:
  reporter counted nine live seats in the central checkout (five short-key,
  four normalized-key), three separate component checkouts retained distinct
  keys. An injected undefined-then-remote reader in installed Projects0.17.2
  reproduced key drift; original Git miss remains unknown. Shared ad-hoc room
  and verified direct handles are the current mitigation. No migration attempted.
- `de4607b7-9bef-45e5-a1ae-1948d8b190ea` (517), Nov27 18:03:44UTC:
  reporter supplied old/new session pairs and same cwd, with re-registration
  around17:48 and17:51UTC. Both project boards now contain history that must
  survive. Historical remote/KOM_PROJECT changes remain unknown. These are
  reports from live/gone listings, not independently examined host process data.

An explicit future-registration project selection would restore access to the
selected board only; it must not be described as a merge of both board histories
or a migration of current seats. Any broader migration remains separate work.


Message `6cd6b377-4286-4279-8abf-811480a35ceb` (519), Nov27 18:08:16UTC,
reports a Marketing handoff with the exact same key at legacy version1 and
canonical version8, plus an Engineering handoff on the canonical board.
These are divergent histories, not an empty target. Neither last-write-wins
copy nor replacing either board is an acceptable preservation strategy.
This is remote testimony; both histories remain unmodified by this work.
