---
type: review
target: docs/sdlc/reconnect-authority/tech-design.md
iteration: 2
verdict: approve
findings: []
---

# Technical design review — round 2

Artifact: `tech-design.md`. Both the internal and external lenses returned **approve**, as reported by the parent orchestrator. This records their aggregated result, not a claim that the architect independently ran either reviewer.

Round 1's shared major finding was unsafe same-live-PID migration with old lifecycle hooks. The revised design rejects that migration, requires complete hook/MCP upgrade before a new OS process, and permits history adoption only with positive old-PID exit. The external lens's manual-hook finding is resolved by retaining direct generation-zero registration. Its SessionEnd finding is resolved by limiting the fence guarantee to authority captured before a delayed completion and retaining pre-capture A → B → A ambiguity explicitly.

The external round-2 minor requested an exact compatibility field and enforcement scope. Source verification of `packages/protocol/src/hello.ts` confirmed no such field exists today, and `owner_generation` is optional. The design now specifies additive `runtime_contract`, exact accepted value 4, and daemon rejection of missing/unsupported values for Claude hook/shim bindings, including manual hooks without generations. CLI management and non-Claude bindings retain existing rules. This is a proposed implementation contract; no runtime schema was edited by this architecture task.

Evidence was updated from the companion reproduction record: the invalid stale-0.12.3 qualification remains disclosed; verified retained 0.14.0 authority controls establish both delayed-ps and delayed-link failures. Current-source isolated startup and shutdown-close controls establish separate defects. None establishes the reporter's exact live trigger or closes vendor/platform acceptance gates.

The architecture handoff schema read-back passes. `af.py review-decision --verdict approve --iteration 2 --gate-green yes` returned `proceed`; the design now records that decision. Parent-relayed feedback about lost membership is covered explicitly by the existing history-preservation requirement: safe unique-owner adoption retains topic memberships, while ambiguous/unrelated owners never inherit subscriptions. Implementation, behavior tests and release qualification remain subsequent work. Synchronous blocked I/O, pre-capture vendor ambiguity, unsupported mixed lifecycle hooks/hot downgrade and unexecuted platforms remain explicit limits.
