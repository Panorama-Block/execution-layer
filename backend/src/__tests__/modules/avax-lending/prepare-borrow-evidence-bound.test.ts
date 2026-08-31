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

const USDC_E =
  "0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664";

const CORRELATION_ID =
  "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa";

const {
  mockEstimateGas,
  mockCreateEvidenceCorrelation,
  mockPersistEvidenceIntent,
  mockPersistPreparedEvidence,
} = vi.hoisted(() => ({
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
      panoramaExecutor:
        "0xc35059D1BC395Ff0F6fDcEA1b7F365E3aa7C1D12",
    },
  })),
}));

vi.mock("../../../providers/chain.provider", () => ({
  getProvider: vi.fn(() => ({
    estimateGas: mockEstimateGas,
  })),
}));

vi.mock(
  "../../../modules/avax-lending/config/avax-lending-markets",
  () => ({
    getMarketByQToken: vi.fn((address: string) => {
      const normalized = address.toLowerCase();

      if (normalized === QI_AVAX) {
        return {
          qTokenAddress: QI_AVAX,
          qTokenSymbol: "qiAVAX",
          underlyingAddress: undefined,
          underlyingSymbol: "AVAX",
          isNative: true,
        };
      }

      if (normalized === QI_USDCE) {
        return {
          qTokenAddress: QI_USDCE,
          qTokenSymbol: "qiUSDC",
          underlyingAddress: USDC_E,
          underlyingSymbol: "USDC.e",
          isNative: false,
        };
      }

      return undefined;
    }),
  })
);

vi.mock(
  "../../../shared/services/transaction-evidence.service",
  () => ({
    createEvidenceCorrelation: mockCreateEvidenceCorrelation,
    persistEvidenceIntent: mockPersistEvidenceIntent,
    persistPreparedEvidence: mockPersistPreparedEvidence,
  })
);

import {
  executePrepareBorrow,
} from "../../../modules/avax-lending/usecases/prepare-borrow.usecase";

import {
  BENQI_SELECTORS,
  PANORAMA_EXECUTOR_ABI_EXECUTE,
} from "../../../shared/bundle-builder";

describe("executePrepareBorrow evidence-bound migration", () => {
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

  it("preserves native AVAX borrow semantics through the evidence boundary", async () => {
    const amount = "1000000000000000000";

    const result = await executePrepareBorrow({
      userAddress: USER,
      qTokenAddress: QI_AVAX,
      amount,
    });

    const evidenceResult = result as any;

    expect(evidenceResult.correlationId)
      .toBe(CORRELATION_ID);

    expect(evidenceResult.evidenceVersion)
      .toBe("1.0");

    expect(evidenceResult.evidenceEnabled)
      .toBe(true);

    expect(evidenceResult.preparedPayloadHash)
      .toMatch(/^0x[a-fA-F0-9]{64}$/);

    expect(result.bundle.totalSteps).toBe(1);
    expect(result.bundle.steps).toHaveLength(1);

    const borrow = result.bundle.steps[0];

    expect(borrow.to).toBe(EXECUTOR);
    expect(borrow.value).toBe("0");
    expect(borrow.chainId).toBe(43114);

    const executorInterface =
      new ethers.Interface(
        PANORAMA_EXECUTOR_ABI_EXECUTE
      );

    const decoded =
      executorInterface.decodeFunctionData(
        "execute",
        borrow.data
      );

    expect(decoded[0]).toBe(
      ethers.keccak256(
        ethers.toUtf8Bytes("benqi")
      )
    );

    expect(decoded[1]).toBe(
      BENQI_SELECTORS.BORROW_AVAX
    );

    expect(decoded[2]).toHaveLength(0);

    const adapterDecoded =
      ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256", "address"],
        decoded[4]
      );

    expect(adapterDecoded[0]).toBe(BigInt(amount));
    expect(adapterDecoded[1]).toBe(USER);

    expect(result.metadata).toEqual({
      action: "borrow",
      qTokenAddress: QI_AVAX,
      qTokenSymbol: "qiAVAX",
      underlyingSymbol: "AVAX",
      amount,
      isNative: true,
    });

    expect(mockPersistEvidenceIntent)
      .toHaveBeenCalledTimes(1);

    expect(mockPersistPreparedEvidence)
      .toHaveBeenCalledTimes(1);

    expect(
      mockPersistPreparedEvidence.mock.calls[0][1]
    ).toBe(result.bundle);
  });

  it("preserves ERC-20 borrow semantics and evidence ordering", async () => {
    const amount = "1000000";

    const result = await executePrepareBorrow({
      userAddress: USER,
      qTokenAddress: QI_USDCE,
      amount,
    });

    const evidenceResult = result as any;

    expect(evidenceResult.correlationId)
      .toBe(CORRELATION_ID);

    expect(evidenceResult.evidenceEnabled)
      .toBe(true);

    expect(result.bundle.totalSteps).toBe(1);
    expect(result.bundle.steps).toHaveLength(1);

    const borrow = result.bundle.steps[0];

    expect(borrow.to).toBe(EXECUTOR);
    expect(borrow.value).toBe("0");
    expect(borrow.chainId).toBe(43114);

    const executorInterface =
      new ethers.Interface(
        PANORAMA_EXECUTOR_ABI_EXECUTE
      );

    const decoded =
      executorInterface.decodeFunctionData(
        "execute",
        borrow.data
      );

    expect(decoded[1]).toBe(
      BENQI_SELECTORS.BORROW
    );

    expect(decoded[2]).toHaveLength(0);

    const adapterDecoded =
      ethers.AbiCoder.defaultAbiCoder().decode(
        ["address", "uint256", "address"],
        decoded[4]
      );

    expect(
      adapterDecoded[0].toLowerCase()
    ).toBe(QI_USDCE);

    expect(adapterDecoded[1]).toBe(BigInt(amount));
    expect(adapterDecoded[2]).toBe(USER);

    expect(result.metadata).toEqual({
      action: "borrow",
      qTokenAddress: QI_USDCE,
      qTokenSymbol: "qiUSDC",
      underlyingSymbol: "USDC.e",
      amount,
      isNative: false,
    });

    // T1 intent persistence must precede T2 bundle preparation.
    expect(
      mockPersistEvidenceIntent.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mockEstimateGas.mock.invocationCallOrder[0]
    );

    // T3 commitment persistence must follow preparation.
    expect(
      mockEstimateGas.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mockPersistPreparedEvidence.mock.invocationCallOrder[0]
    );
  });
});
