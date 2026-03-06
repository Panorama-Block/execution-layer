# Onboarding Backend Touchpoints

## Auth Flow

### Telegram WebApp Verification
1. MiniApp receives initData from Telegram WebApp API
2. Backend validates HMAC-SHA-256 signature against bot token
3. Extracts user info (telegram_user_id, username, first_name)
4. Issues JWT token for subsequent API calls

### User Creation
1. auth-service checks if user exists in database gateway
2. If new: creates user record via POST /v1/user
3. Returns user_id and JWT

### Wallet Binding
1. User connects wallet in MiniApp (Thirdweb or TonConnect)
2. Frontend calls authWalletBinding to associate wallet address with user
3. Database gateway stores wallet -> user mapping
4. Multi-chain addresses resolved

## First-Action Detection

After onboarding, track whether the user has completed their first action:

### Backend Query
```
GET /v1/transaction?userId={id}&limit=1
```

If empty: user has not completed any action yet. Show onboarding prompts.
If non-empty: user is returning. Skip onboarding.

## Portfolio Initialization

When wallet is first connected:
1. wallet-tracker-service fetches balances across all supported chains
2. Results cached in Redis
3. Frontend displays portfolio overview
4. Determines which first-action suggestions to show based on balances

## Service Roles During Onboarding

| Service | Onboarding Role |
|---------|----------------|
| auth-service (:3001) | User creation, JWT issuance, Telegram auth validation |
| database gateway (:3005) | User profile persistence, transaction history queries |
| wallet-tracker | Initial multi-chain balance fetch |
| liquid-swap-service (:3002) | First swap execution |
| lido-service (:3004) | First stake execution |
| lending-service (:3006) | First supply execution |
| execution-service (:3010) | First Aerodrome operation |

## Onboarding State Persistence

Store in database gateway via user entity:
```json
{
  "userId": "abc123",
  "onboardingCompleted": false,
  "walletConnected": true,
  "firstActionCompleted": false,
  "firstActionType": null,
  "onboardingDismissed": false
}
```

Update after first successful transaction:
```json
{
  "onboardingCompleted": true,
  "firstActionCompleted": true,
  "firstActionType": "swap",
  "firstActionCompletedAt": "2024-03-07T10:30:00Z"
}
```
