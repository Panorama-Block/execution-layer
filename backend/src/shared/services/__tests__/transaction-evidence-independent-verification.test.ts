import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ethers } from "ethers";

const {
  mockGetProvider,
  mockGetNetwork,
  mockGetTransaction,
  mockGetTransactionReceipt,
} = vi.hoisted(() => ({
  mockGetProvider: vi.fn(),
  mockGetNetwork: vi.fn(),
  mockGetTransaction: vi.fn(),
  mockGetTransactionReceipt: vi.fn(),
}));

vi.mock(
  "../../../providers/chain.provider",
  () => ({
    getProvider: mockGetProvider,
  })
);

import {
  resolveEvidenceChain,
  verifyEvidenceStep,
} from "../transaction-evidence.service";

const CORRELATION_ID = "corr-e7";
const STEP_INDEX = 0;

const WALLET =
  "0x1111111111111111111111111111111111111111";

const DESTINATION =
  "0x2222222222222222222222222222222222222222";

const OTHER_ADDRESS =
  "0x3333333333333333333333333333333333333333";

const TX_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const OTHER_TX_HASH =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const BLOCK_HASH =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const DATA = "0x1234";
const DATA_HASH = ethers.keccak256(DATA);

const response = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify(data),
  } as Response);

function makeParent(
  overrides: Record<string, unknown> = {}
) {
  return {
    correlationId: CORRELATION_ID,
    evidenceVersion: "1.0",
    action: "test",
    chainId: 43114,
    network: "avalanche",
    walletAddress: WALLET,
    intent: {},
    preparedPayloadHash: "0xprepared",
    preparedAt:
      "2026-08-31T08:00:00.000Z",
    preparedMetadata: {
      totalSteps: 1,
    },
    status: "submitted",
    verificationStatus: "pending",
    createdAt:
      "2026-08-31T08:00:00.000Z",
    updatedAt:
      "2026-08-31T08:01:00.000Z",
    ...overrides,
  };
}

function makeStep(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: `${CORRELATION_ID}:${STEP_INDEX}`,
    correlationId: CORRELATION_ID,
    stepIndex: STEP_INDEX,
    action: "swap",
    chainId: 43114,
    toAddress: DESTINATION,
    value: "0",
    dataHash: DATA_HASH,
    preparedStepHash:
      "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    preparedAt:
      "2026-08-31T08:00:00.000Z",
    txHash: TX_HASH,
    submittedAt:
      "2026-08-31T08:00:30.000Z",
    ...overrides,
  };
}

function makeTransaction(
  overrides: Record<string, unknown> = {}
) {
  return {
    hash: TX_HASH,
    from: WALLET,
    to: DESTINATION,
    data: DATA,
    value: 0n,
    ...overrides,
  };
}

function makeReceipt(
  overrides: Record<string, unknown> = {}
) {
  return {
    hash: TX_HASH,
    blockNumber: 123456,
    blockHash: BLOCK_HASH,
    status: 1,
    from: WALLET,
    to: DESTINATION,
    contractAddress: null,
    gasUsed: 21000n,
    gasPrice: 25000000000n,
    logs: [],
    ...overrides,
  };
}

function installGateway(
  parent = makeParent(),
  step = makeStep()
) {
  const storedParent = {
    ...parent,
  };

  const storedStep = {
    ...step,
  };

  const fetchMock = vi.fn(
    async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      const url = String(input);
      const method =
        init?.method || "GET";

      if (method === "GET") {
        if (
          url.endsWith(
            `/v1/transaction-evidence/${CORRELATION_ID}`
          )
        ) {
          return response({
            data: storedParent,
          });
        }

        if (
          url.endsWith(
            `/v1/transaction-evidence-steps/${CORRELATION_ID}%3A${STEP_INDEX}`
          )
        ) {
          return response({
            data: storedStep,
          });
        }
      }

      if (method === "PATCH") {
        const patch =
          init?.body
            ? JSON.parse(String(init.body))
            : {};

        if (
          url.endsWith(
            `/v1/transaction-evidence/${CORRELATION_ID}`
          )
        ) {
          Object.assign(
            storedParent,
            patch
          );

          return response({
            data: storedParent,
          });
        }

        if (
          url.endsWith(
            `/v1/transaction-evidence-steps/${CORRELATION_ID}%3A${STEP_INDEX}`
          )
        ) {
          Object.assign(
            storedStep,
            patch
          );

          return response({
            data: storedStep,
          });
        }
      }

      throw new Error(
        `Unexpected request: ${method} ${url}`
      );
    }
  );

  vi.stubGlobal(
    "fetch",
    fetchMock
  );

  return {
    fetchMock,
    storedParent,
    storedStep,
  };
}

function patchKeys(
  fetchMock: ReturnType<typeof vi.fn>
): string[] {
  return fetchMock.mock.calls
    .filter(
      ([, init]) =>
        (init as RequestInit | undefined)
          ?.method === "PATCH"
    )
    .map(([, init]) => {
      const headers =
        (init as RequestInit).headers as
          Record<string, string>;

      return headers[
        "Idempotency-Key"
      ];
    });
}

describe(
  "independent transaction evidence verification",
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

      mockGetNetwork.mockResolvedValue({
        chainId: 43114n,
      });

      mockGetTransaction.mockResolvedValue(
        makeTransaction()
      );

      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt()
      );

      mockGetProvider.mockReturnValue({
        getNetwork: mockGetNetwork,
        getTransaction:
          mockGetTransaction,
        getTransactionReceipt:
          mockGetTransactionReceipt,
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    });

    it(
      "derives supported chains from persisted chain ids",
      () => {
        expect(
          resolveEvidenceChain(43114)
        ).toBe("avalanche");

        expect(
          resolveEvidenceChain(8453)
        ).toBe("base");
      }
    );

    it(
      "refuses an unsupported persisted chain id",
      () => {
        expect(
          () =>
            resolveEvidenceChain(1)
        ).toThrow(
          "Unsupported evidence chain id: 1"
        );
      }
    );

    it(
      "uses the persisted step hash and chain for independent RPC verification",
      async () => {
        installGateway();

        const result =
          await verifyEvidenceStep({
            correlationId:
              CORRELATION_ID,
            stepIndex: STEP_INDEX,
          });

        expect(
          mockGetProvider
        ).toHaveBeenCalledWith(
          "avalanche"
        );

        expect(
          mockGetTransaction
        ).toHaveBeenCalledWith(
          TX_HASH
        );

        expect(
          mockGetTransactionReceipt
        ).toHaveBeenCalledWith(
          TX_HASH
        );

        expect(result.verified).toBe(
          true
        );

        expect(result.txHash).toBe(
          TX_HASH
        );
      }
    );

    it(
      "accepts a participating Avalanche step even when the parent intent chain is different",
      async () => {
        installGateway(
          makeParent({
            chainId: 8453,
            network: "base",
          }),
          makeStep({
            chainId: 43114,
          })
        );

        const result =
          await verifyEvidenceStep({
            correlationId:
              CORRELATION_ID,
            stepIndex: STEP_INDEX,
          });

        expect(
          mockGetProvider
        ).toHaveBeenCalledWith(
          "avalanche"
        );

        expect(
          result.chainMatchesExpected
        ).toBe(true);

        expect(result.verified).toBe(
          true
        );
      }
    );

    it(
      "rejects verification before RPC when no submitted transaction hash is persisted",
      async () => {
        installGateway(
          makeParent(),
          makeStep({
            txHash: null,
          })
        );

        await expect(
          verifyEvidenceStep({
            correlationId:
              CORRELATION_ID,
            stepIndex: STEP_INDEX,
          })
        ).rejects.toThrow(
          "Submitted transaction hash not found"
        );

        expect(
          mockGetProvider
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "rejects when the persisted transaction cannot be retrieved",
      async () => {
        installGateway();

        mockGetTransaction.mockResolvedValue(
          null
        );

        await expect(
          verifyEvidenceStep({
            correlationId:
              CORRELATION_ID,
            stepIndex: STEP_INDEX,
          })
        ).rejects.toThrow(
          `Transaction ${TX_HASH} not found via independent RPC`
        );
      }
    );

    it(
      "rejects when the persisted transaction receipt cannot be retrieved",
      async () => {
        installGateway();

        mockGetTransactionReceipt
          .mockResolvedValue(null);

        await expect(
          verifyEvidenceStep({
            correlationId:
              CORRELATION_ID,
            stepIndex: STEP_INDEX,
          })
        ).rejects.toThrow(
          `Receipt ${TX_HASH} not found via independent RPC`
        );
      }
    );

    it(
      "fails verification when the sender does not match the committed wallet",
      async () => {
        installGateway();

        mockGetTransaction
          .mockResolvedValue(
            makeTransaction({
              from: OTHER_ADDRESS,
            })
          );

        const result =
          await verifyEvidenceStep({
            correlationId:
              CORRELATION_ID,
            stepIndex: STEP_INDEX,
          });

        expect(
          result.senderMatchesExpected
        ).toBe(false);

        expect(result.verified).toBe(
          false
        );
      }
    );

    it(
      "fails verification when the destination does not match the prepared step",
      async () => {
        installGateway();

        mockGetTransaction
          .mockResolvedValue(
            makeTransaction({
              to: OTHER_ADDRESS,
            })
          );

        const result =
          await verifyEvidenceStep({
            correlationId:
              CORRELATION_ID,
            stepIndex: STEP_INDEX,
          });

        expect(
          result.destinationMatchesExpected
        ).toBe(false);

        expect(result.verified).toBe(
          false
        );
      }
    );

    it(
      "fails verification when calldata does not match the prepared commitment",
      async () => {
        installGateway();

        mockGetTransaction
          .mockResolvedValue(
            makeTransaction({
              data: "0x5678",
            })
          );

        const result =
          await verifyEvidenceStep({
            correlationId:
              CORRELATION_ID,
            stepIndex: STEP_INDEX,
          });

        expect(
          result.dataMatchesExpected
        ).toBe(false);

        expect(result.verified).toBe(
          false
        );
      }
    );

    it(
      "fails verification when value does not match the prepared commitment",
      async () => {
        installGateway();

        mockGetTransaction
          .mockResolvedValue(
            makeTransaction({
              value: 1n,
            })
          );

        const result =
          await verifyEvidenceStep({
            correlationId:
              CORRELATION_ID,
            stepIndex: STEP_INDEX,
          });

        expect(
          result.valueMatchesExpected
        ).toBe(false);

        expect(result.verified).toBe(
          false
        );
      }
    );

    it(
      "fails verification when RPC network does not match the persisted step chain",
      async () => {
        installGateway();

        mockGetNetwork.mockResolvedValue({
          chainId: 8453n,
        });

        const result =
          await verifyEvidenceStep({
            correlationId:
              CORRELATION_ID,
            stepIndex: STEP_INDEX,
          });

        expect(
          result.chainMatchesExpected
        ).toBe(false);

        expect(result.verified).toBe(
          false
        );
      }
    );

    it(
      "fails verification when the retrieved receipt hash is not the persisted submission hash",
      async () => {
        installGateway();

        mockGetTransactionReceipt
          .mockResolvedValue(
            makeReceipt({
              hash: OTHER_TX_HASH,
            })
          );

        const result =
          await verifyEvidenceStep({
            correlationId:
              CORRELATION_ID,
            stepIndex: STEP_INDEX,
          });

        expect(result.verified).toBe(
          false
        );
      }
    );

    it(
      "persists a reverted receipt and preserves reverted after verification failure roll-up",
      async () => {
        const {
          fetchMock,
          storedParent,
          storedStep,
        } = installGateway();

        mockGetTransactionReceipt
          .mockResolvedValue(
            makeReceipt({
              status: 0,
            })
          );

        const result =
          await verifyEvidenceStep({
            correlationId:
              CORRELATION_ID,
            stepIndex: STEP_INDEX,
          });

        expect(result).toMatchObject({
          verified: false,
          receiptStatus: 0,
        });

        expect(storedStep).toMatchObject({
          receiptStatus: 0,
          verified: false,
        });

        expect(
          (
            storedStep as Record<
              string,
              unknown
            >
          ).receiptRetrievedAt
        ).toBeTruthy();

        expect(storedParent).toMatchObject({
          status: "reverted",
          verificationStatus: "failed",
        });

        const parentRollupKeys =
          patchKeys(fetchMock).filter(
            (key) =>
              key.startsWith(
                `phase2-rollup:${CORRELATION_ID}:`
              )
          );

        expect(parentRollupKeys).toEqual([
          `phase2-rollup:${CORRELATION_ID}:reverted`,
          `phase2-rollup:${CORRELATION_ID}:reverted`,
        ]);
      }
    );

    it(
      "persists receipt confirmation before verification outcome",
      async () => {
        const { fetchMock } =
          installGateway();

        await verifyEvidenceStep({
          correlationId:
            CORRELATION_ID,
          stepIndex: STEP_INDEX,
        });

        const keys =
          patchKeys(fetchMock);

        const receiptIndex =
          keys.findIndex(
            (key) =>
              key.startsWith(
                "phase2-receipt:"
              )
          );

        const verificationIndex =
          keys.findIndex(
            (key) =>
              key.startsWith(
                "phase2-verification:"
              )
          );

        expect(
          receiptIndex
        ).toBeGreaterThanOrEqual(0);

        expect(
          verificationIndex
        ).toBeGreaterThan(
          receiptIndex
        );
      }
    );

    it(
      "can re-verify persisted evidence without creating a new submission",
      async () => {
        const { fetchMock } =
          installGateway();

        await verifyEvidenceStep({
          correlationId:
            CORRELATION_ID,
          stepIndex: STEP_INDEX,
        });

        await verifyEvidenceStep({
          correlationId:
            CORRELATION_ID,
          stepIndex: STEP_INDEX,
        });

        const keys =
          patchKeys(fetchMock);

        expect(
          keys.some(
            (key) =>
              key.startsWith(
                "phase2-submission:"
              )
          )
        ).toBe(false);

        expect(
          mockGetTransaction
        ).toHaveBeenCalledTimes(2);

        expect(
          mockGetTransactionReceipt
        ).toHaveBeenCalledTimes(2);
      }
    );
  }
);
