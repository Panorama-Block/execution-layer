import { getContract } from "../../../providers/chain.provider";
import { ERC20_ABI } from "../../../utils/abi";
import { getUserAdapterAddress } from "../../../config/protocols";
import { AppError } from "../../../shared/errorCodes";
import {
  METRONOME_COLLATERAL_MARKETS,
  METRONOME_SYNTHETIC_MARKETS,
  MetronomeCollateralMarket,
  MetronomeSyntheticMarket,
} from "../config/metronome-markets";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface CollateralPosition extends MetronomeCollateralMarket {
  shares:    string; // deposit-token balance (shares, 18 decimals in Metronome)
}

export interface DebtPosition extends MetronomeSyntheticMarket {
  debt: string; // outstanding debt in synth base units
}

export interface GetUserPositionResponse {
  userAddress:  string;
  adapterProxy: string; // "" if not yet predictable (protocol unregistered on executor)
  collateral:   CollateralPosition[];
  debt:         DebtPosition[];
}

/**
 * Reads a user's Metronome positions on Base.
 *
 * Metronome credits collateral + debt to the per-user BeaconProxy (adapter clone),
 * NOT the user's EOA. We resolve the deterministic proxy address via
 * `PanoramaExecutorV2.predictUserAdapter(protocolId, user)` and then read
 * `balanceOf(proxy)` on each deposit- and debt-token. The proxy does not need to
 * be deployed — reads on an empty address return 0.
 */
export async function executeGetUserPosition(
  userAddress: string
): Promise<GetUserPositionResponse> {
  if (!userAddress) throw new AppError("MISSING_FIELD", "userAddress is required");

  const adapterProxy = await getUserAdapterAddress(userAddress, "metronome", "base");

  // Pre-registration / lookup failure: return empty position envelope instead of erroring.
  // The frontend can still render "no position" without special-casing.
  if (!adapterProxy || adapterProxy === ZERO_ADDRESS) {
    return {
      userAddress,
      adapterProxy: "",
      collateral:   METRONOME_COLLATERAL_MARKETS.map(m => ({ ...m, shares: "0" })),
      debt:         METRONOME_SYNTHETIC_MARKETS.map(m => ({ ...m, debt: "0" })),
    };
  }

  const [collateral, debt] = await Promise.all([
    Promise.all(
      METRONOME_COLLATERAL_MARKETS.map(async (m) => {
        const depositToken = getContract(m.depositToken, ERC20_ABI, "base");
        const shares = await depositToken.balanceOf(adapterProxy) as bigint;
        return { ...m, shares: shares.toString() };
      })
    ),
    Promise.all(
      METRONOME_SYNTHETIC_MARKETS.map(async (m) => {
        const debtToken = getContract(m.debtToken, ERC20_ABI, "base");
        const bal = await debtToken.balanceOf(adapterProxy) as bigint;
        return { ...m, debt: bal.toString() };
      })
    ),
  ]);

  return { userAddress, adapterProxy, collateral, debt };
}
