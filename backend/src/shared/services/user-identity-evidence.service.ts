import { createHash } from "crypto";

const DEFAULT_TENANT_ID = "panorama";
const PAGE_SIZE = 1000;

interface UserProfileRecord {
  id: string;
  walletAddress: string;
  tenantId: string;
  [key: string]: unknown;
}

interface UserRecord {
  userId: string;
  tenantId: string;
  [key: string]: unknown;
}

interface WalletRecord {
  id: string;
  userId: string;
  address: string;
  tenantId: string;
  [key: string]: unknown;
}

interface UserIdentityEvidenceInput {
  profiles: UserProfileRecord[];
  users: UserRecord[];
  wallets: WalletRecord[];
}

interface GatewayListEnvelope<T> {
  data: T[];
  [key: string]: unknown;
}

function gatewayConfig(): {
  url: string;
  token: string;
  tenantId: string;
  timeoutMs: number;
} {
  const url = process.env.DB_GATEWAY_URL?.replace(/\/+$/, "");
  const token = process.env.DB_GATEWAY_SERVICE_TOKEN;
  const tenantId =
    process.env.DB_GATEWAY_TENANT_ID?.trim() || DEFAULT_TENANT_ID;
  const timeoutMs = Number(
    process.env.DB_GATEWAY_TIMEOUT_MS || "5000"
  );

  if (!url) {
    throw new Error("DB_GATEWAY_URL is not configured");
  }

  if (!token) {
    throw new Error(
      "DB_GATEWAY_SERVICE_TOKEN is not configured"
    );
  }

  return {
    url,
    token,
    tenantId,
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : 5000,
  };
}

async function gatewayList<T>(
  path: string
): Promise<GatewayListEnvelope<T>> {
  const config = gatewayConfig();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    config.timeoutMs
  );

  try {
    const response = await fetch(`${config.url}${path}`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.token}`,
        "X-Tenant-Id": config.tenantId,
      },
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `Database Gateway ${response.status}: ${text.slice(0, 500)}`
      );
    }

    const parsed = text ? JSON.parse(text) : null;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !Array.isArray(
        (parsed as GatewayListEnvelope<T>).data
      )
    ) {
      throw new Error(
        "Database Gateway returned an invalid list response"
      );
    }

    return parsed as GatewayListEnvelope<T>;
  } finally {
    clearTimeout(timer);
  }
}

async function listAll<T>(
  entity: string,
  select: readonly string[]
): Promise<T[]> {
  const records: T[] = [];
  let skip = 0;

  while (true) {
    const query = new URLSearchParams({
      take: String(PAGE_SIZE),
      skip: String(skip),
      select: JSON.stringify(select),
    });

    const result = await gatewayList<T>(
      `/v1/${entity}?${query.toString()}`
    );

    records.push(...result.data);

    if (result.data.length < PAGE_SIZE) {
      break;
    }

    skip += PAGE_SIZE;
  }

  return records;
}

const normalizeWalletAddress = (
  address: string
): string => address.trim().toLowerCase();

const canonicaliseJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicaliseJsonValue);
  }

  if (value !== null && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>(
        (canonical, key) => {
          canonical[key] = canonicaliseJsonValue(
            (value as Record<string, unknown>)[key]
          );
          return canonical;
        },
        {}
      );
  }

  return value;
};

const canonicalStringify = (value: unknown): string =>
  JSON.stringify(canonicaliseJsonValue(value));

export const buildUserIdentityEvidence = ({
  profiles,
  users,
  wallets,
}: UserIdentityEvidenceInput) => {
  const records = profiles.map((profile) => {
    const profileWalletAddress = normalizeWalletAddress(
      profile.walletAddress
    );

    const matchedWallets = wallets
      .filter(
        (wallet) =>
          normalizeWalletAddress(wallet.address) ===
          profileWalletAddress
      )
      .sort((left, right) =>
        left.id.localeCompare(right.id)
      );

    const referencedUserIds = [
      ...new Set(
        matchedWallets.map((wallet) => wallet.userId)
      ),
    ].sort((left, right) => left.localeCompare(right));

    const matchedUsers = users.filter((user) =>
      referencedUserIds.includes(user.userId)
    );

    const referencedUserExists =
      referencedUserIds.length > 0 &&
      referencedUserIds.every((userId) =>
        matchedUsers.some(
          (user) => user.userId === userId
        )
      );

    const identityUniquelyResolved =
      referencedUserIds.length === 1 &&
      matchedUsers.length === 1;

    const matchedUser =
      identityUniquelyResolved ? matchedUsers[0] : null;

    const tenantRelationshipConsistent =
      matchedWallets.length > 0 &&
      identityUniquelyResolved &&
      matchedUser !== null &&
      matchedWallets.every(
        (wallet) =>
          wallet.tenantId === profile.tenantId &&
          wallet.tenantId === matchedUser.tenantId
      );

    return {
      profile,
      user: matchedUser,
      wallets: matchedWallets,
      validation: {
        profileWalletAddress,
        matchedWalletIds: matchedWallets.map(
          (wallet) => wallet.id
        ),
        matchedUserId: matchedUser?.userId ?? null,
        matchedUserIds: referencedUserIds,
        checks: {
          profileHasWalletAddress:
            profileWalletAddress.length > 0,
          profileWalletExistsInWalletDatabase:
            matchedWallets.length > 0,
          walletReferencesUser: matchedWallets.some(
            (wallet) => wallet.userId.length > 0
          ),
          referencedUserExists,
          identityUniquelyResolved,
          tenantRelationshipConsistent,
        },
      },
    };
  });

  records.sort((left, right) =>
    left.profile.id.localeCompare(right.profile.id)
  );

  const profileWalletAddresses = new Set(
    profiles.map((profile) =>
      normalizeWalletAddress(profile.walletAddress)
    )
  );

  const unmatchedWallets = wallets
    .filter(
      (wallet) =>
        !profileWalletAddresses.has(
          normalizeWalletAddress(wallet.address)
        )
    )
    .sort((left, right) =>
      left.id.localeCompare(right.id)
    );

  const walletUserIds = new Set(
    wallets.map((wallet) => wallet.userId)
  );

  const usersWithoutWallets = users
    .filter(
      (user) => !walletUserIds.has(user.userId)
    )
    .sort((left, right) =>
      left.userId.localeCompare(right.userId)
    );

  const userIds = new Set(
    users.map((user) => user.userId)
  );

  const walletsWithoutUsers = wallets
    .filter(
      (wallet) => !userIds.has(wallet.userId)
    )
    .sort((left, right) =>
      left.id.localeCompare(right.id)
    );

  const summary = records.reduce(
    (counts, record) => {
      const {
        identityUniquelyResolved,
        tenantRelationshipConsistent,
      } = record.validation.checks;

      if (record.validation.matchedUserIds.length > 1) {
        counts.ambiguousCount += 1;
      } else if (
        identityUniquelyResolved &&
        !tenantRelationshipConsistent
      ) {
        counts.tenantInconsistentCount += 1;
      } else if (
        identityUniquelyResolved &&
        tenantRelationshipConsistent
      ) {
        counts.uniquelyResolvedCount += 1;
      } else {
        counts.unresolvedCount += 1;
      }

      return counts;
    },
    {
      profileCount: records.length,
      walletCount: wallets.length,
      userCount: users.length,
      walletWithoutProfileCount: unmatchedWallets.length,
      userWithoutWalletCount: usersWithoutWallets.length,
      walletWithoutUserCount: walletsWithoutUsers.length,
      uniquelyResolvedCount: 0,
      unresolvedCount: 0,
      ambiguousCount: 0,
      tenantInconsistentCount: 0,
    }
  );

  const sourcePopulation = {
    profiles: [...profiles].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    wallets: [...wallets].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    users: [...users].sort((left, right) =>
      left.userId.localeCompare(right.userId)
    ),
  };

  const payload = {
    schemaVersion: "1.0",
    evidenceType:
      "panoramablock-user-identity-wallet-evidence",
    summary,
    sourcePopulation,
    records,
    unmatchedWallets,
    usersWithoutWallets,
    walletsWithoutUsers,
  };

  const payloadHash = createHash("sha256")
    .update(canonicalStringify(payload))
    .digest("hex");

  return {
    ...payload,
    integrity: {
      algorithm: "sha256",
      canonicalisation:
        "panoramablock-json-canonical-v1",
      payloadHash,
    },
  };
};

export async function exportUserIdentityEvidenceAdmin() {
  const [profiles, wallets, users] = await Promise.all([
    listAll<UserProfileRecord>("user-profiles", [
      "id",
      "walletAddress",
      "tenantId",
      "createdAt",
      "updatedAt",
    ]),
    listAll<WalletRecord>("wallets", [
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
    ]),
    listAll<UserRecord>("users", [
      "userId",
      "walletAddress",
      "tenantId",
      "createdAt",
      "lastSeenAt",
    ]),
  ]);

  return buildUserIdentityEvidence({
    profiles,
    users,
    wallets,
  });
}
