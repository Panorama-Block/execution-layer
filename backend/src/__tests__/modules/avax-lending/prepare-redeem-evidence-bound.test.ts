import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ethers } from "ethers";

const EXECUTOR =
  "0xc35059D1BC395Ff0F6fDcEA1b7F365E3aa7C1D12";

const USER =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const QI_AVAX =
  "0x5c0401e81bc07ca70fad469b451682c0d747ef1c";

const QI_USDCE =
  "0xbeb5d47a3f720ec0a390d04b4d41ed7d9688bc7f";

const CORRELATION_ID =
  "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

const {
  mockCheckAllowance,
  mockEstimateGas,
  mockExchangeRateStored,
  mockBalanceOf,
  mockCreateEvidenceCorrelation,
  mockPersistEvidenceIntent,
  mockPersistPreparedEvidence,
} = vi.hoisted(() => ({
  mockCheckAllowance: vi.fn(),
  mockEstimateGas: vi.fn(),
  mockExchangeRateStored: vi.fn(),
  mockBalanceOf: vi.fn(),
  mockCreateEvidenceCorrelation: vi.fn(),
  mockPersistEvidenceIntent: vi.fn(),
  mockPersistPreparedEvidence: vi.fn(),
}));

vi.mock("../../../config/chains", () => ({
  getChainConfig: vi.fn(() => ({
    chainId: 43114,
    name: "Avalanche",
    contracts: {
      panoramaExecutor:
        "0xc35059D1BC395Ff0F6fDcEA1b7F365E3aa7C1D12",
    },
  })),
}));

vi.mock("../../../providers/chain.provider", () => ({
  getProvider: vi.fn(() => ({
    estimateGas: mockEstimateGas,
  })),
  getContract: vi.fn(() => ({
    exchangeRateStored: mockExchangeRateStored,
    balanceOf: mockBalanceOf,
  })),
}));

vi.mock("../../../shared/services/avax.service", () => ({
  BENQI_MARKETS: {
    qiAVAX: {
      address:
        "0x5c0401e81bc07ca70fad469b451682c0d747ef1c",
      symbol: "qiAVAX",
      underlyingSymbol: "AVAX",
      isNative: true,
    },
    qiUSDCe: {
      address:
        "0xbeb5d47a3f720ec0a390d04b4d41ed7d9688bc7f",
      symbol: "qiUSDC",
      underlyingSymbol: "USDC.e",
      isNative: false,
    },
    qiUSDT: {
      address:
        "0xc9e5999b8e75c3feb117f6f73e664b9f3c8ca65c",
      symbol: "qiUSDT",
      underlyingSymbol: "USDT",
      isNative: false,
    },
    qiETH: {
      address:
        "0x334ad834cd4481bb02d09615e7c11a00579a7909",
      symbol: "qiETH",
      underlyingSymbol: "WETH.e",
      isNative: false,
    },
  },
  AVAX_TOKENS: {
    USDCe: {
      address:
        "0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664",
    },
    USDT: {
      address:
        "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7",
    },
    WETH: {
      address:
        "0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab",
    },
  },
  avaxService: {
    checkAllowance: mockCheckAllowance,
  },
}));

vi.mock(
  "../../../shared/services/transaction-evidence.service",
  () => ({
    createEvidenceCorrelation: mockCreateEvidenceCorrelation,
    persistEvidenceIntent: mockPersistEvidenceIntent,
    persistPreparedEvidence: mockPersistPreparedEvidence,
  })
);

import {
  executePrepareRedeem,
} from "../../../modules/avax-lending/usecases/prepare-redeem.usecase";

import {
  BENQI_SELECTORS,
  ERC20_APPROVE_ABI,
  PANORAMA_EXECUTOR_ABI_EXECUTE,
} from "../../../shared/bundle-builder";

describe("executePrepareRedeem evidence-bound migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockEstimateGas.mockResolvedValue(100_000n);

    mockCreateEvidenceCorrelation.mockReturnValue({
      correlationId: CORRELATION_ID,
      evidenceVersion: "1.0",
      enabled: true,
    });

    mockPersistEvidenceIntent.mockResolvedValue(undefined);

    mockPersistPreparedEvidence.mockImplementation(
      async (_intent, bundle) => ({
        correlationId: CORRELATION_ID,
        evidenceVersion: "1.0",
        evidenceEnabled: true,
        preparedPayloadHash: ethers.keccak256(
          ethers.toUtf8Bytes(JSON.stringify(bundle))
        ),
      })
    );
  });

  it("preserves native qiAVAX redeem semantics through the evidence boundary", async () => {
    const underlyingAmount = "1000000000000000000";
    const exchangeRate =
      200000000000000000000000000n;
    const expectedQTokenAmount = 5_000_000_000n;

    mockExchangeRateStored.mockResolvedValue(exchangeRate);
    mockBalanceOf.mockResolvedValue(6_000_000_000n);
    mockCheckAllowance.mockResolvedValue(
      expectedQTokenAmount
    );

    const result = await executePrepareRedeem({
      userAddress: USER,
      qTokenAddress: QI_AVAX,
      amount: underlyingAmount,
    });

    expect(result.correlationId).toBe(CORRELATION_ID);
    expect(result.evidenceVersion).toBe("1.0");
    expect(result.evidenceEnabled).toBe(true);
    expect(result.preparedPayloadHash).toMatch(
      /^0x[a-fA-F0-9]{64}$/
    );

    expect(result.bundle.totalSteps).toBe(1);
    expect(result.bundle.steps).toHaveLength(1);

    const redeem = result.bundle.steps[0];

    expect(redeem.to).toBe(EXECUTOR);
    expect(redeem.value).toBe("0");
    expect(redeem.chainId).toBe(43114);

    const executorInterface =
      new ethers.Interface(
        PANORAMA_EXECUTOR_ABI_EXECUTE
      );

    const decoded =
      executorInterface.decodeFunctionData(
        "execute",
        redeem.data
      );

    expect(decoded[0]).toBe(
      ethers.keccak256(
        ethers.toUtf8Bytes("benqi")
      )
    );

    expect(decoded[1]).toBe(
      BENQI_SELECTORS.REDEEM_AVAX
    );

    expect(decoded[2]).toHaveLength(1);
    expect(
      decoded[2][0].token.toLowerCase()
    ).toBe(QI_AVAX.toLowerCase());
    expect(decoded[2][0].amount).toBe(
      expectedQTokenAmount
    );

    const adapterDecoded =
      ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256", "address"],
        decoded[4]
      );

    expect(adapterDecoded[0]).toBe(
      expectedQTokenAmount
    );
    expect(adapterDecoded[1]).toBe(USER);

    expect(result.metadata).toEqual({
      action: "redeem",
      qTokenAddress: QI_AVAX,
      qTokenSymbol: "qiAVAX",
      underlyingSymbol: "AVAX",
      qTokenAmount:
        expectedQTokenAmount.toString(),
      isNative: true,
    });

    expect(mockPersistEvidenceIntent)
      .toHaveBeenCalledTimes(1);

    expect(mockPersistPreparedEvidence)
      .toHaveBeenCalledTimes(1);

    expect(
      mockPersistPreparedEvidence.mock.calls[0][1]
    ).toBe(result.bundle);

    // Evidence ordering invariant:
    // T1 persist intent → T2 read/prepare → T3 persist commitment.
    expect(
      mockPersistEvidenceIntent.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mockExchangeRateStored.mock.invocationCallOrder[0]
    );

    expect(
      mockPersistEvidenceIntent.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mockBalanceOf.mock.invocationCallOrder[0]
    );

    expect(
      mockExchangeRateStored.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mockPersistPreparedEvidence.mock.invocationCallOrder[0]
    );

    expect(
      mockBalanceOf.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mockPersistPreparedEvidence.mock.invocationCallOrder[0]
    );
  });

  it("preserves qToken approval then ERC-20 redeem ordering and semantics", async () => {
    const underlyingAmount = "1000000";
    const exchangeRate =
      200000000000000n;
    const expectedQTokenAmount = 5_000_000_000n;

    mockExchangeRateStored.mockResolvedValue(exchangeRate);
    mockBalanceOf.mockResolvedValue(10_000_000_000n);
    mockCheckAllowance.mockResolvedValue(0n);

    const result = await executePrepareRedeem({
      userAddress: USER,
      qTokenAddress: QI_USDCE,
      amount: underlyingAmount,
    });

    expect(result.correlationId).toBe(CORRELATION_ID);
    expect(result.evidenceEnabled).toBe(true);

    expect(result.bundle.totalSteps).toBe(2);
    expect(result.bundle.steps).toHaveLength(2);

    const approval = result.bundle.steps[0];
    const redeem = result.bundle.steps[1];

    expect(approval.to.toLowerCase()).toBe(
      QI_USDCE.toLowerCase()
    );
    expect(approval.value).toBe("0");
    expect(approval.chainId).toBe(43114);

    const approveInterface =
      new ethers.Interface(ERC20_APPROVE_ABI);

    const approveDecoded =
      approveInterface.decodeFunctionData(
        "approve",
        approval.data
      );

    expect(
      approveDecoded[0].toLowerCase()
    ).toBe(EXECUTOR.toLowerCase());

    expect(approveDecoded[1]).toBe(
      expectedQTokenAmount
    );

    expect(redeem.to).toBe(EXECUTOR);
    expect(redeem.value).toBe("0");
    expect(redeem.chainId).toBe(43114);

    const executorInterface =
      new ethers.Interface(
        PANORAMA_EXECUTOR_ABI_EXECUTE
      );

    const decoded =
      executorInterface.decodeFunctionData(
        "execute",
        redeem.data
      );

    expect(decoded[1]).toBe(
      BENQI_SELECTORS.REDEEM
    );

    expect(decoded[2]).toHaveLength(1);
    expect(
      decoded[2][0].token.toLowerCase()
    ).toBe(QI_USDCE.toLowerCase());
    expect(decoded[2][0].amount).toBe(
      expectedQTokenAmount
    );

    const adapterDecoded =
      ethers.AbiCoder.defaultAbiCoder().decode(
        ["address", "uint256", "address"],
        decoded[4]
      );

    expect(
      adapterDecoded[0].toLowerCase()
    ).toBe(QI_USDCE.toLowerCase());

    expect(adapterDecoded[1]).toBe(
      expectedQTokenAmount
    );

    expect(adapterDecoded[2]).toBe(USER);

    expect(mockCheckAllowance).toHaveBeenCalledWith(
      QI_USDCE,
      USER,
      EXECUTOR,
      expectedQTokenAmount
    );

    expect(mockPersistPreparedEvidence)
      .toHaveBeenCalledTimes(1);
  });

  it("caps the derived qToken amount at the wallet's actual balance", async () => {
    const underlyingAmount = "1000000000000000000";
    const walletQTokenBalance = 123_456_789n;

    mockExchangeRateStored.mockResolvedValue(
      200000000000000000000000000n
    );

    mockBalanceOf.mockResolvedValue(
      walletQTokenBalance
    );

    mockCheckAllowance.mockResolvedValue(
      walletQTokenBalance
    );

    const result = await executePrepareRedeem({
      userAddress: USER,
      qTokenAddress: QI_AVAX,
      amount: underlyingAmount,
    });

    expect(result.metadata.qTokenAmount).toBe(
      walletQTokenBalance.toString()
    );

    const executorInterface =
      new ethers.Interface(
        PANORAMA_EXECUTOR_ABI_EXECUTE
      );

    const decoded =
      executorInterface.decodeFunctionData(
        "execute",
        result.bundle.steps[0].data
      );

    const adapterDecoded =
      ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256", "address"],
        decoded[4]
      );

    expect(adapterDecoded[0]).toBe(
      walletQTokenBalance
    );
  });
});
