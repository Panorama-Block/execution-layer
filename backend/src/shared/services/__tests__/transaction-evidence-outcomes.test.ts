import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  recordEvidenceExecutionOutcome,
} from "../transaction-evidence.service";

const CORRELATION_ID = "corr-e8";

const HASH_0 =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const HASH_1 =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const response = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify(data),
  } as Response);

function parent() {
  return {
    correlationId: CORRELATION_ID,
    evidenceVersion: "1.0",
    action: "test",
    chainId: 43114,
    network: "avalanche",
    walletAddress:
      "0x1111111111111111111111111111111111111111",
    intent: {},
    preparedPayloadHash: "0xprepared",
    preparedMetadata: {
      totalSteps: 2,
    },
    status: "prepared",
    verificationStatus: null,
  };
}

function step(
  stepIndex: number,
  txHash: string | null
) {
  return {
    id: `${CORRELATION_ID}:${stepIndex}`,
    correlationId: CORRELATION_ID,
    stepIndex,
    action: `step-${stepIndex}`,
    chainId: 43114,
    toAddress:
      "0x2222222222222222222222222222222222222222",
    value: "0",
    dataHash:
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    preparedStepHash:
      "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    txHash,
  };
}

function installGateway(
  step0Hash: string | null,
  step1Hash: string | null
) {
  const patches:
    Array<Record<string, unknown>> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      const url = String(input);
      const method =
        init?.method || "GET";

      if (
        method === "GET" &&
        url.endsWith(
          `/v1/transaction-evidence/${CORRELATION_ID}`
        )
      ) {
        return response({
          data: parent(),
        });
      }

      if (
        method === "GET" &&
        url.endsWith(
          `/v1/transaction-evidence-steps/${CORRELATION_ID}%3A0`
        )
      ) {
        return response({
          data: step(0, step0Hash),
        });
      }

      if (
        method === "GET" &&
        url.endsWith(
          `/v1/transaction-evidence-steps/${CORRELATION_ID}%3A1`
        )
      ) {
        return response({
          data: step(1, step1Hash),
        });
      }

      if (method === "PATCH") {
        patches.push(
          JSON.parse(
            String(
              init?.body || "{}"
            )
          )
        );

        return response({
          data: {},
        });
      }

      throw new Error(
        `Unexpected request: ${method} ${url}`
      );
    })
  );

  return patches;
}

describe(
  "transaction evidence execution outcomes",
  () => {
    beforeEach(() => {
      process.env.PHASE2_EVIDENCE_ENABLED =
        "true";
      process.env.DB_GATEWAY_URL =
        "http://gateway.test";
      process.env.DB_GATEWAY_SERVICE_TOKEN =
        "test-token";
      process.env.DB_GATEWAY_TENANT_ID =
        "panorama-test";
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it(
      "records cancellation before any durable submission exists",
      async () => {
        const patches =
          installGateway(null, null);

        await expect(
          recordEvidenceExecutionOutcome({
            correlationId:
              CORRELATION_ID,
            outcome:
              "cancelled-before-submission",
            reason: "wallet rejected",
          })
        ).resolves.toMatchObject({
          status:
            "cancelled-before-submission",
          verified: false,
        });

        expect(patches).toHaveLength(1);

        expect(patches[0]).toMatchObject({
          status:
            "cancelled-before-submission",
          errorReason: "wallet rejected",
        });
      }
    );

    it(
      "refuses cancellation after a durable transaction hash exists",
      async () => {
        installGateway(HASH_0, null);

        await expect(
          recordEvidenceExecutionOutcome({
            correlationId:
              CORRELATION_ID,
            outcome:
              "cancelled-before-submission",
          })
        ).rejects.toThrow(
          "Cannot record cancelled-before-submission"
        );
      }
    );

    it(
      "records partially-executed when some but not all steps have durable hashes",
      async () => {
        const patches =
          installGateway(HASH_0, null);

        await expect(
          recordEvidenceExecutionOutcome({
            correlationId:
              CORRELATION_ID,
            outcome:
              "partially-executed",
            reason:
              "later wallet submission failed",
          })
        ).resolves.toMatchObject({
          status:
            "partially-executed",
          verificationStatus: "pending",
          verified: false,
        });

        expect(patches).toHaveLength(1);

        expect(patches[0]).toMatchObject({
          status: "partially-executed",
          errorReason:
            "later wallet submission failed",
        });
      }
    );

    it(
      "refuses partially-executed when no durable hashes exist",
      async () => {
        installGateway(null, null);

        await expect(
          recordEvidenceExecutionOutcome({
            correlationId:
              CORRELATION_ID,
            outcome:
              "partially-executed",
          })
        ).rejects.toThrow(
          "at least one but not all"
        );
      }
    );

    it(
      "refuses partially-executed when every prepared step has a durable hash",
      async () => {
        installGateway(
          HASH_0,
          HASH_1
        );

        await expect(
          recordEvidenceExecutionOutcome({
            correlationId:
              CORRELATION_ID,
            outcome:
              "partially-executed",
          })
        ).rejects.toThrow(
          "at least one but not all"
        );
      }
    );
  }
);
