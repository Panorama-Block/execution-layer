# ADR 005 — Chain onboarding model

- **Status:** Accepted
- **Date:** 2026-05-22
- **Deciders:** Panorama-Block engineering
- **Related cards:** Panorama-Block/execution-layer#78

## Context

Today, chain identity is scattered through the codebase. The most visible offender is `backend/liquid-swap-service/src/application/services/provider-selector.service.ts:8`:

```typescript
const BASE_CHAIN_ID = 8453;
// ...
if (isSameChain && isBase) {
  providerPriority = ["aerodrome", "uniswap-trading-api", "uniswap", "thirdweb"];
}
```

The same magic number `8453` appears in execution-layer scripts, in mini-app feature configs, and in `zico_agents` prompts. Avalanche (`43114`) and Ethereum (`1`) repeat the pattern. The result is that adding a chain (or even verifying that Base is consistently configured across services) requires a global grep + 6 file edits + 4 deploys.

We also have no formal definition of "what does this chain support?". The fact that swap providers exist for Base is implicit — encoded in the if/else above and in adapter registrations. There is no machine-readable answer to "does PanoramaBlock support lending in Avalanche?".

ADR 002 introduces the Capability + Provider pattern but stays silent on chains. This ADR fills the gap: chains become a first-class entity with a manifest, owned by `backend/shared/capability/chains/`, and consumed everywhere chain identity matters.

## Decision

Each supported chain is described by a **manifest file** in `backend/shared/capability/chains/<slug>.manifest.json`. The shape is fixed; consumers read through a typed loader. No service hardcodes chain ID anywhere — they all go through `getChain(idOrSlug)`.

### Manifest shape

```typescript
interface ChainManifest {
  id: number;                      // 8453, 43114, 1
  slug: string;                    // 'base', 'avalanche', 'ethereum' (kebab-case)
  name: string;                    // 'Base', 'Avalanche', 'Ethereum'
  nativeAsset: {
    symbol: string;                // 'ETH', 'AVAX', 'ETH'
    decimals: number;              // 18
  };
  rpcDefaults: string[];           // public RPC URLs; never include keys
  blockExplorerUrl: string;        // 'https://basescan.org'
  capabilitiesSupported: CapabilitySlug[];  // ['swap', 'lending', 'liquidity']
}
```

### Concrete manifests for this sprint

Created in cards #211–#214 (Hugo). Slugs and capability sets are pinned here:

| Slug | id | Native | Supported capabilities |
|---|---|---|---|
| `base` | 8453 | ETH | swap, lending, liquidity |
| `avalanche` | 43114 | AVAX | swap, lending, liquidity, staking |
| `ethereum` | 1 | ETH | swap, staking |

Note `staking` is not in Base yet (Lido is Ethereum-only; cbETH stub via card #248 will add it later); `bridge` and `automation` are cross-chain and not declared per chain — they declare their own supported `from→to` matrix in the provider metadata.

### How a chain is added (the playbook)

1. **Open an ADR amendment** to this one, or a follow-up ADR for the new chain. Justify why this chain belongs in PanoramaBlock (TAM, user demand, capabilities expected).
2. **Create the manifest** `backend/shared/capability/chains/<slug>.manifest.json`. List `capabilitiesSupported` honestly — declare a capability only if at least one provider for that chain will exist by sprint end.
3. **For each capability supported on this chain**, ensure a provider adapter exists or open a card to add one. The adapter's `metadata.supportedChains` must include the new chain id, otherwise `registry.listByChain(newChainId)` returns empty.
4. **Update on-chain artifacts** if the capability needs them: deploy `PanoramaExecutorV2` and required adapters to the new chain (see `execution-layer/docs/templates/onboard-chain.md` from card #79). Record addresses in `execution-layer/deployments/<slug>/`.
5. **Add to the policy config** of each affected capability service: `backend/<service>/config/<cap>-priority.policy.json` gains a `"<newChainId>": [provider names ordered]` entry.
6. **Smoke-test** discovery: `GET /v1/capability/_discovery` should now return the new chain id with its providers and health.
7. **Communicate** in `#panorama-dev`: "🆕 Chain `<slug>` (id `<X>`) live with capabilities `[...]`. FE feature visibility will pick it up on next discovery refresh."

### Rules

1. **No `<chainId> as literal number` outside manifests.** Search `grep -r '\b(8453|43114|1|10|137|42161)\b'` periodically; hits in service code are violations and must be replaced with `getChain('base').id`.
2. **Slug, not number.** Inter-service references use slugs (`'base'`, `'avalanche'`). Numbers are used only when an external SDK (ethers, viem) requires them; convert at the call site.
3. **Capability claims must be honest.** Listing `staking` for Base while no Base staking provider exists is a bug. The `BaseStakingProviderAdapter` stub in card #248 is registered with `metadata.enabled = false` precisely to avoid this — stubs don't count.
4. **RPC defaults are public only.** `rpcDefaults` contains URLs anyone can use (e.g., `https://base.publicnode.com`). Per-tenant or paid RPCs come from env vars at runtime, not from the manifest.
5. **Native asset is canonical.** When a capability needs to refer to "the chain's native asset", it goes through the manifest, not a per-service constant.

## Consequences

### Positive

- Adding a chain becomes a 1-PR change (new manifest + adapter `supportedChains` updates) instead of a hunt across 6 files.
- "Does PanoramaBlock support X on chain Y?" has a single answer: `getChain(Y).capabilitiesSupported.includes(X)`.
- The FE discovery endpoint can enumerate chains from `loadChains()` rather than from a hardcoded set.
- Cross-chain features (bridge, future cross-chain swaps) can iterate manifests instead of maintaining a separate chain registry.

### Negative

- The first migration cost: every existing site with `8453` / `43114` / `1` literal must be replaced. Tracked in the audit notes of card #212 (Base manifest) — Rizzi will get a follow-up issue listing the call sites in `liquid-swap-service`.
- The manifest is now a runtime artifact. A bad commit (e.g., wrong RPC URL) can affect all services that read it. Mitigation: manifests live with shared/capability and PRs that touch them require Hugo's approval.
- Some services don't care about chains (auth-service is chain-agnostic for now). They simply don't import `getChain`. That's fine.

### Neutral

- The on-chain side has its own per-chain registry (`execution-layer/deployments/<slug>/`). The backend manifest and the on-chain registry are two different artifacts with overlapping purpose. Keeping them in sync is procedural — handled by the onboarding playbook above — not enforced by tooling in this sprint.

## Out of scope (for this ADR)

- Per-chain feature flags beyond the `capabilitiesSupported` array. If we need finer control ("Avalanche supports lending but only for AVAX collateral"), that's a per-provider concern (`provider.metadata.features`), not a chain concern.
- Testnet manifests. This sprint targets mainnets; testnet manifests can be added without amending this ADR as long as they follow the same shape.
- Chain reorg handling and reorg-safe transactions. Provider responsibility, not chain manifest.

## References

- ADR 001 (backend-first architecture)
- ADR 002 (capability-provider abstraction) — defines `CapabilitySlug` used in `capabilitiesSupported`
- ADR 004 (layer dependency rules) — chains module lives in `shared/capability/chains/`, a layer-0 module
- `SPRINT_HUGO.md` cards #211–#214 (manifest types + the 3 chain files)
- `SPRINT_HUGO.md` cards #81–#86 (smart-contract deploy on Base mainnet, the first on-chain side of the chain registry)
- `SPRINT_COLETTO.md` card #79 (`execution-layer/docs/templates/onboard-chain.md`) — the playbook step 4 documented end-to-end
- Existing anti-pattern site: `backend/liquid-swap-service/src/application/services/provider-selector.service.ts:8` (`const BASE_CHAIN_ID = 8453`)
