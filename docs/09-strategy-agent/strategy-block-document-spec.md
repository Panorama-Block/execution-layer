# Strategy Block Document Spec

## Overview

A Strategy Block is the normalized JSON document that defines a single DeFi strategy. It contains everything the Strategy Agent needs to match, propose, and execute a strategy for a user.

Strategy blocks are **static definitions** maintained by the team. The agent selects and parameterizes them at runtime based on user input.

## Schema

```json
{
  "strategy_id": "string (unique identifier, e.g. stable_yield_v1)",
  "strategy_name": "string (human-readable name)",
  "version": "string (semver, e.g. 1.0.0)",
  "user_intent_type": "enum: yield | staking | accumulation | liquidity | hedging",
  "description": "string (1-2 sentence summary)",

  "supported_profiles": ["conservative", "moderate", "aggressive"],
  "risk_level": "enum: low | moderate | high",
  "risk_factors": ["string (specific risks)"],

  "required_inputs": {
    "amount": { "type": "number", "description": "Capital to deploy (USD equivalent)" },
    "target_chain": { "type": "string", "description": "Chain to execute on" }
  },
  "optional_inputs": {
    "preferred_protocol": { "type": "string", "description": "User's preferred protocol" },
    "max_duration": { "type": "string", "description": "How long to hold position" },
    "slippage_tolerance": { "type": "number", "description": "Max slippage %" }
  },

  "execution_steps": [
    {
      "step": 1,
      "action": "enum: swap | supply | borrow | stake | unstake | addLiquidity | removeLiquidity",
      "service": "string (backend service name)",
      "endpoint": "string (API endpoint)",
      "protocol": "string (protocol name)",
      "params": {
        "description": "Step-specific parameters, templated with user input"
      },
      "depends_on": "number | null (step number this depends on)"
    }
  ],

  "protocols_used": ["string (protocol names)"],
  "chain_support": ["string (chain names)"],

  "estimated_outcomes": {
    "apy_range": "string (e.g. '3-5%')",
    "time_to_yield": "string (e.g. 'immediate')",
    "liquidity": "string (e.g. 'withdraw anytime')"
  },

  "warnings": ["string (user-facing warnings)"],
  "failure_conditions": ["string (conditions that would prevent execution)"],

  "educational_copy": "string (paragraph explaining the strategy in simple terms)",
  "learn_more_url": "string | null (link to detailed documentation)"
}
```

## Field Descriptions

### Identity
- **strategy_id**: Unique identifier used in code and API. Format: `snake_case_v{version}`.
- **strategy_name**: Display name shown to users.
- **version**: Semantic version. Bump when execution steps change.
- **user_intent_type**: The category of user goal this strategy addresses.
- **description**: Brief summary for strategy listings.

### Risk Profile
- **supported_profiles**: Which user risk profiles this strategy fits. Used by the matching algorithm.
- **risk_level**: Overall risk classification. Determines sorting and warnings.
- **risk_factors**: Specific risks. Displayed to user before confirmation.

### Inputs
- **required_inputs**: Must be collected before execution. Agent will ask for these.
- **optional_inputs**: Enhance execution but have sensible defaults.

### Execution
- **execution_steps**: Ordered list of actions. Each step maps to a backend service.
- **depends_on**: Enables step sequencing. Step 2 with `depends_on: 1` waits for step 1.

### Outcomes
- **estimated_outcomes**: Informational ranges based on current protocol data. Not guaranteed.
- **warnings**: Always shown to user. Non-negotiable transparency.
- **failure_conditions**: Checked before execution. If any are true, execution is blocked.

### Education
- **educational_copy**: Plain-language explanation. Helps users understand what they're doing.

## Example: Stable Yield v1

```json
{
  "strategy_id": "stable_yield_v1",
  "strategy_name": "Stable Yield",
  "version": "1.0.0",
  "user_intent_type": "yield",
  "description": "Earn yield by supplying stablecoins to a lending protocol.",

  "supported_profiles": ["conservative", "moderate"],
  "risk_level": "low",
  "risk_factors": [
    "Smart contract risk (protocol could be exploited)",
    "Variable APY (rates change based on utilization)",
    "Stablecoin depeg risk (USDC could lose peg)"
  ],

  "required_inputs": {
    "amount": { "type": "number", "description": "Amount of stablecoins to supply (USD)" },
    "target_chain": { "type": "string", "description": "Chain: avalanche" }
  },
  "optional_inputs": {
    "preferred_protocol": { "type": "string", "description": "Default: benqi" },
    "token": { "type": "string", "description": "Default: USDC" }
  },

  "execution_steps": [
    {
      "step": 1,
      "action": "supply",
      "service": "lending-service",
      "endpoint": "POST /lending/supply",
      "protocol": "benqi",
      "params": {
        "token": "{{token}}",
        "amount": "{{amount}}",
        "chain": "{{target_chain}}"
      },
      "depends_on": null
    }
  ],

  "protocols_used": ["benqi"],
  "chain_support": ["avalanche"],

  "estimated_outcomes": {
    "apy_range": "3-5%",
    "time_to_yield": "immediate (accrues per block)",
    "liquidity": "withdraw anytime (subject to utilization)"
  },

  "warnings": [
    "Smart contract risk: Benqi has been audited but exploits are always possible",
    "Variable APY: Current rates may change based on market conditions",
    "This is not financial advice"
  ],
  "failure_conditions": [
    "Insufficient stablecoin balance",
    "Protocol supply cap reached",
    "Protocol paused"
  ],

  "educational_copy": "This strategy supplies your stablecoins (like USDC) to Benqi, a lending protocol on Avalanche. Other users borrow these stablecoins and pay interest, which you earn as yield. Your funds can be withdrawn at any time, though rates may vary based on how much of the pool is being borrowed.",
  "learn_more_url": null
}
```

## Validation Rules

1. `strategy_id` must be unique across all strategy blocks
2. `execution_steps` must have sequential step numbers starting at 1
3. `depends_on` must reference a valid earlier step number or be null
4. `required_inputs` keys must appear in at least one step's params (as `{{key}}`)
5. `protocols_used` must match protocols referenced in execution_steps
6. `chain_support` must list all chains where this strategy can execute
7. `risk_level` must align with `supported_profiles` (low -> conservative, high -> aggressive)
