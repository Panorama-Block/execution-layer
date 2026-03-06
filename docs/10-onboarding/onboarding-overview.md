# Onboarding Overview

## Vision

PanoramaBlock's onboarding eliminates the confusion that prevents new users from taking their first DeFi action. The goal is to take someone from "I've never used DeFi" to "I just completed my first swap" in under 3 minutes.

## The Problem

New users face multiple friction points:
1. **What is this?** - No clear explanation of what PanoramaBlock does
2. **Wallet confusion** - Don't know how to connect or what a wallet is
3. **Action paralysis** - Too many options, no guidance on what to do first
4. **Fear of mistakes** - Worried about losing funds, confused by fees and slippage
5. **Platform fragmentation** - Different entry points (site, Telegram, MiniApp) with no unified experience

## Goals

| Goal | Metric | Target |
|------|--------|--------|
| Reduce bounce rate | Users who leave without any action | < 40% |
| Increase wallet connection | Users who connect wallet on first visit | > 60% |
| First action completion | Users who complete at least one DeFi action | > 30% |
| Time to first action | Minutes from first visit to first transaction | < 5 min |
| Onboarding completion | Users who complete full onboarding flow | > 50% |

## Key Principles

1. **Progressive disclosure**: Show only what's needed at each step. Don't overwhelm.
2. **Action-oriented**: Every onboarding step leads toward doing something, not just reading.
3. **Platform-aware**: Different entry points get different flows (Telegram vs site vs MiniApp).
4. **Skippable**: Experienced users can skip everything and go straight to the dashboard.
5. **Educational**: Every step teaches something about DeFi, not just about PanoramaBlock.
6. **Safe defaults**: Pre-filled amounts, suggested actions, conservative settings.

## Entry Points

### Site (Web App)
- Landing page with value proposition
- Dashboard (if logged in but new)
- Direct link to action page

### Telegram Bot
- `/start` command (first interaction)
- First message to bot (no /start)
- Shared deep link from another user

### MiniApp (Telegram WebApp)
- First open (launched from bot)
- Direct deep link with action context
- Return visit after wallet connection

## Onboarding States

```
New User -> [Explain PanoramaBlock] -> [Connect Wallet] -> [Fund Wallet] -> [First Action] -> Onboarded
                                           |                    |
                                           v                    v
                                     [Skip / Guest]      [Funding Guide]
```

Each state is tracked per user and persisted via the backend API.

## Relationship to Other Components

### Strategy Agent
The Strategy Agent can serve as an onboarding tool: "What do you want to achieve?" leads to a guided first action. For new users, the agent defaults to simple, low-risk suggestions.

### Execution Layer
The first onboarded action (a small swap) flows through the execution layer. Onboarding success depends on a smooth execution experience.

### Gateway / Bot
The Telegram bot is the primary onboarding channel. Welcome messages, inline buttons, and deep links are the main onboarding mechanisms.
