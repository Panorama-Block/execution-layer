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

const SAVAX =
  "0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE";

const USER =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const CORRELATION_ID =
  "77777777-aaaa-4bbb-8ccc-dddddddddddd";

const {
  mockEstimateGas,
  mockCheckAllowance,
  mockCreateEvidenceCorrelation,
  mockPersistEvidenceIntent,
  mockPersistPreparedEvidence,
} = vi.hoisted(() => ({
  mockEstimateGas: vi.fn(),
  mockCheckAllowance: vi.fn(),
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

vi.mock(
  "../../../providers/chain.provider",
  () => ({
    getProvider: vi.fn(() => ({
      estimateGas: mockEstimateGas,
    })),
  })
);

vi.mock(
  "../../../shared/services/avax.service",
  () => ({
    avaxService: {
      checkAllowance: mockCheckAllowance,
    },
  })
);

vi.mock(
  "../../../shared/services/transaction-evidence.service",
  () => ({
    createEvidenceCorrelation:
      mockCreateEvidenceCorrelation,
    persistEvidenceIntent:
      mockPersistEvidenceIntent,
    persistPreparedEvidence:
      mockPersistPreparedEvidence,
  })
);

import {
  executePrepareRequestUnlock,
} from "../../../modules/avax-liquid-staking/usecases/prepare-request-unlock.usecase";

import {
  ERC20_APPROVE_ABI,
  PANORAMA_EXECUTOR_ABI_EXECUTE,
  SAVAX_SELECTORS,
} from "../../../shared/bundle-builder";

describe(
  "executePrepareRequestUnlock evidence-bound migration",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      mockEstimateGas.mockResolvedValue(100_000n);

      mockCreateEvidenceCorrelation.mockReturnValue({
        correlationId: CORRELATION_ID,
        evidenceVersion: "1.0",
        enabled: true,
      });

      mockPersistEvidenceIntent.mockResolvedValue(
        undefined
      );

      mockPersistPreparedEvidence.mockImplementation(
        async (_intent, bundle) => ({
          correlationId: CORRELATION_ID,
          evidenceVersion: "1.0",
          evidenceEnabled: true,
          preparedPayloadHash: ethers.keccak256(
            ethers.toUtf8Bytes(
              JSON.stringify(bundle)
            )
          ),
        })
      );
    });

    it(
      "preserves approval then requestUnlock semantics through the evidence boundary",
      async () => {
        const amount =
          "100000000000000000";

        mockCheckAllowance.mockResolvedValue(0n);

        const result =
          await executePrepareRequestUnlock({
            userAddress: USER,
            sAvaxAmount: amount,
          });

        const evidenceResult = result as any;

        expect(
          evidenceResult.correlationId
        ).toBe(CORRELATION_ID);

        expect(
          evidenceResult.evidenceVersion
        ).toBe("1.0");

        expect(
          evidenceResult.evidenceEnabled
        ).toBe(true);

        expect(
          evidenceResult.preparedPayloadHash
        ).toMatch(
          /^0x[a-fA-F0-9]{64}$/
        );

        expect(result.bundle.totalSteps).toBe(2);
        expect(result.bundle.steps).toHaveLength(2);

        const approval = result.bundle.steps[0];
        const unlock = result.bundle.steps[1];

        expect(
          approval.to.toLowerCase()
        ).toBe(SAVAX.toLowerCase());

        expect(approval.value).toBe("0");
        expect(approval.chainId).toBe(43114);

        const approveInterface =
          new ethers.Interface(
            ERC20_APPROVE_ABI
          );

        const approveDecoded =
          approveInterface.decodeFunctionData(
            "approve",
            approval.data
          );

        expect(
          approveDecoded[0].toLowerCase()
        ).toBe(EXECUTOR.toLowerCase());

        expect(
          approveDecoded[1].toString()
        ).toBe(amount);

        expect(unlock.to).toBe(EXECUTOR);
        expect(unlock.value).toBe("0");
        expect(unlock.chainId).toBe(43114);

        const executorInterface =
          new ethers.Interface(
            PANORAMA_EXECUTOR_ABI_EXECUTE
          );

        const decoded =
          executorInterface.decodeFunctionData(
            "execute",
            unlock.data
          );

        expect(decoded[0]).toBe(
          ethers.keccak256(
            ethers.toUtf8Bytes("savax")
          )
        );

        expect(decoded[1]).toBe(
          SAVAX_SELECTORS.REQUEST_UNLOCK
        );

        expect(decoded[2]).toHaveLength(1);

        expect(
          decoded[2][0].token.toLowerCase()
        ).toBe(SAVAX.toLowerCase());

        expect(
          decoded[2][0].amount.toString()
        ).toBe(amount);

        const adapterDecoded =
          ethers.AbiCoder
            .defaultAbiCoder()
            .decode(
              ["uint256"],
              decoded[4]
            );

        expect(
          adapterDecoded[0].toString()
        ).toBe(amount);

        expect(result.metadata).toEqual({
          action: "requestUnlock",
          sAvaxAmount: amount,
          estimatedAvax: amount,
          cooldownDays: 15,
        });

        expect(
          mockPersistEvidenceIntent
        ).toHaveBeenCalledTimes(1);

        expect(
          mockPersistPreparedEvidence
        ).toHaveBeenCalledTimes(1);

        expect(
          mockPersistEvidenceIntent
            .mock.invocationCallOrder[0]
        ).toBeLessThan(
          mockCheckAllowance
            .mock.invocationCallOrder[0]
        );

        expect(
          mockCheckAllowance
            .mock.invocationCallOrder[0]
        ).toBeLessThan(
          mockPersistPreparedEvidence
            .mock.invocationCallOrder[0]
        );
      }
    );

    it(
      "preserves single-step requestUnlock when approval is already sufficient",
      async () => {
        const amount =
          "100000000000000000";

        mockCheckAllowance.mockResolvedValue(
          BigInt(amount)
        );

        const result =
          await executePrepareRequestUnlock({
            userAddress: USER,
            sAvaxAmount: amount,
          });

        expect(result.bundle.totalSteps).toBe(1);
        expect(result.bundle.steps).toHaveLength(1);

        const unlock = result.bundle.steps[0];

        expect(unlock.to).toBe(EXECUTOR);
        expect(unlock.value).toBe("0");
        expect(unlock.chainId).toBe(43114);

        expect(
          mockPersistEvidenceIntent
        ).toHaveBeenCalledTimes(1);

        expect(
          mockPersistPreparedEvidence
        ).toHaveBeenCalledTimes(1);
      }
    );
  }
);
