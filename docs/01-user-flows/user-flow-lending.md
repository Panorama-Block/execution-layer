# User Flow: Lending

## Overview

Lending flow via Benqi on Avalanche. Users can supply tokens as collateral, borrow against collateral, repay debt, and withdraw supplied assets.

## Entry Points

1. Chat: User says "Supply 100 USDC on Benqi" -> lending_agent collects intent -> lending_intent_ready -> MiniApp opens lending page
2. MiniApp: User navigates to /lending directly

## Supply Flow

### Step 1: Select Mode
User selects "Supply" mode.

### Step 2: Select Token
Choose from supported tokens: AVAX, USDC, USDT, DAI, WETH, WBTC.

### Step 3: Input Amount
Enter amount to supply. MiniApp shows current supply APY and available liquidity.

### Step 4: Approve (ERC20 only)
For ERC20 tokens, first transaction approves ValidatedLending contract to spend tokens.

### Step 5: Supply
Transaction calls ValidatedLending.validateAndSupplyERC20(qTokenAddress, amount). For AVAX, calls validateAndSupplyAVAX(qTokenAddress) with AVAX value.

The contract:
1. Calculates and pays validation tax
2. Transfers tokens from user
3. Approves qToken contract
4. Calls qToken.mint()

### Step 6: Confirmation
User receives qTokens (interest-bearing). Position tracked in MiniApp.

## Borrow Flow

### Step 1: Select Mode
User selects "Borrow" mode.

### Step 2: Select Collateral
Must have existing supply position. MiniApp shows available collateral and health factor.

### Step 3: Select Borrow Token
Choose token to borrow.

### Step 4: Input Amount
Enter borrow amount. MiniApp shows health factor impact and interest rate.

### Step 5: Execute Borrow
Transaction calls ValidatedLending.validateAndBorrow(qTokenAddress, borrowAmount).

### Step 6: Confirmation
User receives borrowed tokens. Health factor updated.

## Repay Flow

User selects debt to repay, enters amount, signs repay transaction via validateAndRepayAVAX() or equivalent ERC20 method.

## Withdraw Flow

User selects supplied asset to withdraw, enters amount, checks collateral adequacy, signs withdraw transaction via validateAndWithdraw().

## Backend Services Involved

- lending-service (:3006): market data, account positions, transaction preparation
- ValidatedLending.sol: on-chain atomic validation + Benqi operations
- Database gateway: position tracking, history
- Gateway transaction API: lifecycle tracking
