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

const WAVAX =
  "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";

const USDC =
  "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";

const USER =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const CORRELATION_ID =
  "11111111-2222-4333-8444-555555555555";

const {
  mockGetQuoteWithHop,
  mockCheckAllowance,
  mockEstimateGas,
  mockCreateEvidenceCorrelation,
  mockPersistEvidenceIntent,
  mockPersistPreparedEvidence,
} = vi.hoisted(() => ({
  mockGetQuoteWithHop: vi.fn(),
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
  WAVAX: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
  avaxService: {
    getQuoteWithHop: mockGetQuoteWithHop,
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
  executePrepareAvaxSwap,
} from "../../../modules/avax-swap/usecases/prepare-swap.usecase";

import {
  ERC20_APPROVE_ABI,
  PANORAMA_EXECUTOR_ABI_EXECUTE,
  TRADERJOE_SELECTORS,
} from "../../../shared/bundle-builder";

describe("executePrepareAvaxSwap evidence-bound migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockEstimateGas.mockResolvedValue(100_000n);

    mockGetQuoteWithHop.mockResolvedValue({
      amountOut: 2_000_000n,
      path: [USDC, WAVAX],
    });

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
        preparedPayloadHash:
          ethers.keccak256(
            ethers.toUtf8Bytes(JSON.stringify(bundle))
          ),
      })
    );
  });

  it("preserves ERC-20 TraderJoe transaction semantics through the evidence boundary", async () => {
    const result = await executePrepareAvaxSwap({
      userAddress: USER,
      tokenIn: USDC,
      tokenOut: WAVAX,
      amountIn: "1000000",
      slippageBps: 50,
      deadlineMinutes: 20,
    });

    expect(result.correlationId).toBe(CORRELATION_ID);
    expect(result.evidenceVersion).toBe("1.0");
    expect(result.evidenceEnabled).toBe(true);

    expect(result.bundle.totalSteps).toBe(2);
    expect(result.bundle.steps).toHaveLength(2);

    const approve = result.bundle.steps[0];

    expect(approve.to).toBe(USDC);
    expect(approve.value).toBe("0");
    expect(approve.chainId).toBe(43114);
    expect(approve.gas).toBe("0x1fbd0");

    const approveInterface =
      new ethers.Interface(ERC20_APPROVE_ABI);

    const approveDecoded =
      approveInterface.decodeFunctionData(
        "approve",
        approve.data
      );

    expect(approveDecoded[0]).toBe(EXECUTOR);
    expect(approveDecoded[1]).toBe(1_000_000n);

    const execute = result.bundle.steps[1];

    expect(execute.to).toBe(EXECUTOR);
    expect(execute.value).toBe("0");
    expect(execute.chainId).toBe(43114);
    expect(execute.gas).toBeUndefined();

    const executorInterface =
      new ethers.Interface(
        PANORAMA_EXECUTOR_ABI_EXECUTE
      );

    const decoded =
      executorInterface.decodeFunctionData(
        "execute",
        execute.data
      );

    expect(decoded[0]).toBe(
      ethers.keccak256(
        ethers.toUtf8Bytes("traderjoe")
      )
    );

    expect(decoded[1]).toBe(
      TRADERJOE_SELECTORS.SWAP_WITH_PATH
    );

    expect(decoded[2]).toHaveLength(1);
    expect(decoded[2][0].token).toBe(USDC);
    expect(decoded[2][0].amount).toBe(1_000_000n);

    expect(Number(decoded[3])).toBeGreaterThan(
      Math.floor(Date.now() / 1000)
    );

    const adapterDecoded =
      ethers.AbiCoder.defaultAbiCoder().decode(
        [
          "uint256",
          "uint256",
          "address[]",
          "address",
        ],
        decoded[4]
      );

    expect(adapterDecoded[0]).toBe(1_000_000n);
    expect(adapterDecoded[1]).toBe(1_990_000n);

    expect(
      adapterDecoded[2].map(
        (address: string) => address.toLowerCase()
      )
    ).toEqual([
      USDC.toLowerCase(),
      WAVAX.toLowerCase(),
    ]);

    expect(adapterDecoded[3]).toBe(USER);

    expect(result.metadata).toMatchObject({
      tokenIn: USDC,
      tokenOut: WAVAX,
      amountIn: "1000000",
      amountOut: "2000000",
      amountOutMin: "1990000",
      path: [USDC, WAVAX],
      swapType: "token-to-avax",
      slippageBps: 50,
    });

    expect(mockPersistEvidenceIntent)
      .toHaveBeenCalledTimes(1);

    expect(mockPersistPreparedEvidence)
      .toHaveBeenCalledTimes(1);

    const persistedBundle =
      mockPersistPreparedEvidence.mock.calls[0][1];

    expect(persistedBundle).toBe(result.bundle);
  });

  it("preserves the existing AVAX/WAVAX wrap transaction semantics", async () => {
    const amount = "1000000000000000000";

    const result = await executePrepareAvaxSwap({
      userAddress: USER,
      tokenIn: WAVAX,
      tokenOut: WAVAX,
      amountIn: amount,
      slippageBps: 50,
    });

    expect(result.bundle.totalSteps).toBe(1);
    expect(result.bundle.steps).toHaveLength(1);

    const step = result.bundle.steps[0];

    expect(step.to).toBe(WAVAX);
    expect(step.value).toBe(amount);
    expect(step.chainId).toBe(43114);
    expect(step.description).toBe(
      "Wrap AVAX → WAVAX"
    );

    const wrapInterface =
      new ethers.Interface([
        "function deposit() external payable",
      ]);

    expect(step.data).toBe(
      wrapInterface.encodeFunctionData(
        "deposit",
        []
      )
    );

    expect(mockGetQuoteWithHop)
      .not.toHaveBeenCalled();

    expect(mockCheckAllowance)
      .not.toHaveBeenCalled();

    expect(mockPersistEvidenceIntent)
      .toHaveBeenCalledTimes(1);

    expect(mockPersistPreparedEvidence)
      .toHaveBeenCalledTimes(1);

    expect(
      mockPersistPreparedEvidence.mock.calls[0][1]
    ).toBe(result.bundle);
  });
});
