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

const CORRELATION_ID =
  "88888888-aaaa-4bbb-8ccc-dddddddddddd";

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

vi.mock(
  "../../../providers/chain.provider",
  () => ({
    getProvider: vi.fn(() => ({
      estimateGas: mockEstimateGas,
    })),
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
  executePrepareRedeem,
} from "../../../modules/avax-liquid-staking/usecases/prepare-redeem.usecase";

import {
  PANORAMA_EXECUTOR_ABI_EXECUTE,
  SAVAX_SELECTORS,
} from "../../../shared/bundle-builder";

describe(
  "executePrepareRedeem evidence-bound migration",
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
      "preserves sAVAX redeem semantics through the evidence boundary",
      async () => {
        const userUnlockIndex = 3;

        const result =
          await executePrepareRedeem({
            userAddress: USER,
            userUnlockIndex,
          });

        const evidenceResult =
          result as any;

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

        expect(
          result.bundle.totalSteps
        ).toBe(1);

        expect(
          result.bundle.steps
        ).toHaveLength(1);

        const redeem =
          result.bundle.steps[0];

        expect(redeem.to)
          .toBe(EXECUTOR);

        expect(redeem.value)
          .toBe("0");

        expect(redeem.chainId)
          .toBe(43114);

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
            ethers.toUtf8Bytes("savax")
          )
        );

        expect(decoded[1]).toBe(
          SAVAX_SELECTORS.REDEEM
        );

        expect(decoded[2])
          .toHaveLength(0);

        const adapterDecoded =
          ethers.AbiCoder
            .defaultAbiCoder()
            .decode(
              ["uint256", "address"],
              decoded[4]
            );

        expect(
          adapterDecoded[0].toString()
        ).toBe(
          userUnlockIndex.toString()
        );

        expect(
          adapterDecoded[1]
            .toLowerCase()
        ).toBe(
          USER.toLowerCase()
        );

        expect(result.metadata)
          .toEqual({
            action: "redeem",
            userUnlockIndex,
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
          mockEstimateGas
            .mock.invocationCallOrder[0]
        );

        expect(
          mockEstimateGas
            .mock.invocationCallOrder[0]
        ).toBeLessThan(
          mockPersistPreparedEvidence
            .mock.invocationCallOrder[0]
        );
      }
    );
  }
);
