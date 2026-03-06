# Onboarding Content Map

## Content Blocks

All content needed for onboarding across site, Telegram, and MiniApp.

---

### Block 1: What is PanoramaBlock

**Purpose**: 30-second explainer for first-time users

**Content**:
> PanoramaBlock is an AI-powered DeFi assistant. You tell it what you want to do in plain language - swap tokens, earn yield, invest - and it handles the complexity of decentralized finance for you.
>
> No need to navigate multiple protocols, compare rates, or understand smart contracts. Just chat, confirm, and execute.

**Used in**: Site landing, Telegram welcome, MiniApp overlay

**Format**: Short paragraph + 3-icon visual (Chat, AI, Execute)

---

### Block 2: How It Works

**Purpose**: Explain the chat -> agent -> execution flow

**Content**:
> **Step 1: Chat** - Tell the AI what you want. "Swap 1 ETH to USDC" or "Help me earn yield."
>
> **Step 2: AI Processes** - Our agent understands your intent, finds the best route, and prepares the transaction.
>
> **Step 3: You Confirm** - Review the details (amounts, fees, slippage) and approve with one tap.
>
> That's it. The transaction executes on-chain through audited smart contracts.

**Used in**: Site landing, Telegram "Learn More", MiniApp onboarding step 1

**Format**: 3-step numbered list with icons

---

### Block 3: Connect Your Wallet

**Purpose**: Guide users through wallet connection

**Content (Thirdweb/Google)**:
> To execute DeFi actions, you need a wallet. The easiest way is to sign in with Google - we'll create a secure wallet for you automatically.
>
> 1. Tap "Connect Wallet"
> 2. Choose "Sign in with Google" (or email)
> 3. Done! Your wallet is ready.
>
> Your wallet is non-custodial - only you control your funds.

**Content (External Wallet)**:
> Already have a wallet? Connect it directly:
>
> 1. Tap "Connect Wallet"
> 2. Choose your wallet (MetaMask, Coinbase, WalletConnect)
> 3. Approve the connection in your wallet app
>
> We never ask for your private keys or seed phrase.

**Content (TON Wallet)**:
> Using Tonkeeper or TON Space? You can connect your TON wallet:
>
> 1. Tap "Connect TON Wallet"
> 2. Approve in your TON wallet app
> 3. Connected! You can use TON-chain features.
>
> For Base and Ethereum actions, connect an EVM wallet too.

**Used in**: MiniApp wallet connection step, Telegram after "Connect Wallet" button

**Format**: Numbered steps with wallet-specific variations

---

### Block 4: Your First Action

**Purpose**: Guide users through their first DeFi transaction

**Content**:
> Let's try your first swap - it's the simplest DeFi action.
>
> We've pre-filled a small swap for you:
> - **From**: 0.001 ETH (~$3)
> - **To**: USDC (a stablecoin pegged to $1)
> - **Fee**: ~$0.05 in gas
>
> Review the details, then tap "Confirm Swap." Your transaction will be processed in about 10 seconds.
>
> After your first swap, you can explore staking, lending, and more.

**Used in**: MiniApp first action card, Telegram "Try a Swap" flow

**Format**: Pre-filled action card with explanation tooltips

---

### Block 5: Understanding Fees and Slippage

**Purpose**: Explain transaction costs without overwhelming

**Content**:
> Every blockchain transaction has costs. Here's what you'll see:
>
> **Gas Fee**: A small fee (~$0.01-$0.50 on Base) paid to the network to process your transaction. This is not charged by PanoramaBlock.
>
> **Slippage**: The maximum price change you'll accept during a swap. Default is 0.5%. If the price moves more than this, your transaction is cancelled to protect you.
>
> **Price Impact**: For large swaps, your trade can move the market price. We show this so you can decide if the trade is worth it.
>
> **Protocol Fees**: Some protocols charge a small fee (0.01-0.3%) for using their liquidity. This is built into the quoted price.

**Used in**: Contextual tooltip on fee display, Telegram "Understanding Fees" educational message

**Format**: Definition list with simple explanations

---

### Block 6: Get Support

**Purpose**: Help users who are stuck or confused

**Content**:
> Need help? Here's how to get support:
>
> - **Chat**: Just ask the bot! Type your question and the AI will help.
> - **Community**: Join our Telegram group for community support.
> - **Documentation**: Visit our docs for detailed guides.
> - **FAQ**: Common questions answered at [link].
>
> Common issues:
> - "Transaction failed" - Usually means slippage was too tight. Try increasing to 1%.
> - "Insufficient balance" - You need enough tokens plus gas fees.
> - "Wallet won't connect" - Try refreshing the page or using a different browser.

**Used in**: Help page, Telegram /help command, MiniApp menu

**Format**: Resource links + FAQ items

---

## Content by Platform

### Site
| Page | Content Blocks Used |
|------|-------------------|
| Landing | Block 1, Block 2 |
| Dashboard (new user) | Block 3, Block 4 |
| Action page (no wallet) | Block 3 |
| Help page | Block 6 |

### Telegram Bot
| Trigger | Content Blocks Used |
|---------|-------------------|
| /start | Block 1 (abbreviated) |
| "Learn More" button | Block 2 |
| "Connect Wallet" button | Block 3 |
| "Try a Swap" button | Block 4 |
| /help command | Block 6 |

### MiniApp
| Screen | Content Blocks Used |
|--------|-------------------|
| Onboarding overlay step 1 | Block 1, Block 2 |
| Onboarding overlay step 2 | Block 3 |
| Onboarding overlay step 3 | Block 4 |
| Fee tooltip | Block 5 |
| Help/menu | Block 6 |

## Localization Notes

- All content written in English first
- Structured for easy translation (no idioms, cultural references)
- Variable content (amounts, token names) separated from static text
- RTL languages considered in layout (future)
