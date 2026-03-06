# Site Onboarding Spec

## Entry Points

### 1. Landing Page
First touchpoint for users arriving from search, social, or referral links.

**Content**:
- Hero: "DeFi made simple. Chat to invest." (one-liner)
- 3-step visual: Chat -> AI Agent -> On-Chain Execution
- CTA: "Start Chatting" (opens Telegram) or "Open App" (opens MiniApp)

**Behavior**:
- No wallet required to browse
- Shows sample conversation/demo
- Links to Telegram bot for chat experience

### 2. Dashboard (New User)
User has opened the MiniApp but hasn't completed onboarding.

**Content**:
- Welcome overlay: "Welcome to PanoramaBlock"
- Step 1: Connect your wallet
- Step 2: Try your first action (suggested: small swap)
- Progress indicator: "Step 1 of 3"

**Behavior**:
- Overlay is dismissable (sets `onboardingDismissed = true`)
- After wallet connection, overlay advances to step 2
- After first action, overlay shows completion message

### 3. Action Page (Direct Link)
User arrived via a deep link to a specific action (e.g., from agent).

**Content**:
- If no wallet: "Connect wallet to continue" banner
- If wallet but no funds: "You need [token] to complete this action" with funding guide
- If ready: Pre-filled action form

**Behavior**:
- Contextual onboarding (not full flow, just what's needed for this action)
- After completing action, suggest exploring more features

## Wallet Connection Flow

### Thirdweb Embedded Wallet
Primary method for new users.

```
1. "Connect Wallet" button
2. Options: Google Login | Email | External Wallet
3. If Google/Email: Thirdweb creates embedded wallet automatically
4. If External: WalletConnect / MetaMask / Coinbase Wallet
5. Wallet connected -> check balance
6. If balance > 0: proceed to first action
7. If balance = 0: show funding guide
```

### TON Wallet (Telegram Users)
For users in the Telegram ecosystem.

```
1. "Connect TON Wallet" button
2. TonConnect modal opens
3. User approves in Tonkeeper / TON Space
4. Wallet connected -> limited to TON-chain actions
```

### Funding Guide
Shown when wallet is connected but has zero balance.

**Options presented**:
1. Bridge from another chain (link to bridge feature)
2. Buy crypto with fiat (link to onramp partner)
3. Receive from another wallet (show wallet address + QR code)

## First Action Experience

### Suggested Action: Small Swap
Pre-configured swap with safe defaults:
- Amount: 0.001 ETH (or equivalent)
- Pair: ETH -> USDC
- Slippage: 0.5% (default)

**UI Flow**:
```
1. "Try your first swap" card
2. Pre-filled: 0.001 ETH -> USDC
3. Show estimated output, fee, slippage
4. Tooltip: "Slippage protects you from price changes during the swap"
5. "Confirm Swap" button
6. Sign transaction
7. Success screen: "You just completed your first DeFi swap!"
8. "Explore more" CTA
```

### Alternative First Actions
Based on user profile:
- ETH holder: "Stake your ETH for ~3.5% APY" (Lido)
- Stablecoin holder: "Earn yield on your USDC" (Benqi)
- Chat-triggered: Whatever action the agent suggested

## Contextual Tooltips

Shown on first use of each feature, not during onboarding overlay:

| Feature | Tooltip |
|---------|---------|
| Swap page | "Swap lets you exchange one token for another" |
| Slippage setting | "Slippage tolerance is the maximum price change you'll accept" |
| Gas fee display | "Gas fees are paid to the blockchain network to process your transaction" |
| Staking page | "Staking earns rewards for helping secure the network" |
| Portfolio page | "Your portfolio shows all your DeFi positions across chains" |

## State Persistence

Onboarding state is stored via backend API:

```
GET /user/onboarding-state
Response: {
  hasVisited: true,
  walletConnected: true,
  walletFunded: false,
  firstActionCompleted: false,
  onboardingDismissed: false,
  onboardingStep: 2,
  tooltipsShown: ["swap_intro"]
}

PUT /user/onboarding-state
Body: { firstActionCompleted: true, onboardingStep: 3 }
```

## Analytics Events

| Event | When | Data |
|-------|------|------|
| `onboarding_started` | User sees welcome overlay | entry_point |
| `wallet_connect_started` | User clicks "Connect Wallet" | method |
| `wallet_connected` | Wallet successfully linked | wallet_type, chain |
| `funding_guide_shown` | Zero balance detected | - |
| `first_action_started` | User begins first swap/stake | action_type |
| `first_action_completed` | First transaction confirmed | action_type, tx_hash |
| `onboarding_dismissed` | User skips onboarding | step_reached |
| `onboarding_completed` | All steps done | total_time |
