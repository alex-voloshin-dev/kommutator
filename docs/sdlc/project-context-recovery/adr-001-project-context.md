---
type: adr
feature: project-context-recovery
status: accepted
review_decision: proceed
date: 2026-11-27
---

# ADR 001: Preserve established context and explicitly select legacy projects

## Context

Git discovery failures fall back to caller project or cwd basename. Negative-cache eviction correctly permits later discovery, but the existing Claude owner check then rejects the newly inferred project. Existing records contain no derivation provenance. Project topics are reserved; membership follows authenticated registration, and board author/version/CAS history must remain intact. A legacy project key can represent deliberate intent, so lexical shape is not migration evidence.

The user's request supplies requirements without a PRD: repair registration, restore deliberate access to the old board, and prepare a qualified release. Storage stalls have separate unresolved evidence.

## Decision

Keep an exact established Claude owner's persisted project when cwd and ownership/lifecycle fences remain valid. Ignore inferred rediscovery for that owner, whether it follows transient recovery or deliberate Git initialization/origin editing; reject conflicting explicit context. Historical provenance cannot distinguish those cases. This is a deliberate DESIGN §19 policy change: intentionally changing an inferred project requires a new Claude OS owner or genuinely new conversation without an established record. New processes still resolve a project and pass unchanged strict predecessor-reuse checks. For EVERY Claude registration, including new owners, resolve the candidate and require EACH supplied caller and daemon project assertion to match it before any lifecycle, registry or outbox mutation. With no remote, the caller project still supplies fallback. This avoids accepting remote R/caller P on first registration and rejecting the identical refresh later. Newer generation retirement must not precede this validation. Ordinary unmapped Codex precedence remains unchanged; mapped new Codex roots reject explicit conflicts.

Offer CLI preview/apply/remove for a private versioned per-checkout selection containing exact absolute cwd, observed normalized Git origin and explicitly chosen project key. Preview returns an opaque revision over the complete exact-cwd record, with a distinct absence representation. Apply/remove require `--expect-revision`, freshly checked under the exclusive writer lock; changing only the remote while retaining the project key invalidates the preview. Preserve unrelated entries from that fresh file snapshot. Read through no-follow open and descriptor fstat validation; write through an exclusively created 0600 temporary file and atomic rename. Never automatically remove an apparently stale writer lock. Selection requires an existing checkout and Git verification; removal accepts its exact absolute lexical cwd and revision even after the checkout disappears, without Git verification. Load once at daemon startup. New mapped owners require fresh successful normalized origin equality and nonconflicting explicit caller context; otherwise reject. Existing owners remain unchanged, including across daemon restart. For Claude, a changed selected project takes effect for a new OS owner or a genuinely new conversation B with no established record, including B at an accepted newer generation in the same PID/birth. All generation/context fences and pre-mutation validation still apply. Existing A stays pinned even when resumed; a newer generation alone cannot retarget it. Differing predecessor projects mean a new seat. Those predecessor rules are Claude-specific. Codex keeps its root-keyed project across shim/process replacement and resume; selection requires a new independent root/thread with its own per-call metadata.

Use normal hub registration/membership to access the selected project's board. Add no MCP selector, reserved-topic join exception, alias, historical migration or database schema. The operator supplies the legacy key; the tool does not discover hidden boards or infer equivalence. See `tech-design.md` for validation bounds and acceptance criteria. Amend DESIGN §19 before implementation.

## Alternatives considered

- **Keep rejecting drift:** preserves strict equality but makes transient discovery changes break an otherwise valid same-process owner. Rejected.
- **Permanently cache missing remote:** masks the trigger but prevents genuinely new owners from seeing initialized/recovered repositories. Rejected.
- **Rewrite existing owner to recovered remote:** changes identity/membership interpretation and strands old board access; provenance is unknown. Rejected.
- **Use KOM_PROJECT as a global override:** changes precedence for all callers and does not bind operator intent to an observed repository. Rejected.
- **Automatically map basename to remote or copy boards:** cannot establish namespace equivalence; risks disclosure and corrupts author/CAS/history expectations. Rejected.
- **Add a hub alias or manual project join:** widens authority and recovery surface unnecessarily. Rejected.
- **Use only a live legacy seat through current management commands:** useful where that exact eligible seat exists, but does not restore future registration into the legacy project. Insufficient alone.
- **Persist provenance and rewrite old records:** useful for future diagnostics but cannot reconstruct historical intent; not necessary for this repair. Deferred.
- **Reload mapping on every hook:** faster operator activation but adds file I/O, concurrent configuration epochs and hot-path failure modes. Startup-only activation is simpler and bounded.

## Consequences

The demonstrated same-owner drift is repaired without weakening process identity. Legacy boards become accessible through deliberate new registration rather than migration. The mapping is local OS-user authority, not protection from a malicious same-user process; explicit scope reduces mistakes. Strict explicit-context checking intentionally rejects previously ignored stale Claude KOM_PROJECT/daemon values even on first registration. This is a compatibility tightening, not an inference about legacy provenance. Release notes must call out the breaking behavior and instruct removal of stale hints or correction to the resolved project. Internal and external design review approved this tightening and the final activation/removal clarifications. Include initial/repeated matching and conflicting raw-input controls and prove rejection cannot retire an earlier generation or mutate registry/outbox state.

Restart and new-owner activation are operational costs. Fresh Git failure blocks mapped new registrations rather than granting a stale selection. A new seat may receive a new handle and does not recover prior private messages or mutation observations. Board CAS, authorship, replay, receipts and history remain untouched. Peer report 519 describes divergent versions of the same Marketing handoff key in the two namespaces; neither version number determines a cross-namespace winner, and this recovery must not merge or overwrite either history. Storage availability and live acceptance gates remain open until independently observed.
