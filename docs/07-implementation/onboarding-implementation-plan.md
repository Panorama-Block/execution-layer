# Onboarding Implementation Plan

## Phase 1: Structure

### Entry Point Definition
- [ ] Define site onboarding entry points (landing, dashboard, action pages)
- [ ] Define Telegram onboarding entry points (/start, first MiniApp open)
- [ ] Define MiniApp onboarding entry points (first load, wallet connection)

### State Model
- [ ] Define onboarding state fields (walletConnected, firstActionCompleted, etc.)
- [ ] Add state to user entity in database gateway
- [ ] Implement state detection in frontend

## Phase 2: Content

### Content Blocks
- [ ] "What is PanoramaBlock" (30-second explainer)
- [ ] "How it works" (chat -> agent -> execution flow)
- [ ] "Connect your wallet" (step-by-step guide)
- [ ] "Your first action" (guided swap or stake)
- [ ] "Understanding fees and slippage" (transaction cost explanation)
- [ ] "Get support" (community links, help resources)

### Content Format
- Short, scannable paragraphs
- Visual aids where possible
- Localized for target audiences (English first)

## Phase 3: UX Logic

### User Type Branching
- [ ] First-time user flow (full onboarding)
- [ ] Returning user flow (skip to dashboard)
- [ ] Guest flow (browse without wallet)
- [ ] Wallet-connected, unfunded flow (funding guide)
- [ ] TON user flow (TonConnect-specific)
- [ ] Chat-triggered flow (pre-filled operation)

### Implementation
- [ ] Conditional rendering based on onboarding state
- [ ] Dismissable onboarding modals
- [ ] Progress indicators
- [ ] Contextual tooltips on first use of each feature

## Phase 4: Integration

### Telegram Bot
- [ ] Welcome message content for /start
- [ ] Inline buttons for onboarding actions
- [ ] Deep links to MiniApp with context

### MiniApp
- [ ] Onboarding overlay component
- [ ] Wallet connection guide component
- [ ] First-action suggestion component
- [ ] Onboarding state persistence

### Backend
- [ ] Onboarding state API (GET/PUT)
- [ ] First-action detection query
- [ ] Analytics events for onboarding funnel
