# Telegram Onboarding Spec

## Entry Points

### 1. /start Command
First interaction for most Telegram users.

**Welcome Message**:
```
Welcome to PanoramaBlock!

I'm your AI-powered DeFi assistant. I can help you swap tokens,
stake for yield, and execute strategies - all through chat.

What would you like to do?
```

**Inline Buttons**:
```
[Connect Wallet]  [Try a Swap]  [Learn More]
```

**Behavior**:
- "Connect Wallet" -> Opens MiniApp at wallet connection page
- "Try a Swap" -> Opens MiniApp at swap page (or starts chat: "What would you like to swap?")
- "Learn More" -> Sends educational message about PanoramaBlock

### 2. First Message (No /start)
User sends a message directly without using /start.

**Behavior**:
- If user has no session: send abbreviated welcome + process their message
- If message is a DeFi intent: route to appropriate agent immediately
- If message is unclear: respond helpfully + mention /start for full onboarding

### 3. Deep Link
User arrives via `t.me/PanoramaBlockBot?start=<param>`.

**Parameters**:
- `start=swap_ETH_USDC` -> Pre-fill swap intent, open MiniApp
- `start=ref_<userId>` -> Track referral, show welcome
- `start=strategy` -> Open strategy conversation

**Behavior**:
- Parse deep link parameter
- Set context for agent conversation
- Show relevant welcome message

## Returning Users

### Already Onboarded
User has wallet connected and completed first action.

**On /start**: Skip onboarding, show dashboard summary:
```
Welcome back! Here's your quick summary:
- Portfolio: $5,240 across 3 chains
- Active positions: 2

What would you like to do today?
```

### Wallet Connected, No Action
User connected wallet but never completed an action.

**On /start**: Nudge toward first action:
```
Welcome back! You've connected your wallet but haven't
tried your first action yet.

Would you like to try a simple swap? I can walk you through it.

[Try a Swap]  [Show Dashboard]
```

### Wallet Not Connected
User has chatted before but never connected wallet.

**On /start**: Emphasize wallet connection:
```
Welcome back! To execute DeFi actions, you'll need to
connect a wallet.

[Connect Wallet]  [Browse Without Wallet]
```

## Chat-Based Onboarding Flow

For users who prefer chat over buttons:

```
User: "What can you do?"

Agent: "I can help you with:
- Swap tokens (e.g., 'swap 1 ETH to USDC')
- Stake for yield (e.g., 'stake my ETH')
- Get strategy recommendations (e.g., 'help me invest $5000')
- Check prices and portfolio

To get started, you'll need to connect a wallet.
Tap the button below or just tell me what you'd like to do!

[Connect Wallet]"
```

## MiniApp Launch Points

From Telegram, the MiniApp opens in these contexts:

| Trigger | MiniApp Page | Context |
|---------|-------------|---------|
| "Connect Wallet" button | Wallet connection | New user onboarding |
| "Try a Swap" button | Swap page | Pre-filled or empty |
| Agent swap intent ready | Execution page | Pre-filled from agent |
| "Show Dashboard" button | Dashboard | Returning user |
| Agent strategy intent | Strategy execution | Multi-step wizard |

## TON Wallet Specific Flow

For Telegram users with TON ecosystem wallets:

```
1. User has Tonkeeper or TON Space
2. "Connect Wallet" -> TonConnect option shown prominently
3. User approves in TON wallet app
4. Connected -> TON-chain actions available
5. For EVM chains: "Want to access Base/Ethereum actions too? Connect an EVM wallet."
```

**Limitations for TON-only users**:
- Cannot execute on Base, Ethereum, Avalanche
- Limited to TON-chain DeFi (if supported)
- Show clear messaging about chain support

## Inline Button Patterns

### Onboarding Buttons
```
Welcome message:
[Connect Wallet]  [Try a Swap]  [Learn More]

After wallet connect:
[Try Your First Swap]  [Explore Strategies]  [View Portfolio]

After first action:
[View Transaction]  [Try Another Action]  [Dashboard]
```

### Educational Buttons
```
Learn More response:
[What is DeFi?]  [How Swaps Work]  [Understanding Fees]
```

### Action Confirmation Buttons
```
Agent collected swap intent:
[Execute Swap: 0.01 ETH -> USDC]  [Modify]  [Cancel]
```

## Error Handling

| Scenario | Bot Response |
|----------|-------------|
| Wallet connection fails | "Wallet connection didn't work. Try again or use a different wallet method." + [Try Again] button |
| MiniApp fails to open | "Having trouble opening the app? Try this direct link: [link]" |
| User sends gibberish | "I didn't understand that. Try asking about swaps, staking, or strategies. Or type /help for options." |
| Bot is rate limited | "I'm getting a lot of messages right now. Please try again in a moment." |

## Analytics Events

| Event | When |
|-------|------|
| `telegram_start` | /start command received |
| `telegram_deep_link` | Deep link with params |
| `telegram_first_message` | First non-command message |
| `telegram_button_tap` | Inline button pressed (with button_id) |
| `telegram_miniapp_opened` | MiniApp launch detected |
| `telegram_wallet_connected` | Wallet linked via Telegram flow |
| `telegram_first_action` | First DeFi action from Telegram user |
