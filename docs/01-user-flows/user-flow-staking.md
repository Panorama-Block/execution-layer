# User Flow: Staking

## Overview

Staking flow via Lido on Ethereum. Users stake ETH to receive stETH (liquid staking token) and can unstake via queue (7 days) or instant withdrawal (with fee).

## Entry Points

1. Chat: User says "I want to stake 1 ETH" -> staking_agent collects intent -> staking_intent_ready -> MiniApp opens staking page
2. MiniApp: User navigates to /staking directly

## Stake Flow

### Step 1: Input
User enters amount of ETH to stake. MiniApp shows current Lido APY (fetched from lido-service -> Lido Stats API).

### Step 2: Review
MiniApp displays: amount, expected stETH received, current APY, gas estimate.

### Step 3: Sign
Transaction prepared: call Lido submit() with ETH value. Signed via Thirdweb wallet.

### Step 4: Confirm
Wait for Ethereum block confirmation. User receives stETH in their wallet.

## Unstake Flow (Queue)

### Step 1: Select Unstake Mode
User chooses "Queue Withdrawal" (standard, 7-day processing).

### Step 2: Input
User enters stETH amount to unstake.

### Step 3: Request Withdrawal
Transaction: call Lido requestWithdrawals([amount]). Returns a withdrawal request ID.

### Step 4: Wait
Withdrawal processes over ~7 days. User can check status in the MiniApp.

### Step 5: Claim
Once finalized, user calls claimWithdrawal(requestId) to receive ETH.

## Unstake Flow (Instant)

### Step 1: Select Instant Mode
User chooses "Instant Unstake" (immediate, fee applies).

### Step 2: Input
User enters stETH amount. MiniApp shows fee percentage.

### Step 3: Approve
First transaction: approve stETH spending by the instant unstake contract.

### Step 4: Execute
Second transaction: execute instant unstake. User receives ETH immediately minus fee.

## Backend Services Involved

- lido-service (:3004): APY data, transaction preparation, withdrawal status
- Gateway transaction API: transaction lifecycle tracking
- Thirdweb SDK: wallet connection, transaction signing
