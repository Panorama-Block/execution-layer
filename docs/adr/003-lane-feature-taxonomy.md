# ADR 003 — Lane and Feature taxonomy

- **Status:** Accepted
- **Date:** 2026-05-22
- **Deciders:** Panorama-Block engineering
- **Related cards:** Panorama-Block/execution-layer#76

## Context

The PanoramaBlock Planning board ([project #1](https://github.com/orgs/Panorama-Block/projects/1)) uses two custom fields to organise the 106-card sprint backlog: **Lane** and **Feature**. They look interchangeable but answer different questions:

- **Lane** = the *subsystem* a card lives in. Stable, low-cardinality, dev-owned. Example: `Swap Capability`.
- **Feature** = the *kind of work* within a lane. Higher-cardinality, evolves per sprint. Example: `Capability API`, `Providers`.

This pairing is what makes the board readable across 4 devs. But the values currently live only as free-form strings on each card — anyone with edit rights can rename them, and a stray rename breaks every saved view and report. This ADR pins the vocabulary.

## Decision

### Lanes are a closed set of 18

Each lane has exactly one owner. Adding or renaming a lane requires a new ADR. The current set:

| Lane | Owner | Scope |
|---|---|---|
| Platform Foundation | Hugo | `backend/shared/capability/*` + exec-layer ADRs |
| Provider Platform | Hugo | Registry, policy, chain onboarding |
| Staking Capability | Hugo | `backend/lido-service/*` |
| Identity and Session | Marcos (BE) / Coletto (telegram bridge) | `backend/auth-service/*` + `telegram/.../telegram-auth.ts` |
| Swap Capability | Rizzi | `backend/liquid-swap-service/*` |
| Liquidity Capability | Rizzi | `backend/liquidity-service/*` (NEW) |
| Lending Capability | Marcos | `backend/lending-service/*` |
| Automation and DCA | Marcos | `backend/dca-service/*` |
| Bridge Capability | Coletto | `backend/bridge-service/*` |
| Monitoring and Status | Coletto | `backend/monitoring-service/*` (NEW) |
| Portfolio and State | Coletto | `backend/portfolio-service/*` (NEW) |
| Execution Layer Contracts | Hugo | `execution-layer/contracts/*` + deploy scripts |
| Execution Planning | Marcos | Multi-step plan building (lives inside `dca-service`) |
| Gateway and BFF Adapter | Coletto | `telegram/apps/gateway/*` |
| Telegram Adapter | Coletto | Bot commands + deep-link |
| Web and MiniApp Adapter | Marcos + Rizzi | `telegram/apps/miniapp/src/{shared/lib,features}/*` |
| Agent Adapter | Rizzi | `zico_agents/new_zico/src/agents/*` |
| Quality and Delivery | Coletto | Sprint reports, audit, test infrastructure |

### Features evolve per sprint; current set is open

A feature describes the *kind* of work inside a lane. Different lanes can share feature names — both `Swap Capability` and `Lending Capability` have a `Capability API` feature. That's intentional: same template of work across lanes.

Current feature set in this sprint (no per-feature ownership — owner comes from the lane):

| Feature | Appears in lanes | Meaning |
|---|---|---|
| Capability API | Swap, Lending, Staking, Liquidity, Bridge | Port, facade, endpoint namespace (~3 cards) |
| Providers | Swap, Lending, Staking, Liquidity, Bridge | Wrap protocols as providers + conformance tests (~3 cards) |
| Capability Contracts | Platform Foundation | Envelope, errors, provider metadata, availability schema |
| Provider Registry | Provider Platform | Registry, policy, health, loader, conformance helper, discovery |
| Chain Onboarding | Provider Platform | Manifests for Base, Avax, Eth |
| Auth Capability | Identity and Session | Doc, facade, types, smoke tests |
| Automation Capability | Automation and DCA | DCA-flavoured capability service |
| Execution Capability | Execution Planning | Multi-step plan builder, validation |
| Architecture Guardrails | Platform Foundation (exec-layer) | The 5 ADRs you're reading |
| Execution Substrate | Execution Layer Contracts | Deploy + register adapters on-chain |
| Adapter Surface | Gateway and BFF Adapter | Gateway facade, proxy, discovery route |
| Telegram Integration | Telegram Adapter | Bot commands, deep-links |
| Web Integration | Web and MiniApp Adapter | `capabilityClient`, discovery, visibility |
| Intent Translation | Agent Adapter | Agents → capability vocabulary, intent schemas |
| Monitoring Capability | Monitoring and Status | Health aggregator, status endpoints |
| Portfolio Capability | Portfolio and State | Cross-capability aggregation |
| Testing and Visibility | Quality and Delivery | Status report templates, sprint mapping |
| Chain Onboarding | Provider Platform (exec-layer) | Template for adding a chain to the exec-layer side |

### Rules

1. **Lane is closed.** Adding/removing/renaming a lane requires an ADR amendment to this one. A PR labelled with a non-existent lane on its card is invalid.
2. **Feature is open but tracked.** A new feature value can be introduced by any dev, but must be added as a comment on the card (`feature: <new-name>`) and added to a tracking issue (`Panorama-Block/panorama-block#FEATURE_REGISTRY`, to be opened by Coletto in the sprint #87/#88 quality work).
3. **One card belongs to exactly one lane and one feature.** Cross-cutting work is split into multiple cards.
4. **Lane ownership is inherited by the cards.** When the board moves a card to "In Progress", the assignee is the lane owner unless explicitly overridden (which itself requires a comment justifying the cross-team work).
5. **Feature ownership = lane ownership.** Features are organisational, not allocative.

## Consequences

### Positive

- Saved views ("My Lane: Swap Capability", "Feature: Providers") become stable across sprints.
- Status reports group naturally: "this sprint shipped X cards in Capability API across 5 lanes".
- A new dev joining the team can read the lane table and immediately know whom to ping.
- Renames stop being a vector for silent breakage of dashboards.

### Negative

- Some real work is cross-lane (e.g., `auth` touches both `Identity and Session` backend and `Identity and Session` telegram). The rule "one card = one lane" forces this into two cards. That's the cost of clarity.
- Lane closure adds friction when product asks for a brand-new domain (e.g., `Insurance Capability`). The friction is intentional: the cost is one ADR, which forces alignment.

### Neutral

- The taxonomy is observable but not enforced by tooling today. Enforcement (e.g., GitHub Action that rejects card edits with unknown lane) is a future improvement; for now, code review enforces it informally during card grooming.

## References

- ADR 002 (capability-provider abstraction) — defines the capability slugs that map 1-to-1 to most lanes
- `SPRINT_KICKOFF.md` § 8 (Divisão por dev) — the same lane→owner mapping operationalised
- [PanoramaBlock Planning board](https://github.com/orgs/Panorama-Block/projects/1)
- Sprint card #87 (feature status report template — Coletto) — will produce the per-sprint snapshot of this taxonomy
