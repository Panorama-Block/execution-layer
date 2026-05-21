# ADR 001 — Backend-first architecture

- **Status:** Accepted
- **Date:** 2026-05-22
- **Deciders:** Panorama-Block engineering (Hugo, Coletto, Rizzi, Marcos)
- **Related cards:** Panorama-Block/execution-layer#74
- **Supersedes:** —
- **Superseded by:** —

## Context

PanoramaBlock has grown into a polylithic system: 6 backend microservices, a smart-contract layer (Base + Avax), a Telegram mini-app + bot, and an LLM agent stack. Historically each surface exposed protocol-specific behaviour:

- `liquid-swap-service` knows about Uniswap, Thirdweb-bridge, Aerodrome by name.
- `lending-service` legacy code embeds Benqi paths.
- The mini-app rewrites `/api/lending/benqi/*` to bypass a service that is about to be removed (cf. `REFACTOR_PLAN.md` Phase 4).
- The Zico agents mention protocols literally in prompts (`"swap on uniswap"`), and break when a protocol is replaced.

That drift made it expensive to add or replace any protocol: a new lending market touched 4–6 layers (backend service, agent prompts, mini-app feature, gateway proxy, Telegram bot command), with no single owner of the contract.

This sprint introduces a **Capability + Provider** abstraction (see ADR 002) that makes "protocol" an implementation detail of the backend. To make that work as a long-lived guarantee — not just a refactor that decays — we need to commit to a directional principle: **the backend is the only place that knows protocol names; everything outside the backend speaks only the capability vocabulary.**

## Decision

The backend is the source of truth for the system architecture. The principle has three concrete commitments:

1. **Protocol names live only inside backend adapters.** No frontend code, agent prompt, gateway route, bot command, or smart-contract metadata may mention `uniswap`, `lido`, `benqi`, `aerodrome`, `moonwell`, `traderjoe`, etc., except inside `backend/<service>/src/infrastructure/adapters/`. Agents and mini-app see only `capability` slugs (`swap`, `lending`, `staking`, `liquidity`, `bridge`, `automation`).

2. **No edge layer rewrites a protocol-specific URL.** Constructs like the current `/api/lending/benqi/*` rewrite in `telegram/apps/miniapp/next.config.ts` are forbidden going forward. The mini-app calls `/v1/capability/<slug>/*` via the gateway; the gateway proxies to the backend service that hosts that capability. Provider selection happens inside the backend, never at the edge.

3. **New protocols arrive as backend changes only.** Adding Moonwell lending or Trader Joe LP must be doable by registering a new provider in the existing capability service — without touching FE, agents, or bot. If a protocol cannot be added that way, the abstraction is broken and must be fixed before the protocol ships.

## Consequences

### Positive

- Onboarding a new protocol becomes a 1-PR change (a new adapter + a config entry), not a 4-repo coordinated change.
- The FE bundle does not regress when a protocol is added or replaced — no rebuild required for a provider swap.
- Agents stay coherent across protocol turnover: replacing Benqi with Aave does not retrain the prompt.
- Single owner for protocol behaviour (backend) ⇒ single place to apply security review, rate limiting, observability.
- The `REFACTOR_PLAN.md` Phase 4 (delete `lending-service`, `avax-service`, `diagram-service`) becomes safe because consumers have migrated to capability endpoints.

### Negative

- Cleanup cost is front-loaded: existing protocol-mentioning code in FE, agents, and edge config must be migrated before this principle is enforceable.
- Slightly longer indirection on a hot-path request (FE → gateway → backend → registry → policy → adapter → SDK). The end-to-end latency budget should track this; if a capability's p95 regresses past +20 ms, that's a signal to re-examine the policy implementation, not to bypass the abstraction.
- Discovery becomes load-bearing: if `/v1/capability/_discovery` is down or stale, the FE either over-restricts the UI or shows a broken option. Discovery requires its own SLA (cf. ADR 002 §"Discovery").

### Neutral

- Smart contracts may still reference protocol-specific adapter contracts on-chain (e.g. `AerodromeAdapterV2.sol`). On-chain registration is done by the backend deploy script (see SPRINT_HUGO.md Bloco 6), but the on-chain layer remains protocol-aware by necessity. The principle applies above the contract layer, not at it.

## Enforcement

- **Code review:** any PR that introduces a protocol name in FE, agents, gateway, or bot must be rejected with a link to this ADR.
- **Static check (future):** add a lint rule that fails on the grep set `(uniswap|lido|benqi|aerodrome|moonwell|traderjoe|thirdweb|tac)` outside `backend/*/src/infrastructure/adapters/`. Tracked as a follow-up in `REFACTOR_PLAN.md`.
- **Architecture review:** quarterly, audit a sample of capability endpoints to verify FE and agents are not branching on `response.provider.name` for business logic. Provider name is observability-only.

## References

- `SPRINT_KICKOFF.md` § 1 (Why this refactor), § 2 (System view: today vs target)
- `REFACTOR_PLAN.md` Phase 4 (legacy service deletion)
- ADR 002 (capability-provider abstraction) — the mechanism this principle commits to
- ADR 004 (layer dependency rules) — the imports this principle forbids
- Current anti-pattern site: `telegram/apps/miniapp/next.config.ts` rewrite of `/api/lending/benqi/*`
- Current anti-pattern site: `backend/liquid-swap-service/src/application/services/provider-selector.service.ts:179-196` (hardcoded `BASE_CHAIN_ID`-keyed if/else)
