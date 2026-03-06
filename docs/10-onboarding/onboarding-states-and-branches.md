# Onboarding States and Branches

## State Machine

```
[New User] --visit--> [Visited]
[Visited] --connect wallet--> [Wallet Connected]
[Wallet Connected] --has balance--> [Wallet Funded]
[Wallet Connected] --no balance--> [Wallet Unfunded]
[Wallet Funded] --complete action--> [First Action Done]
[First Action Done] = [Onboarded]

At any point:
[Any State] --dismiss--> [Onboarding Dismissed]
```

## State Fields

```typescript
interface OnboardingState {
  hasVisited: boolean;          // User has opened the app at least once
  walletConnected: boolean;     // A wallet is linked to the account
  walletType: 'thirdweb' | 'external' | 'ton' | null;
  walletFunded: boolean;        // Wallet has non-zero balance on any supported chain
  firstActionCompleted: boolean; // At least one DeFi transaction confirmed
  firstActionType: string | null; // 'swap' | 'stake' | 'supply' | etc.
  onboardingDismissed: boolean; // User explicitly skipped onboarding
  onboardingStep: number;       // Current step in onboarding flow (1-4)
  tooltipsShown: string[];      // List of tooltip IDs already displayed
  entryPoint: string;           // 'site' | 'telegram' | 'miniapp' | 'deeplink'
  referralSource: string | null; // How user found PanoramaBlock
}
```

## User Type Branches

### Branch 1: First-Time User (Full Onboarding)

**Detection**: `hasVisited === false`

**Flow**:
1. Show welcome overlay (Block 1: What is PanoramaBlock)
2. Show how it works (Block 2)
3. Prompt wallet connection (Block 3)
4. Suggest first action (Block 4)
5. Mark onboarded

**Platform Variations**:
- **Site**: Full overlay with progress indicator
- **Telegram**: Welcome message + inline buttons
- **MiniApp**: Step-by-step overlay

### Branch 2: Returning User (Skip to Dashboard)

**Detection**: `firstActionCompleted === true`

**Flow**:
1. Skip onboarding entirely
2. Show dashboard / chat interface
3. No overlays, no tooltips (unless new feature)

### Branch 3: Guest User (Browse Without Wallet)

**Detection**: `hasVisited === true && walletConnected === false && onboardingDismissed === true`

**Flow**:
1. Allow browsing (view pools, prices, strategies)
2. Show persistent "Connect Wallet" CTA (non-intrusive banner)
3. Block execution actions with "Connect wallet to continue" prompt

**Available Features**:
- View pool data and APYs
- Chat with agent (informational only)
- View strategy recommendations
- Cannot execute any transactions

### Branch 4: Wallet Connected, Unfunded

**Detection**: `walletConnected === true && walletFunded === false`

**Flow**:
1. Show funding guide overlay
2. Options: Bridge, buy with fiat, receive from another wallet
3. Display wallet address + QR code for receiving
4. Poll balance periodically, auto-dismiss when funded

**Messaging**:
```
Your wallet is connected! To start using DeFi, you'll need some tokens.

Here's how to add funds:
1. Bridge from another chain [Bridge]
2. Buy with card [Buy Crypto]
3. Receive from a friend [Show Address]
```

### Branch 5: TON User

**Detection**: `walletType === 'ton'`

**Flow**:
1. Show TON-specific welcome
2. Explain available TON-chain actions
3. Offer EVM wallet connection for multi-chain access

**Messaging**:
```
Welcome! You're connected with a TON wallet.

You can use TON-chain features. For actions on Base, Ethereum,
or Avalanche, you'll also need an EVM wallet.

[Add EVM Wallet]  [Continue with TON]
```

**Limitations to communicate**:
- Most strategies require EVM chains
- Swap options limited to TON DEXes
- Staking limited to TON staking

### Branch 6: Chat-Triggered User (Deep Link from Agent)

**Detection**: `entryPoint === 'deeplink' && deepLinkParams.action !== null`

**Flow**:
1. Skip general onboarding
2. If no wallet: show wallet connection (contextual: "Connect wallet to complete this swap")
3. If wallet ready: go directly to pre-filled action
4. After action: suggest exploring more features

**Example**: User chatted "swap 0.01 ETH to USDC", agent sent deep link to MiniApp:
```
URL: miniapp.panoramablock.com?action=swap&tokenIn=ETH&tokenOut=USDC&amount=0.01

1. Parse params from URL
2. Check wallet -> connected? -> funded?
3. Show pre-filled swap page
4. User confirms and signs
5. After success: "Want to explore more? [Dashboard] [Chat More]"
```

## Transition Logic

### State Transitions

```typescript
function getOnboardingFlow(state: OnboardingState): OnboardingFlow {
  // Already onboarded
  if (state.firstActionCompleted) return 'none';

  // Dismissed onboarding
  if (state.onboardingDismissed && !state.walletConnected) return 'guest_banner';
  if (state.onboardingDismissed && state.walletConnected) return 'nudge_first_action';

  // Deep link with action
  if (state.entryPoint === 'deeplink') return 'contextual';

  // TON wallet
  if (state.walletType === 'ton') return 'ton_specific';

  // Wallet connected but unfunded
  if (state.walletConnected && !state.walletFunded) return 'funding_guide';

  // Wallet connected and funded
  if (state.walletConnected && state.walletFunded) return 'first_action';

  // New user
  if (!state.hasVisited) return 'full_onboarding';

  // Visited but no wallet
  return 'wallet_prompt';
}
```

### Step Progression

```
Step 1: Welcome + Explainer
  -> "Next" button or auto-advance after 5s

Step 2: Connect Wallet
  -> Advances automatically when wallet connected
  -> "Skip" sends to guest mode

Step 3: Fund Wallet (conditional)
  -> Only shown if balance is 0
  -> Advances automatically when balance detected
  -> "Skip" allows browsing without funds

Step 4: First Action
  -> Pre-filled swap or contextual action
  -> Advances when transaction confirmed
  -> "Skip" completes onboarding without action
```

## Edge Cases

| Scenario | Handling |
|----------|----------|
| User disconnects wallet mid-onboarding | Reset to step 2, preserve other state |
| User switches wallet | Re-check balance, may need to re-fund |
| MiniApp closed mid-onboarding | Resume at last completed step on next open |
| User has multiple sessions | Sync state via backend API |
| Wallet connected in Telegram, opens site | State synced via user ID, skip wallet step |
| User funded wallet externally | Balance poll detects it, auto-advance |
