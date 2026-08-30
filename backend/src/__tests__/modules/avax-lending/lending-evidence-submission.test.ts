import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSubmitAndVerifyEvidence,
} = vi.hoisted(() => ({
  mockSubmitAndVerifyEvidence: vi.fn(),
}));

vi.mock(
  "../../../shared/services/transaction-evidence.service",
  () => ({
    submitAndVerifyEvidence: mockSubmitAndVerifyEvidence,
  })
);

import {
  submitEvidence,
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
});
