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

const USDCE =
  "0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664";

const CORRELATION_ID =
  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const {
  mockCheckAllowance,
  mockEstimateGas,
  mockCreateEvidenceCorrelation,
  mockPersistEvidenceIntent,
  mockPersistPreparedEvidence,
} = vi.hoisted(() => ({
  mockCheckAllowance: vi.fn(),
  mockEstimateGas: vi.fn(),
  mockCreateEvidenceCorrelation: vi.fn(),
  mockPersistEvidenceIntent: vi.fn(),
  mockPersistPreparedEvidence: vi.fn(),
}));

vi.mock("../../../config/chains", () => ({
  getChainConfig: vi.fn(() => ({
    chainId: 43114,
    name: "Avalanche",
    contracts: {
      panoramaExecutor: EXECUTOR,
    },
  })),
}));

vi.mock("../../../providers/chain.provider", () => ({
  getProvider: vi.fn(() => ({
    estimateGas: mockEstimateGas,
  })),
}));

vi.mock("../../../shared/services/avax.service", () => ({
  BENQI_MARKETS: {
    qiAVAX: {
      address: "0x5c0401e81bc07ca70fad469b451682c0d747ef1c",
      symbol: "qiAVAX",
      underlyingSymbol: "AVAX",
      isNative: true,
    },
    qiUSDCe: {
      address: "0xbeb5d47a3f720ec0a390d04b4d41ed7d9688bc7f",
      symbol: "qiUSDC",
      underlyingSymbol: "USDC.e",
      isNative: false,
    },
    qiUSDT: {
      address: "0xc9e5999b8e75c3feb117f6f73e664b9f3c8ca65c",
      symbol: "qiUSDT",
      underlyingSymbol: "USDT",
      isNative: false,
    },
    qiETH: {
      address: "0x334AD834Cd4481BB02d09615E7c11a00579A7909",
      symbol: "qiETH",
      underlyingSymbol: "WETH.e",
      isNative: false,
    },
  },
  AVAX_TOKENS: {
    USDCe: {
      address: "0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664",
    },
    USDT: {
      address: "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7",
    },
    WETH: {
      address: "0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab",
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
  executePrepareSupply,
} from "../../../modules/avax-lending/usecases/prepare-supply.usecase";

import {
  BENQI_SELECTORS,
  ERC20_APPROVE_ABI,
  PANORAMA_EXECUTOR_ABI_EXECUTE,
} from "../../../shared/bundle-builder";

describe("executePrepareSupply evidence-bound migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockEstimateGas.mockResolvedValue(100_000n);
    mockCheckAllowance.mockResolvedValue(0n);

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

  it("preserves native AVAX supply semantics through the evidence boundary", async () => {
    const amount = "1000000000000000000";

    const result = await executePrepareSupply({
      userAddress: USER,
      qTokenAddress: QI_AVAX,
      amount,
    });

    expect(result.correlationId).toBe(CORRELATION_ID);
    expect(result.evidenceVersion).toBe("1.0");
    expect(result.evidenceEnabled).toBe(true);
    expect(result.preparedPayloadHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    expect(result.bundle.totalSteps).toBe(1);
    expect(result.bundle.steps).toHaveLength(1);

    const supply = result.bundle.steps[0];

    expect(supply.to).toBe(EXECUTOR);
    expect(supply.value).toBe(amount);
    expect(supply.chainId).toBe(43114);

    const executorInterface =
      new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);

    const decoded =
      executorInterface.decodeFunctionData(
        "execute",
        supply.data
      );

    expect(decoded[0]).toBe(
      ethers.keccak256(ethers.toUtf8Bytes("benqi"))
    );

    expect(decoded[1]).toBe(BENQI_SELECTORS.SUPPLY_AVAX);
    expect(decoded[2]).toHaveLength(0);

    const adapterDecoded =
      ethers.AbiCoder.defaultAbiCoder().decode(
        ["address"],
        decoded[4]
      );

    expect(adapterDecoded[0]).toBe(USER);

    expect(result.metadata).toEqual({
      action: "supply",
      qTokenAddress: QI_AVAX,
      qTokenSymbol: "qiAVAX",
      underlyingSymbol: "AVAX",
      amount,
      isNative: true,
    });

    expect(mockCheckAllowance).not.toHaveBeenCalled();
    expect(mockPersistEvidenceIntent).toHaveBeenCalledTimes(1);
    expect(mockPersistPreparedEvidence).toHaveBeenCalledTimes(1);

    expect(
      mockPersistPreparedEvidence.mock.calls[0][1]
    ).toBe(result.bundle);
  });

  it("preserves ERC-20 approval then Benqi supply ordering and semantics", async () => {
    const amount = "1000000";

    const result = await executePrepareSupply({
      userAddress: USER,
      qTokenAddress: QI_USDCE,
      amount,
    });

    expect(result.correlationId).toBe(CORRELATION_ID);
    expect(result.evidenceEnabled).toBe(true);

    expect(result.bundle.totalSteps).toBe(2);
    expect(result.bundle.steps).toHaveLength(2);

    const approval = result.bundle.steps[0];
    const supply = result.bundle.steps[1];

    expect(approval.to).toBe(USDCE);
    expect(approval.value).toBe("0");
    expect(approval.chainId).toBe(43114);

    const approveInterface =
      new ethers.Interface(ERC20_APPROVE_ABI);

    const approveDecoded =
      approveInterface.decodeFunctionData(
        "approve",
        approval.data
      );

    expect(approveDecoded[0]).toBe(EXECUTOR);
    expect(approveDecoded[1]).toBe(1_000_000n);

    expect(supply.to).toBe(EXECUTOR);
    expect(supply.value).toBe("0");
    expect(supply.chainId).toBe(43114);

    const executorInterface =
      new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);

    const decoded =
      executorInterface.decodeFunctionData(
        "execute",
        supply.data
      );

    expect(decoded[0]).toBe(
      ethers.keccak256(ethers.toUtf8Bytes("benqi"))
    );

    expect(decoded[1]).toBe(BENQI_SELECTORS.SUPPLY);

    expect(decoded[2]).toHaveLength(1);
    expect(decoded[2][0].token.toLowerCase()).toBe(USDCE.toLowerCase());
    expect(decoded[2][0].amount).toBe(1_000_000n);

    const adapterDecoded =
      ethers.AbiCoder.defaultAbiCoder().decode(
        ["address", "uint256", "address"],
        decoded[4]
      );

    expect(adapterDecoded[0].toLowerCase()).toBe(QI_USDCE.toLowerCase());
    expect(adapterDecoded[1]).toBe(1_000_000n);
    expect(adapterDecoded[2]).toBe(USER);

    expect(mockCheckAllowance).toHaveBeenCalledWith(
      USDCE,
      USER,
      EXECUTOR,
      1_000_000n
    );

    expect(result.metadata).toEqual({
      action: "supply",
      qTokenAddress: QI_USDCE,
      qTokenSymbol: "qiUSDC",
      underlyingSymbol: "USDC.e",
      amount,
      isNative: false,
    });

    expect(mockPersistEvidenceIntent).toHaveBeenCalledTimes(1);
    expect(mockPersistPreparedEvidence).toHaveBeenCalledTimes(1);

    expect(
      mockPersistPreparedEvidence.mock.calls[0][1]
    ).toBe(result.bundle);
  });
});
