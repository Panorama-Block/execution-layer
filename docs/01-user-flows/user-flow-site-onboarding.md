# User Flow: Site Onboarding

## Overview

Web application first-time user journey. Guides new users from landing to their first meaningful DeFi action.

## Entry Points

- Direct URL (panoramablock.com)
- Referral links
- Social media links
- Hackathon/grant demo links

## Flow

### Step 1: Landing Page

User arrives at the landing page. Sees:
- What PanoramaBlock is (AI-native DeFi copilot)
- Key features (swap, stake, lend, strategies)
- "Get Started" call to action

### Step 2: Authentication

Options:
- Connect wallet via Thirdweb (MetaMask, WalletConnect, Coinbase Wallet)
- Social login (Google) via Thirdweb inAppWallet
- Guest browsing (limited features)

### Step 3: Wallet Connection

For wallet-connected users:
- Thirdweb handles chain detection and switching
- Wallet address bound to user profile via authWalletBinding
- Multi-chain balance fetched

### Step 4: Dashboard

First-time user dashboard shows:
- Portfolio overview (or "No assets detected" for new wallets)
- Quick-access cards: Swap, Stake, Lend, DCA
- "Start your first action" guidance

### Step 5: First Action Suggestion

Based on wallet state:
- **Has ETH:** Suggest staking via Lido for yield
- **Has stablecoins:** Suggest lending on Benqi or swapping
- **Empty wallet:** Show how to fund wallet (QR code, bridge from another chain)
- **Has multiple assets:** Show portfolio analysis

### Step 6: Execute First Action

Guide user through their first operation with contextual help:
- Token selection with descriptions
- Amount input with balance display
- Clear fee and slippage information
- Step-by-step transaction signing
- Confirmation with result details

### Step 7: Post-Action

- Show transaction in history
- Suggest next actions based on position
- Invite to Telegram for chat-based interaction

## Guest Flow

Users who browse without connecting:
- Can view market data and protocol information
- Cannot execute transactions
- Prompted to connect wallet when attempting actions

## Returning User Flow

- Auto-reconnect wallet
- Show updated portfolio
- Show pending transactions or positions
- Skip onboarding content
