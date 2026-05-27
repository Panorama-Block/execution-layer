# ADR 006 — Execution Planning

## Context

Users and agents need to compose multi-step DeFi operations: "swap ETH→USDC then add liquidity" or "unstake stETH, swap to USDC, supply to lending". Each step maps to a capability action that produces `Transaction[]` for client-side signing.

Without a plan abstraction, the FE/agent must hardcode step ordering and dependency logic. This breaks when capabilities change or new chains are added.

## Decision

A typed `ExecutionPlan` lives in `backend/src/domain/execution-planning/`:

- **`ExecutionStep`** — one capability action with `dependsOn` references to prior steps
- **`buildExecutionPlan`** — constructs a plan from user input, assigns sequential step IDs
- **`validateExecutionPlan`** — checks capability slugs, broken dependency refs, circular deps
- **`topologicalOrder`** — Kahn's algorithm producing a safe execution sequence

The plan is **data-only** — it does not call backends or sign transactions. The caller (FE, agent, or a future orchestrator service) walks the topological order, calls each capability endpoint, collects `Transaction[]`, and presents them for signing.

## Consequences

- Agents emit `ExecutionPlan` instead of raw API calls — the plan is auditable before execution
- New capabilities are supported by adding steps; no orchestrator code changes
- Circular or broken dependency graphs are caught at validation time, not at execution time
- The plan builder is tested with 10 unit tests covering build, validate, and topological sort

## References

- `backend/src/domain/execution-planning/plan.types.ts` — type definitions
- `backend/src/domain/execution-planning/plan-builder.ts` — builder + validator + topo sort
- ADR 002 — Capability + Provider abstraction (the actions each step invokes)
