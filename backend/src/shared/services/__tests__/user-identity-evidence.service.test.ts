import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  exportUserIdentityEvidenceAdmin,
} from "../user-identity-evidence.service";

const response = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as Response);

describe("user identity evidence database export", () => {
  beforeEach(() => {
    process.env.DB_GATEWAY_URL = "http://gateway.test";
    process.env.DB_GATEWAY_SERVICE_TOKEN = "test-token";
    process.env.DB_GATEWAY_TENANT_ID = "panorama-test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retrieves every page of user profiles, wallets, and users before building the evidence export", async () => {
    const profilePageOne = Array.from(
      { length: 1000 },
      (_, index) => ({
        id: `profile-${String(index).padStart(4, "0")}`,
        walletAddress:
          "0x1111111111111111111111111111111111111111",
        tenantId: "panorama-test",
      })
    );

    const profilePageTwo = [
      {
        id: "profile-1000",
        walletAddress:
          "0x2222222222222222222222222222222222222222",
        tenantId: "panorama-test",
      },
    ];

    const wallets = [
      {
        id: "wallet-001",
        userId: "user-001",
        address:
          "0x1111111111111111111111111111111111111111",
        tenantId: "panorama-test",
      },
    ];

    const users = [
      {
        userId: "user-001",
        tenantId: "panorama-test",
      },
    ];

    const fetchMock = vi.fn(
      async (
        input: string | URL | Request,
        _init?: RequestInit
      ) => {
        const url = new URL(String(input));

        if (url.pathname === "/v1/user-profiles") {
          const skip = url.searchParams.get("skip");

          if (skip === "0") {
            return response({
              data: profilePageOne,
            });
          }

          if (skip === "1000") {
            return response({
              data: profilePageTwo,
            });
          }
        }

        if (url.pathname === "/v1/wallets") {
          return response({
            data: wallets,
          });
        }

        if (url.pathname === "/v1/users") {
          return response({
            data: users,
          });
        }

        throw new Error(`Unexpected request: ${url.toString()}`);
      }
    );

    vi.stubGlobal("fetch", fetchMock);

    const exported =
      await exportUserIdentityEvidenceAdmin();

    expect(exported.summary.profileCount).toBe(1001);

    const requestedUrls = fetchMock.mock.calls.map(
      ([input]) => new URL(String(input))
    );

    expect(
      requestedUrls.some(
        (url) =>
          url.pathname === "/v1/user-profiles" &&
          url.searchParams.get("take") === "1000" &&
          url.searchParams.get("skip") === "0"
      )
    ).toBe(true);

    expect(
      requestedUrls.some(
        (url) =>
          url.pathname === "/v1/user-profiles" &&
          url.searchParams.get("take") === "1000" &&
          url.searchParams.get("skip") === "1000"
      )
    ).toBe(true);

    for (const entity of [
      "user-profiles",
      "wallets",
      "users",
    ]) {
      expect(
        requestedUrls.some(
          (url) =>
            url.pathname === `/v1/${entity}` &&
            url.searchParams.get("take") === "1000" &&
            url.searchParams.get("skip") === "0"
        )
      ).toBe(true);
    }

    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toEqual(
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
            "X-Tenant-Id": "panorama-test",
          }),
        })
      );
    }
  });
});

describe("user identity evidence complete population retrieval", () => {
  it("continues pagination independently for profiles, wallets, and users until each population returns a short page", async () => {
    const fullPage = (entity: string) =>
      Array.from({ length: 1000 }, (_, index) => {
        if (entity === "user-profiles") {
          return {
            id: `profile-${index}`,
            walletAddress:
              "0x1111111111111111111111111111111111111111",
            tenantId: "panorama-test",
          };
        }

        if (entity === "wallets") {
          return {
            id: `wallet-${index}`,
            userId: `user-${index}`,
            address:
              "0x1111111111111111111111111111111111111111",
            tenantId: "panorama-test",
          };
        }

        return {
          userId: `user-${index}`,
          tenantId: "panorama-test",
        };
      });

    const fetchMock = vi.fn(
      async (input: string | URL | Request) => {
        const url = new URL(String(input));
        const entity = url.pathname.replace("/v1/", "");
        const skip = url.searchParams.get("skip");

        if (
          !["user-profiles", "wallets", "users"].includes(
            entity
          )
        ) {
          throw new Error(
            `Unexpected request: ${url.toString()}`
          );
        }

        if (skip === "0") {
          return response({
            data: fullPage(entity),
          });
        }

        if (skip === "1000") {
          return response({
            data: [],
          });
        }

        throw new Error(
          `Unexpected pagination request: ${url.toString()}`
        );
      }
    );

    vi.stubGlobal("fetch", fetchMock);

    await exportUserIdentityEvidenceAdmin();

    const requestedUrls = fetchMock.mock.calls.map(
      ([input]) => new URL(String(input))
    );

    const expectedSelects: Record<string, string[]> = {
      "user-profiles": [
        "id",
        "walletAddress",
        "tenantId",
        "createdAt",
        "updatedAt",
      ],
      wallets: [
        "id",
        "userId",
        "chain",
        "address",
        "walletType",
        "isPrimary",
        "isActive",
        "tenantId",
        "createdAt",
        "updatedAt",
      ],
      users: [
        "userId",
        "walletAddress",
        "tenantId",
        "createdAt",
        "lastSeenAt",
      ],
    };

    for (const entity of [
      "user-profiles",
      "wallets",
      "users",
    ]) {
      const entityRequests = requestedUrls.filter(
        (url) =>
          url.pathname === `/v1/${entity}` &&
          url.searchParams.get("take") === "1000"
      );

      expect(
        entityRequests.map(
          (url) => url.searchParams.get("skip")
        )
      ).toEqual(["0", "1000"]);

      expect(
        entityRequests.map((url) => {
          const rawSelect =
            url.searchParams.get("select");

          expect(rawSelect).not.toBeNull();

          return JSON.parse(rawSelect!);
        })
      ).toEqual([
        expectedSelects[entity],
        expectedSelects[entity],
      ]);
    }
  });
});

describe("user identity evidence source disclosure minimisation", () => {
  it("requests only evidence-relevant fields from each database population", async () => {
    const expectedSelects: Record<string, string[]> = {
      "user-profiles": [
        "id",
        "walletAddress",
        "tenantId",
        "createdAt",
        "updatedAt",
      ],
      wallets: [
        "id",
        "userId",
        "chain",
        "address",
        "walletType",
        "isPrimary",
        "isActive",
        "tenantId",
        "createdAt",
        "updatedAt",
      ],
      users: [
        "userId",
        "walletAddress",
        "tenantId",
        "createdAt",
        "lastSeenAt",
      ],
    };

    const fetchMock = vi.fn(
      async (input: string | URL | Request) => {
        const url = new URL(String(input));

        if (
          ![
            "/v1/user-profiles",
            "/v1/wallets",
            "/v1/users",
          ].includes(url.pathname)
        ) {
          throw new Error(
            `Unexpected request: ${url.toString()}`
          );
        }

        return response({ data: [] });
      }
    );

    vi.stubGlobal("fetch", fetchMock);

    await exportUserIdentityEvidenceAdmin();

    const requestedUrls = fetchMock.mock.calls.map(
      ([input]) => new URL(String(input))
    );

    for (const [
      entity,
      expectedSelect,
    ] of Object.entries(expectedSelects)) {
      const request = requestedUrls.find(
        (url) => url.pathname === `/v1/${entity}`
      );

      expect(request).toBeDefined();

      const rawSelect =
        request!.searchParams.get("select");

      expect(rawSelect).not.toBeNull();

      expect(JSON.parse(rawSelect!)).toEqual(
        expectedSelect
      );
    }
  });

  it("uses panorama as the default tenant for user-estate export", async () => {
    delete process.env.DB_GATEWAY_TENANT_ID;

    const originalFetch = global.fetch;
    const observedTenants: string[] = [];

    global.fetch = vi.fn(async (_input, init) => {
      const headers = new Headers(init?.headers);
      observedTenants.push(headers.get("X-Tenant-Id") ?? "");

      return new Response(
        JSON.stringify({
          data: [],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }) as typeof fetch;

    try {
      await exportUserIdentityEvidenceAdmin();
    } finally {
      global.fetch = originalFetch;
    }

    expect(observedTenants).toHaveLength(3);
    expect(observedTenants).toEqual([
      "panorama",
      "panorama",
      "panorama",
    ]);
  });

});
