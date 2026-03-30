# CONTRACTS.md — Deployed Contract Addresses & Roles

## Base Mainnet (Chain ID: 8453)

### Panorama Infrastructure

| Contract | Address | Role |
|---|---|---|
| PanoramaExecutorV2 | `0x7528861E7DD09dc9B1e5149542e897d984Ceda7f` | Single entry point — routes `execute()` calls to per-user BeaconProxy adapters |
| AerodromeAdapterV2 | `0x187e499afB2DE75836800ad19147e0cFcd2Dc715` | Beacon implementation for Aerodrome (swap, LP, stake/unstake, claim) |
| DCAVault | `0x155eC4256cC6f11f3d4C21Af28a2a1CC31f730d1` | Dollar-cost averaging vault (uses IPanoramaExecutor interface) |

### Aerodrome Finance (DEX + Gauges)

| Contract | Address | Role |
|---|---|---|
| Router | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` | AMM router for swaps and liquidity |
| Factory | `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` | Pool factory (immutable pool addresses) |
| Voter | `0x16613524e02ad97eDfeF371bC883F2F5d6C480A5` | Gauge registry — maps pool -> gauge |

### Tokens

| Token | Address | Decimals |
|---|---|---|
| WETH | `0x4200000000000000000000000000000000000006` | 18 |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |
| USDbC | `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA` | 6 |
| AERO | `0x940181a94A35A4569E4529A3CDfB74e38FD98631` | 18 |
| cbBTC | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` | 8 |
| wstETH | `0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452` | 18 |
| cbETH | `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` | 18 |
| DAI | `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb` | 18 |

---

## Avalanche C-Chain (Chain ID: 43114)

### Panorama Infrastructure

| Contract | Address | Role |
|---|---|---|
| PanoramaExecutorV2 | `0xc35059D1BC395Ff0F6fDcEA1b7F365E3aa7C1D12` | Single entry point — same pattern as Base |

### Trader Joe V1 (DEX)

| Contract | Address | Role |
|---|---|---|
| Router | `0x60aE616a2155Ee3d9A68541Ba4544862310933d4` | AMM router for swaps |

Protocol ID: `keccak256("traderjoe")`

### Benqi Finance (Lending)

| Contract | Address | Role |
|---|---|---|
| Comptroller | `0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4` | Lending market controller |
| qiAVAX | `0x5C0401e81Bc07Ca70fAD469b451682c0d747Ef1c` | AVAX lending market (qToken) |
| qiUSDC.e | `0xBEb5d47A3f720Ec0a390d04b4d41ED7d9688bC7F` | USDC.e lending market |
| qiUSDT | `0xc9e5999b8e75C3fEB117F6f73E664b9f3C8ca65C` | USDT lending market |
| qiETH | `0x334AD834Cd4481BB02d09615E7c11a00579A7909` | WETH.e lending market |

Protocol ID: `keccak256("benqi")`

### sAVAX (Liquid Staking)

| Contract | Address | Role |
|---|---|---|
| StakedAvax (sAVAX) | `0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE` | AVAX liquid staking derivative |

Protocol ID: `keccak256("savax")`

### Tokens

| Token | Address | Decimals |
|---|---|---|
| WAVAX | `0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7` | 18 |
| USDC | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | 6 |
| USDCe | `0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664` | 6 |
| USDT | `0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7` | 6 |
| USDTe | `0xc7198437980c041c805A1EDcbA50c1Ce5db95118` | 6 |
| WETHe | `0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB` | 18 |
| sAVAX | `0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE` | 18 |

---

## Architecture

### BeaconProxy Pattern (V2)

```
User -> PanoramaExecutorV2.execute(protocolId, action, transfers, deadline, data)
          |
          +-- looks up UpgradeableBeacon for protocolId
          +-- creates or retrieves user's BeaconProxy
          +-- pulls tokens from user to proxy (transfers[])
          +-- calls proxy.call(action ++ data)  -- blind dispatch
                |
                +-- BeaconProxy delegates to Adapter implementation
```

- `beacon.upgradeTo(newImpl)` upgrades ALL users at once
- Adapters use `Initializable` + `__gap[50]` for storage stability
- Executor never contains action-specific logic

### Protocol IDs

Protocol IDs are `bytes32 = keccak256(protocolName)`. Backend uses `encodeProtocolId("name")` from `utils/encoding.ts`.

| Protocol | Name String | Chain |
|---|---|---|
| Aerodrome | `"aerodrome"` | Base |
| Trader Joe | `"traderjoe"` | Avalanche |
| Benqi | `"benqi"` | Avalanche |
| sAVAX | `"savax"` | Avalanche |

### Adapter Conventions

All V2 adapters share:
- `initializeFull(address _executor, bytes calldata _initArgs) external initializer`
- `onlyExecutor` modifier (reverts with `OnlyExecutor()` custom error)
- `receive() external payable {}`
- `uint256[50] private __gap` for upgrade safety
- Custom errors (no `require` strings)

Known differences (deployed, cannot change):
- **AerodromeAdapterV2**: uses `SafeTransferLib` + double `safeApprove(0); safeApprove(amt)`
- **Avax adapters**: use OpenZeppelin `SafeERC20` + `forceApprove()`
- **BenqiLendAdapter**: has parameterized error `BenqiError(uint256)` for Comptroller error codes

### Environment Variables

```bash
# Base
BASE_RPC_URLS=https://base.llamarpc.com,https://mainnet.base.org,https://base.drpc.org
EXECUTOR_ADDRESS=0x7528861E7DD09dc9B1e5149542e897d984Ceda7f

# Avalanche
AVAX_RPC_URLS=https://api.avax.network/ext/bc/C/rpc,https://avalanche.drpc.org,https://avax.meowrpc.com
AVAX_EXECUTOR_ADDRESS=0xc35059D1BC395Ff0F6fDcEA1b7F365E3aa7C1D12
```
