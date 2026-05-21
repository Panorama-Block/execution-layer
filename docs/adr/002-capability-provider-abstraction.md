# ADR 002 — Capability + Provider abstraction

- **Status:** Accepted
- **Date:** 2026-05-22
- **Deciders:** Panorama-Block engineering
- **Related cards:** Panorama-Block/execution-layer#75
- **Supersedes:** —

## Context

ADR 001 commits to keeping protocol names inside the backend. This ADR specifies the **mechanism** that makes that possible. Without a concrete pattern, "protocol-agnostic FE" decays back into special cases the first time a protocol behaves differently.

The pattern already exists, partially, in `backend/liquid-swap-service/`: a domain port `ISwapProvider`, multiple adapters (Uniswap, Thirdweb, Aerodrome, Multihop), and an application service `ProviderSelectorService` that picks one based on chain. The same shape should hold for lending, staking, liquidity, bridge, and automation.

This ADR generalizes that shape and locks the vocabulary.

## Decision

The backend organizes every protocol-touching feature into three concentric layers:

1. **Capability** — a verb-shaped business action, identified by a slug from a closed set. Today: `swap`, `lending`, `staking`, `liquidity`, `bridge`, `automation`. New capabilities require an ADR.
2. **Provider** — a concrete implementation of one capability, identified by a string name (e.g. `uniswap`, `lido`, `benqi`). Multiple providers can serve the same capability. New providers require only a code change, never an ADR.
3. **Registry + Policy** — `shared/capability/` owns the generic registry that holds providers, plus a policy that ranks them per request (by chain, asset, health).

### Vocabulary (canonical)

| Term | Definition | Lives in |
|---|---|---|
| **Capability** | A verb-shaped backend ability (`swap`, `lending`, …) exposed at `/v1/capability/<slug>/...`. | `backend/<service>/src/application/services/<cap>.capability.service.ts` |
| **Provider** | A class that implements `I<Cap>Provider`; talks to one external protocol. | `backend/<service>/src/infrastructure/adapters/<provider>.adapter.ts` |
| **Port** | The interface that every provider of a capability must implement. Lives in domain. | `backend/<service>/src/domain/ports/<cap>.provider.port.ts` |
| **Registry** | Generic container that holds providers and answers `listByChain`, `getByName`. | `backend/shared/capability/registry.ts` |
| **Policy** | Strategy that orders providers for a given request (priority list per chain). | `backend/shared/capability/policy.ts` |
| **Adapter** | Same as Provider — the term "adapter" is used when emphasising the hex architecture role; "provider" when emphasising the business role. | `backend/<service>/src/infrastructure/adapters/` |
| **Envelope** | `CapabilityRequest<T>` / `CapabilityResponse<T>` — the request/response shape every capability speaks. | `backend/shared/capability/envelope.types.ts` |
| **Facade** | The application-layer service that orchestrates registry + policy + selected provider per request. Same as the capability service. | `backend/<service>/src/application/services/<cap>.capability.service.ts` |

### Five-layer pattern per capability

Each capability follows this exact shape:

```
┌────────────────────────────────────────────────────────────────┐
│ Layer 1 — DOMAIN PORT                                          │
│   <service>/src/domain/ports/<cap>.provider.port.ts            │
│   interface I<Cap>Provider extends ICapabilityProvider { ... } │
├────────────────────────────────────────────────────────────────┤
│ Layer 2 — INFRASTRUCTURE ADAPTER                               │
│   <service>/src/infrastructure/adapters/<provider>.adapter.ts  │
│   class <Provider>Adapter implements I<Cap>Provider { ... }    │
├────────────────────────────────────────────────────────────────┤
│ Layer 3 — APPLICATION FACADE                                   │
│   <service>/src/application/services/<cap>.capability.service  │
│   class <Cap>CapabilityService(registry, policy) { ... }       │
├────────────────────────────────────────────────────────────────┤
│ Layer 4 — HTTP CONTROLLER + ROUTES                             │
│   <service>/src/infrastructure/http/controllers/<cap>.*.ts     │
│   app.<method>('/v1/capability/<slug>/<action>', controller)   │
├────────────────────────────────────────────────────────────────┤
│ Layer 5 — DI / COMPOSITION ROOT                                │
│   <service>/src/infrastructure/di/container.ts                 │
│   registry.register(new <Provider>Adapter(...))                │
└────────────────────────────────────────────────────────────────┘
```

### Reference snippet (illustrative — actual types defined in cards #200, #204 of the sprint)

```typescript
// Layer 1 — port
import { ICapabilityProvider } from "@panorama/shared/capability";

export interface IStakingProvider extends ICapabilityProvider {
  getPosition(userAddress: string, chainId: number): Promise<StakingPosition>;
  prepareStake(req: PrepareStakeRequest): Promise<Transaction[]>;
  // ...
}

// Layer 2 — adapter
export class LidoProviderAdapter implements IStakingProvider {
  readonly name = "lido";
  readonly metadata = {
    name: "lido",
    capability: "staking" as const,
    supportedChains: [1],
    features: ["stETH"],
    version: "1.0.0",
  };
  async getPosition(addr, chainId) { /* call Lido SDK */ }
  async prepareStake(req)          { /* build tx via Lido contract */ }
}

// Layer 3 — facade
export class StakingCapabilityService {
  constructor(
    private registry: ProviderRegistry<IStakingProvider>,
    private policy: IPriorityPolicy
  ) {}
  async prepareStake(req: CapabilityRequest<PrepareStakeInput>) {
    const candidates = this.registry.listByChain(req.chainId, "staking");
    const ranked = this.policy.rank(candidates, req);
    for (const p of ranked) {
      if (await p.supportsRoute(req)) return p.prepareStake(req.payload);
    }
    throw CapabilityError.unsupportedRoute({ attempted: ranked.map(p => p.name) });
  }
}

// Layer 5 — DI
const registry = new ProviderRegistry<IStakingProvider>();
registry.register(new LidoProviderAdapter(/* deps */));
registry.register(new BaseStakingProviderAdapter(/* stub */));
const policy = new ChainAssetPriorityPolicy(loadJson("config/staking-priority.json"));
const facade = new StakingCapabilityService(registry, policy);
```

### Invariants

These hold **without exception**. A PR that violates any one is rejected.

1. **Domain does not import from application or infrastructure.** Ports are pure interfaces.
2. **Adapters do not import from other services.** Adapters use the port of their own capability + types from `shared/capability/`. No `import { … } from '../../../other-service'`.
3. **The facade does not know any adapter by name.** It only knows the port and the registry.
4. **The controller has no business logic.** It only parses input, calls the facade, wraps the response. Anything more belongs in the facade.
5. **The DI container is the only place that does `new <Concrete>Adapter()`.** This keeps tests free to inject fakes.
6. **Provider name is observability metadata, not control flow.** Neither FE nor agents may branch on `response.provider.name`. (FE may *display* it; that's fine.)
7. **The envelope is mandatory at the public surface.** Every `/v1/capability/<slug>/<action>` request and response uses `CapabilityRequest<T>` / `CapabilityResponse<T>` from `shared/capability/`.

### Discovery

A consequence of this pattern is that the system can introspect itself. `GET /v1/capability/_discovery` returns:

```json
{
  "capabilities": [
    {
      "slug": "swap",
      "byChain": {
        "8453": [
          { "provider": "aerodrome", "healthy": true, "latencyP95Ms": 120 },
          { "provider": "uniswap-trading-api", "healthy": true, "latencyP95Ms": 240 }
        ],
        "1": [...]
      }
    }
  ],
  "generatedAt": "2026-05-22T14:00:00Z",
  "cacheTtlSeconds": 30
}
```

The FE consumes this to drive feature visibility (cf. SPRINT_MARCOS.md #196). The discovery endpoint is load-bearing under ADR 001 §"Discovery becomes load-bearing": if it goes down, the FE may either over-restrict (safe degradation) or fail open (configurable, default: over-restrict).

## Consequences

### Positive

- One mental model for all six capabilities — reading one capability service is enough to understand the others.
- New providers ship behind feature flags via `metadata.enabled = false` until ready (`BaseStakingProviderAdapter` stub in card #248 is the example).
- Conformance tests (card #210) reuse a shared helper, so adapter quality is uniform across the system.
- Health degradation is graceful: an unhealthy provider drops out of `listByChain` automatically; the facade keeps serving via the next one. No 500s when a single provider hiccups.

### Negative

- Boilerplate per capability: ~5 files for a feature that today might be a single route handler. The win is amortised over the second provider in that capability.
- The capability slug set is closed by ADR. Opening it (e.g., adding `derivatives`) costs an ADR. This is intentional friction — capabilities are a vocabulary, not a free-form tag.
- The policy file becomes a runtime config artifact that operations must care about. A bad policy commit can starve a healthy provider. Mitigation: policies live in `config/<cap>-priority.policy.json` next to the service, reviewed on the same PR as adapter changes.

### Neutral

- "Adapter" vs "provider" is a deliberate doublet. The hex-architecture-flavoured PRs call them adapters; the product-flavoured PRs call them providers. Both terms refer to the same class. The glossary above pins this.

## Out of scope (for this ADR)

- Storage strategy per service (each service owns its DB; covered by current `database` gateway conventions in `backend/database/README.md`).
- Smart-contract layer abstractions (covered separately in ADR 005 for chain onboarding, and in the on-chain `IProtocolAdapter` interface inside the contracts repo).
- Per-tenant feature gating beyond the discovery healthy/unhealthy bit.

## References

- ADR 001 (backend-first architecture) — the principle this ADR implements
- ADR 004 (layer dependency rules) — the import graph this pattern requires
- `SPRINT_KICKOFF.md` § 3–5 (capability pattern, registry deep-dive, anatomy of a request)
- Sprint cards that implement this ADR:
  - `panoramablock-backend#199–#203` (envelope, errors, provider metadata, availability — Hugo)
  - `panoramablock-backend#204–#210` (registry, policy, health, discovery, conformance — Hugo)
- Current reference implementation (partial): `backend/liquid-swap-service/src/domain/ports/swap.provider.port.ts`, `backend/liquid-swap-service/src/application/services/provider-selector.service.ts`
