# Onboarding Sequence: Site

```mermaid
sequenceDiagram
    actor User
    participant Site as Web App
    participant Auth as Auth Service
    participant Wallet as Thirdweb
    participant DB as Database Gateway
    participant Tracker as Wallet Tracker

    User->>Site: Visit panoramablock.com
    Site-->>User: Landing page + "Get Started"
    User->>Site: Click "Get Started"
    Site->>Wallet: Connect wallet prompt
    User->>Wallet: Connect (MetaMask/WalletConnect/Social)
    Wallet-->>Site: Wallet address
    Site->>Auth: Authenticate + bind wallet
    Auth->>DB: Create/update user record
    Auth-->>Site: JWT token
    Site->>Tracker: Fetch multi-chain balances
    Tracker-->>Site: Portfolio data
    Site-->>User: Dashboard (portfolio + action cards)
    User->>Site: First action (swap/stake/lend)
    Site->>DB: Record first action
```

## Walkthrough

1. User visits the web application.
2. Landing page explains what PanoramaBlock does.
3. User clicks "Get Started".
4. Wallet connection modal appears (Thirdweb: MetaMask, WalletConnect, social login).
5. User connects wallet.
6. Auth service validates and creates user record.
7. Wallet tracker fetches balances across supported chains.
8. Dashboard shows portfolio overview and suggested first actions.
9. Based on wallet contents: suggest swap (has tokens), stake (has ETH), or fund wallet (empty).
10. User completes first action. Onboarding state updated.
