# User Flow: Telegram Onboarding

## Overview

Telegram onboarding flow from /start command through first DeFi action. Covers bot interaction, MiniApp entry, and wallet connection.

## Flow

### Step 1: /start Command

User sends /start to the PanoramaBlock Telegram bot. The bot sends a welcome message:

"Welcome to PanoramaBlock -- your AI DeFi copilot.

I can help you swap tokens, stake ETH, lend assets, and build DeFi strategies using natural language.

What would you like to do?"

Inline buttons:
- [Open PanoramaBlock] (WebApp button -> MiniApp)
- [What can you do?]
- [Help]

### Step 2: Chat vs MiniApp

**Chat path:** User types a natural language request. The bot forwards to agents, receives response, and presents action buttons when intent is ready.

**MiniApp path:** User taps [Open PanoramaBlock]. The MiniApp opens within Telegram as a WebApp.

### Step 3: MiniApp Entry

URL: `/app/landing?tma=1`

The MiniApp:
1. Detects Telegram WebApp environment
2. Validates initData signature for authentication
3. Resolves user identity

### Step 4: Wallet Connection

Options presented:
- **Thirdweb inAppWallet:** Embedded wallet, no extension needed. Can use social login.
- **External wallet:** MetaMask, WalletConnect, etc.
- **TonConnect:** For TON blockchain operations

First-time flow: guided wallet creation or connection with clear instructions.

### Step 5: First Interaction

Based on entry context:
- If opened from chat intent (conversation_id in URL): show pre-filled operation (swap, stake, etc.)
- If opened directly: show dashboard with action cards

### Step 6: First Action Guidance

For new users with no prior transactions:
1. Show brief "How PanoramaBlock works" overlay
2. Highlight available actions based on wallet assets
3. Guide through first operation with contextual tooltips

### Step 7: Return to Chat

After completing action in MiniApp, user returns to Telegram chat. The bot can continue the conversation:

"Your swap is complete! You received 250 USDC. Would you like to:
- Provide liquidity with your new USDC
- Explore lending opportunities
- Set up a DCA strategy"

## Wallet Flows by Type

### EVM Wallet (Thirdweb)
- Connect -> auto-detect chain -> switch if needed -> ready

### TON Wallet (TonConnect)
- Connect via TonConnect UI -> detect jetton balances -> ready for TON operations

### No Wallet (New User)
- Offer to create embedded wallet via Thirdweb inAppWallet
- Explain funding options (bridge, receive from exchange)

## Deep Links

The bot generates deep links to MiniApp with context:
- `/chat?conversation_id={id}&telegram_user_id={id}&tma=1` - Chat-triggered action
- `/swap?from=ETH&to=USDC&amount=0.1&tma=1` - Direct swap
- `/staking?tma=1` - Direct staking page

## Support Flow

User sends "help" or "/help":
- Bot explains available commands
- Links to documentation
- Links to community channels
