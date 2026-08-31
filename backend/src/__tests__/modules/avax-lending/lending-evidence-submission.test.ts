import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSubmitAndVerifyEvidence,
  mockVerifyEvidenceStep,
} = vi.hoisted(() => ({
  mockSubmitAndVerifyEvidence: vi.fn(),
  mockVerifyEvidenceStep: vi.fn(),
}));

vi.mock(
  "../../../shared/services/transaction-evidence.service",
  () => ({
    submitAndVerifyEvidence: mockSubmitAndVerifyEvidence,
    verifyEvidenceStep: mockVerifyEvidenceStep,
  })
);

import {
  submitEvidence,
  verifyEvidence,
} from "../../../modules/avax-lending/controllers/avax-lending.controller";

function invokeHandler(
  handler: any,
  req: any
): Promise<{
  json: ReturnType<typeof vi.fn>;
  next: ReturnType<typeof vi.fn>;
}> {
  return new Promise((resolve, reject) => {
    const json = vi.fn(() => {
      resolve({ json, next });
    });

    const next = vi.fn((err?: unknown) => {
      if (err) {
        reject(err);
        return;
      }

      resolve({ json, next });
    });

    handler(
      req,
      { json } as any,
      next
    );
  });
}

describe("Avalanche lending evidence submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockSubmitAndVerifyEvidence.mockResolvedValue({
      correlationId: "corr-123",
      stepIndex: 0,
      txHash:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      verified: true,
    });

    mockVerifyEvidenceStep.mockResolvedValue({
      correlationId: "corr-123",
      stepIndex: 0,
      txHash:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      verified: true,
    });
  });

  it("submits lending evidence through the generic Avalanche verifier", async () => {
    const txHash =
      "0x1111111111111111111111111111111111111111111111111111111111111111";

    const { json } = await invokeHandler(
      submitEvidence,
      {
        params: {
          correlationId: "corr-123",
        },
        body: {
          stepIndex: 0,
          txHash,
          executionMechanism: "thirdweb-client",
          providerMetadata: {
            provider: "thirdweb",
          },
        },
      }
    );

    expect(
      mockSubmitAndVerifyEvidence
    ).toHaveBeenCalledTimes(1);

    expect(
      mockSubmitAndVerifyEvidence
    ).toHaveBeenCalledWith({
      correlationId: "corr-123",
      stepIndex: 0,
      txHash,
      executionMechanism: "thirdweb-client",
      providerMetadata: {
        provider: "thirdweb",
      },
      chain: "avalanche",
    });

    expect(json).toHaveBeenCalledWith({
      correlationId: "corr-123",
      stepIndex: 0,
      txHash,
      verified: true,
    });
  });
  it(
    "re-verifies persisted evidence without accepting a transaction hash",
    async () => {
      const { json } = await invokeHandler(
        verifyEvidence,
        {
          params: {
            correlationId: "corr-123",
          },
          body: {
            stepIndex: 0,
          },
        }
      );

      expect(
        mockVerifyEvidenceStep
      ).toHaveBeenCalledTimes(1);

      expect(
        mockVerifyEvidenceStep
      ).toHaveBeenCalledWith({
        correlationId: "corr-123",
        stepIndex: 0,
      });

      expect(json).toHaveBeenCalledWith({
        correlationId: "corr-123",
        stepIndex: 0,
        txHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        verified: true,
      });
    }
  );

});
