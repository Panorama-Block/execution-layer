# Task Breakdown: Onboarding

## Phase 1: Structure

### Entry Point Definition
- [ ] Map site onboarding entry points (landing page, dashboard, action pages)
- [ ] Map Telegram onboarding entry points (/start command, first MiniApp open)
- [ ] Map MiniApp onboarding entry points (first load, wallet connection prompt)
- [ ] Document all entry points with expected user state

### State Model
- [ ] Define onboarding state fields:
  - `hasVisited` - User has opened the app before
  - `walletConnected` - Wallet is linked
  - `walletFunded` - Wallet has non-zero balance
  - `firstActionCompleted` - User has done at least one DeFi action
  - `onboardingDismissed` - User explicitly skipped onboarding
- [ ] Add onboarding state to user entity in database gateway
- [ ] Create GET /user/onboarding-state endpoint
- [ ] Create PUT /user/onboarding-state endpoint
- [ ] Implement state detection in frontend (check wallet, balance, action history)

## Phase 2: Content

### Content Blocks
- [ ] "What is PanoramaBlock" - 30-second explainer
  - What it does, who it's for, key value proposition
- [ ] "How it works" - Chat -> Agent -> Execution flow
  - Simple 3-step visual explanation
- [ ] "Connect your wallet" - Step-by-step guide
  - Thirdweb embedded wallet, Google login, TON wallet options
- [ ] "Your first action" - Guided swap or stake
  - Pre-filled example with small amount
- [ ] "Understanding fees and slippage" - Transaction cost explanation
  - Gas fees, slippage tolerance, protocol fees
- [ ] "Get support" - Community links, help resources
  - Telegram group, documentation, FAQ

### Content Format
- [ ] Write all content in short, scannable paragraphs
- [ ] Create visual aids (simple diagrams, step indicators)
- [ ] English first, structure for future localization
- [ ] Review content for accuracy and clarity

## Phase 3: UX Logic

### User Type Detection
- [ ] Detect first-time user (no onboarding state)
- [ ] Detect returning user (hasVisited = true)
- [ ] Detect guest user (browsing without wallet)
- [ ] Detect wallet-connected but unfunded user
- [ ] Detect TON user (TonConnect wallet type)
- [ ] Detect chat-triggered user (arrived via agent deep link)

### User Type Flows
- [ ] First-time user: full onboarding sequence
- [ ] Returning user: skip to dashboard
- [ ] Guest user: show value prop + connect wallet CTA
- [ ] Unfunded user: funding guide (bridge, buy, receive)
- [ ] TON user: TON-specific wallet connection flow
- [ ] Chat-triggered user: skip to pre-filled action

### UI Components
- [ ] Onboarding overlay component (full-screen, dismissable)
- [ ] Progress indicator (step 1 of 4, etc.)
- [ ] Contextual tooltip component (first use of each feature)
- [ ] Dismissable banner component (non-blocking hints)
- [ ] Wallet connection guide modal
- [ ] First-action suggestion card

### Implementation
- [ ] Conditional rendering based on onboarding state
- [ ] Persist dismissed state (don't show again)
- [ ] Animate transitions between onboarding steps
- [ ] Handle back/forward navigation within onboarding

## Phase 4: Integration

### Telegram Bot
- [ ] Welcome message for /start command:
  - Brief intro + 3 inline buttons (Connect Wallet, Try a Swap, Learn More)
- [ ] Inline buttons for onboarding actions
- [ ] Deep links to MiniApp with onboarding context
- [ ] Handle returning users differently (/start after already onboarded)

### MiniApp
- [ ] Check onboarding state on app load
- [ ] Show onboarding overlay for new users
- [ ] Show wallet connection guide when needed
- [ ] Show first-action suggestion after wallet connected
- [ ] Persist onboarding state via API

### Backend
- [ ] GET /user/onboarding-state endpoint
- [ ] PUT /user/onboarding-state endpoint
- [ ] First-action detection query (check transaction history)
- [ ] Analytics events:
  - `onboarding_started`
  - `onboarding_step_completed` (with step name)
  - `onboarding_dismissed`
  - `onboarding_completed`
  - `first_action_completed`
  - `wallet_connected`

### Testing
- [ ] Test first-time user flow end-to-end
- [ ] Test returning user bypass
- [ ] Test wallet connection during onboarding
- [ ] Test dismissal persistence
- [ ] Test deep link from Telegram with context
- [ ] Test TON-specific flow
