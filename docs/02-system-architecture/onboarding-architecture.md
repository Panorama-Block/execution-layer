# Onboarding Architecture

## Entry Points

### Web Application
- Direct URL navigation
- Referral/social links
- Hackathon demo links

### Telegram Bot
- /start command
- Deep links from external sources
- Inline button presses

### MiniApp
- Opened from Telegram chat via WebApp button
- Direct deep link with context parameters

## Authentication Flow

### Telegram WebApp Auth
1. MiniApp receives initData from Telegram WebApp API
2. Frontend validates initData signature
3. JWT token issued for authenticated API calls
4. User identity resolved (telegram_user_id -> internal user_id)

### Wallet Binding
1. User connects wallet via Thirdweb or TonConnect
2. authWalletBinding associates wallet address with user profile
3. Multi-chain balances fetched
4. User record created/updated in database gateway

## User State Detection

The onboarding flow branches based on detected user state:

| State | Detection | Flow |
|-------|-----------|------|
| New user, no wallet | No auth record | Wallet creation/connection guide |
| New user, has wallet | Auth exists, no transactions | First action guidance |
| Returning user | Auth exists, has history | Skip onboarding, show dashboard |
| Unfunded wallet | Wallet connected, zero balance | Funding guide (bridge, receive) |
| TON user | TonConnect connected | TON-specific flows (jettons) |
| EVM user | Thirdweb connected | EVM flows (swap, stake, lend) |

## Wallet Connection Architecture

### Thirdweb (EVM Chains)
- inAppWallet: embedded wallet, social login support
- External wallets: MetaMask, WalletConnect, Coinbase Wallet
- Chain switching: useSwitchActiveWalletChain
- Transaction signing: safeExecuteTransactionV2

### TonConnect (TON)
- TonConnect UI for wallet connection
- Jetton wallet detection
- TON-native transfers and approvals

## Content Delivery

Onboarding content is delivered through:
- MiniApp modal overlays (first-time users)
- Telegram bot messages (welcome flow)
- Contextual tooltips in MiniApp (during operations)
- Documentation links (help/support)

## Backend Touchpoints

| Service | Onboarding Role |
|---------|----------------|
| auth-service | User creation, JWT issuance, wallet binding |
| database gateway | User profile persistence, onboarding state tracking |
| wallet-tracker | Initial balance fetch across chains |
| All services | Available for first-action execution |

## Onboarding State Tracking

Track onboarding progress per user:
- has_connected_wallet: boolean
- has_completed_first_action: boolean
- onboarding_dismissed: boolean
- first_action_type: string (swap/stake/lend)
- onboarding_completed_at: timestamp
