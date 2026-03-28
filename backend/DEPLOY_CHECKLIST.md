# Deployment Checklist — Execution Layer

Run through this checklist before every production deployment.

## Pre-Deploy Verification

### 1. Contract Addresses
- [ ] `EXECUTOR_ADDRESS` matches deployed PanoramaExecutor on Base Mainnet
- [ ] `DCA_VAULT_ADDRESS` matches deployed DCAVault on Base Mainnet
- [ ] `AVAX_EXECUTOR_ADDRESS` matches deployed executor on Avalanche (if applicable)
- [ ] Aerodrome protocol addresses in `config/protocols.ts` are correct (Router, Factory, Voter)

### 2. RPC Endpoints
- [ ] `BASE_RPC_URLS` configured with at least 2 endpoints (primary + fallback)
- [ ] `AVAX_RPC_URLS` configured with at least 2 endpoints (if Avalanche is active)
- [ ] Primary RPC endpoint is a paid/stable provider (Alchemy, Infura, QuickNode)
- [ ] Tested: `curl -X POST <rpc_url> -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'` returns a valid block number

### 3. Schema Alignment
- [ ] Frontend (miniapp) is consuming the same response shapes as the backend produces
- [ ] Error codes in `shared/errorCodes.ts` are documented for frontend error mapping
- [ ] No breaking changes in `TransactionBundle` or `PreparedTransaction` types since last deploy

### 4. Rate Limits & Middleware
- [ ] `rateLimiter.ts` settings are appropriate for production traffic
- [ ] `serialize-by-user.ts` queue limits match expected concurrency
- [ ] `execution-timeout.ts` default (15s) is appropriate for production RPCs
- [ ] CORS `ALLOWED_ORIGINS` includes all production frontend domains

### 5. Build & Tests
- [ ] `npm run build` succeeds with zero TypeScript errors
- [ ] `npm test` passes all test suites
- [ ] No `.env` or credentials committed to the repository

## Deploy Steps

1. **Tag the release**: `git tag v<version> && git push origin v<version>`
2. **Build**: `npm run build`
3. **Verify health**: `curl https://<deployment-url>/health` returns `{"status":"ok"}`
4. **Smoke test**: Run the canonical demo flow (see `config/demo.ts`)
   - POST `/swap/prepare` (ETH → USDC)
   - POST `/staking/prepare-enter` (WETH/USDC volatile)
   - GET `/staking/position/:address`

## Post-Deploy Verification

- [ ] Health endpoint returns `{"status":"ok"}`
- [ ] Swagger docs accessible at `/docs` (non-production only)
- [ ] Logs show `execution-service running on port <PORT>`
- [ ] Logs show `[ChainProvider] base: N RPC endpoints configured`
- [ ] Test a swap quote: `POST /swap/quote` returns a valid `amountOut`

## Rollback

If issues are found post-deploy:
1. Revert to previous Docker image / git tag
2. Verify health endpoint
3. Document the issue for next deploy
