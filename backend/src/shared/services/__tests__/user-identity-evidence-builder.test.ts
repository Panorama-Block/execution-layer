import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildUserIdentityEvidence } from '../user-identity-evidence.service';

const canonicaliseForVerification = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicaliseForVerification);
  }

  if (
    value !== null &&
    typeof value === 'object'
  ) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>(
        (canonical, key) => {
          canonical[key] = canonicaliseForVerification(
            (value as Record<string, unknown>)[key]
          );
          return canonical;
        },
        {}
      );
  }

  return value;
};

const canonicalStringifyForVerification = (
  value: unknown
): string =>
  JSON.stringify(canonicaliseForVerification(value));

describe('user identity evidence', () => {
  it('correlates a user profile to its canonical wallet and user records', () => {
    const profile = {
      id: '11111111-1111-4111-8111-111111111111',
      walletAddress: '0x73FE164B67193E564B630B7925158EB0F9021303',
      nickname: 'Evidence User',
      investorType: 'moderate',
      goals: ['yield'],
      preferredChains: ['avalanche'],
      riskTolerance: 5,
      metadata: {},
      tenantId: 'panorama',
      createdAt: '2026-09-18T10:00:00.000Z',
      updatedAt: '2026-09-18T10:05:00.000Z'
    };

    const user = {
      userId: 'user-001',
      walletAddress: '0x73fe164b67193e564b630b7925158eb0f9021303',
      displayName: 'Evidence User',
      attributes: {},
      tenantId: 'panorama',
      createdAt: '2026-09-18T09:00:00.000Z',
      lastSeenAt: '2026-09-18T10:04:00.000Z'
    };

    const wallet = {
      id: '22222222-2222-4222-8222-222222222222',
      userId: 'user-001',
      chain: 'AVALANCHE',
      address: '0x73fe164b67193e564b630b7925158eb0f9021303',
      walletType: 'smart_wallet',
      name: 'Primary wallet',
      isPrimary: true,
      isActive: true,
      metadata: {
        provider: 'thirdweb'
      },
      tenantId: 'panorama',
      createdAt: '2026-09-18T09:01:00.000Z',
      updatedAt: '2026-09-18T10:03:00.000Z'
    };

    const evidence = buildUserIdentityEvidence({
      profiles: [profile],
      users: [user],
      wallets: [wallet]
    });

    expect(evidence.records).toHaveLength(1);

    const record = evidence.records[0];

    expect(record.profile).toEqual(profile);
    expect(record.user).toEqual(user);
    expect(record.wallets).toEqual([wallet]);

    expect(record.validation).toEqual({
      profileWalletAddress:
        '0x73fe164b67193e564b630b7925158eb0f9021303',
      matchedWalletIds: [
        '22222222-2222-4222-8222-222222222222'
      ],
      matchedUserId: 'user-001',
      matchedUserIds: [
        'user-001'
      ],
      checks: {
        profileHasWalletAddress: true,
        profileWalletExistsInWalletDatabase: true,
        walletReferencesUser: true,
        referencedUserExists: true,
        identityUniquelyResolved: true,
        tenantRelationshipConsistent: true
      }
    });
  });
});

describe('user identity evidence validation failures', () => {
  const profile = {
    id: '33333333-3333-4333-8333-333333333333',
    walletAddress: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    tenantId: 'panorama',
    createdAt: '2026-09-18T11:00:00.000Z',
    updatedAt: '2026-09-18T11:00:00.000Z'
  };

  const user = {
    userId: 'user-002',
    walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    tenantId: 'panorama',
    createdAt: '2026-09-18T10:00:00.000Z'
  };

  const wallet = {
    id: '44444444-4444-4444-8444-444444444444',
    userId: 'user-002',
    chain: 'AVALANCHE',
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    walletType: 'smart_wallet',
    isPrimary: true,
    isActive: true,
    tenantId: 'panorama',
    createdAt: '2026-09-18T10:01:00.000Z',
    updatedAt: '2026-09-18T10:01:00.000Z'
  };

  it('preserves a profile with no matching canonical wallet and reports the broken relationship', () => {
    const evidence = buildUserIdentityEvidence({
      profiles: [profile],
      users: [user],
      wallets: []
    });

    expect(evidence.records).toHaveLength(1);

    expect(evidence.records[0]).toMatchObject({
      profile,
      user: null,
      wallets: [],
      validation: {
        profileWalletAddress:
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        matchedWalletIds: [],
        matchedUserId: null,
        checks: {
          profileHasWalletAddress: true,
          profileWalletExistsInWalletDatabase: false,
          walletReferencesUser: false,
          referencedUserExists: false,
          tenantRelationshipConsistent: false
        }
      }
    });
  });

  it('reports a wallet whose referenced canonical user does not exist', () => {
    const evidence = buildUserIdentityEvidence({
      profiles: [profile],
      users: [],
      wallets: [wallet]
    });

    expect(evidence.records[0]).toMatchObject({
      profile,
      user: null,
      wallets: [wallet],
      validation: {
        matchedWalletIds: [wallet.id],
        matchedUserId: null,
        checks: {
          profileHasWalletAddress: true,
          profileWalletExistsInWalletDatabase: true,
          walletReferencesUser: true,
          referencedUserExists: false,
          tenantRelationshipConsistent: false
        }
      }
    });
  });

  it('reports tenant inconsistency instead of hiding an otherwise matching relationship', () => {
    const foreignTenantWallet = {
      ...wallet,
      tenantId: 'other-tenant'
    };

    const evidence = buildUserIdentityEvidence({
      profiles: [profile],
      users: [user],
      wallets: [foreignTenantWallet]
    });

    expect(evidence.records[0]).toMatchObject({
      profile,
      user,
      wallets: [foreignTenantWallet],
      validation: {
        matchedWalletIds: [foreignTenantWallet.id],
        matchedUserId: user.userId,
        checks: {
          profileHasWalletAddress: true,
          profileWalletExistsInWalletDatabase: true,
          walletReferencesUser: true,
          referencedUserExists: true,
          tenantRelationshipConsistent: false
        }
      }
    });
  });

  it('correlates wallet addresses case-insensitively', () => {
    const mixedCaseProfile = {
      ...profile,
      walletAddress: '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa'
    };

    const evidence = buildUserIdentityEvidence({
      profiles: [mixedCaseProfile],
      users: [user],
      wallets: [wallet]
    });

    expect(evidence.records[0].wallets).toEqual([wallet]);
    expect(
      evidence.records[0].validation.profileWalletAddress
    ).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(
      evidence.records[0].validation.checks
        .profileWalletExistsInWalletDatabase
    ).toBe(true);
  });
});

describe('user identity evidence ambiguity', () => {
  it('explicitly reports when one profile wallet address resolves to multiple users', () => {
    const profile = {
      id: '55555555-5555-4555-8555-555555555555',
      walletAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      tenantId: 'panorama',
      createdAt: '2026-09-18T12:00:00.000Z',
      updatedAt: '2026-09-18T12:00:00.000Z'
    };

    const walletOne = {
      id: '66666666-6666-4666-8666-666666666666',
      userId: 'user-003',
      chain: 'AVALANCHE',
      address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      walletType: 'smart_wallet',
      isPrimary: true,
      isActive: true,
      tenantId: 'panorama',
      createdAt: '2026-09-18T11:00:00.000Z',
      updatedAt: '2026-09-18T11:00:00.000Z'
    };

    const walletTwo = {
      id: '77777777-7777-4777-8777-777777777777',
      userId: 'user-004',
      chain: 'BASE',
      address: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      walletType: 'evm',
      isPrimary: false,
      isActive: true,
      tenantId: 'panorama',
      createdAt: '2026-09-18T11:01:00.000Z',
      updatedAt: '2026-09-18T11:01:00.000Z'
    };

    const users = [
      {
        userId: 'user-003',
        tenantId: 'panorama',
        createdAt: '2026-09-18T10:00:00.000Z'
      },
      {
        userId: 'user-004',
        tenantId: 'panorama',
        createdAt: '2026-09-18T10:01:00.000Z'
      }
    ];

    const evidence = buildUserIdentityEvidence({
      profiles: [profile],
      users,
      wallets: [walletOne, walletTwo]
    });

    const record = evidence.records[0];

    expect(record.profile).toEqual(profile);
    expect(record.user).toBeNull();
    expect(record.wallets).toEqual([walletOne, walletTwo]);

    expect(record.validation).toEqual({
      profileWalletAddress:
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      matchedWalletIds: [
        walletOne.id,
        walletTwo.id
      ],
      matchedUserId: null,
      matchedUserIds: [
        'user-003',
        'user-004'
      ],
      checks: {
        profileHasWalletAddress: true,
        profileWalletExistsInWalletDatabase: true,
        walletReferencesUser: true,
        referencedUserExists: true,
        identityUniquelyResolved: false,
        tenantRelationshipConsistent: false
      }
    });
  });
});

describe('user identity evidence export package', () => {
  it('builds a deterministic auditable package with explicit validation summary', () => {
    const profiles = [
      {
        id: '99999999-9999-4999-8999-999999999999',
        walletAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
        tenantId: 'panorama',
        createdAt: '2026-09-18T13:01:00.000Z',
        updatedAt: '2026-09-18T13:01:00.000Z'
      },
      {
        id: '88888888-8888-4888-8888-888888888888',
        walletAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
        tenantId: 'panorama',
        createdAt: '2026-09-18T13:00:00.000Z',
        updatedAt: '2026-09-18T13:00:00.000Z'
      }
    ];

    const users = [
      {
        userId: 'user-005',
        tenantId: 'panorama',
        createdAt: '2026-09-18T12:00:00.000Z'
      }
    ];

    const wallets = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        userId: 'user-005',
        chain: 'AVALANCHE',
        address: '0xcccccccccccccccccccccccccccccccccccccccc',
        walletType: 'smart_wallet',
        isPrimary: true,
        isActive: true,
        tenantId: 'panorama',
        createdAt: '2026-09-18T12:01:00.000Z',
        updatedAt: '2026-09-18T12:01:00.000Z'
      }
    ];

    const evidence = buildUserIdentityEvidence({
      profiles,
      users,
      wallets
    });

    expect(evidence).toEqual({
      schemaVersion: '1.0',
      evidenceType: 'panoramablock-user-identity-wallet-evidence',
      summary: {
        profileCount: 2,
        walletCount: 1,
        userCount: 1,
        walletWithoutProfileCount: 0,
        userWithoutWalletCount: 0,
        walletWithoutUserCount: 0,
        uniquelyResolvedCount: 1,
        unresolvedCount: 1,
        ambiguousCount: 0,
        tenantInconsistentCount: 0
      },
      sourcePopulation: {
        profiles: [
          profiles[1],
          profiles[0]
        ],
        wallets,
        users
      },
      records: [
        expect.objectContaining({
          profile: expect.objectContaining({
            id: '88888888-8888-4888-8888-888888888888'
          })
        }),
        expect.objectContaining({
          profile: expect.objectContaining({
            id: '99999999-9999-4999-8999-999999999999'
          })
        })
      ],
      unmatchedWallets: [],
      usersWithoutWallets: [],
      walletsWithoutUsers: [],
      integrity: {
        algorithm: 'sha256',
        canonicalisation: 'panoramablock-json-canonical-v1',
        payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/)
      }
    });

    const { integrity, ...payload } = evidence;

    expect(integrity.payloadHash).toBe(
      createHash('sha256')
        .update(canonicalStringifyForVerification(payload))
        .digest('hex')
    );
  });

  it('produces the same evidence package regardless of input ordering', () => {
    const profiles = [
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        walletAddress: '0xffffffffffffffffffffffffffffffffffffffff',
        tenantId: 'panorama'
      },
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        walletAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        tenantId: 'panorama'
      }
    ];

    const forward = buildUserIdentityEvidence({
      profiles,
      users: [],
      wallets: []
    });

    const reversed = buildUserIdentityEvidence({
      profiles: [...profiles].reverse(),
      users: [],
      wallets: []
    });

    expect(forward).toEqual(reversed);
    expect(forward.records.map((record) => record.profile.id)).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    ]);
  });
});

describe('user identity evidence canonical ordering', () => {
  it('canonicalises nested wallet and user references independently of input order', () => {
    const profile = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      walletAddress: '0x1111111111111111111111111111111111111111',
      tenantId: 'panorama'
    };

    const users = [
      {
        userId: 'user-z',
        tenantId: 'panorama'
      },
      {
        userId: 'user-a',
        tenantId: 'panorama'
      }
    ];

    const wallets = [
      {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        userId: 'user-z',
        chain: 'BASE',
        address: '0x1111111111111111111111111111111111111111',
        walletType: 'evm',
        isPrimary: false,
        isActive: true,
        tenantId: 'panorama'
      },
      {
        id: '11111111-aaaa-4aaa-8aaa-111111111111',
        userId: 'user-a',
        chain: 'AVALANCHE',
        address: '0x1111111111111111111111111111111111111111',
        walletType: 'smart_wallet',
        isPrimary: true,
        isActive: true,
        tenantId: 'panorama'
      }
    ];

    const forward = buildUserIdentityEvidence({
      profiles: [profile],
      users,
      wallets
    });

    const reversed = buildUserIdentityEvidence({
      profiles: [profile],
      users: [...users].reverse(),
      wallets: [...wallets].reverse()
    });

    expect(forward).toEqual(reversed);

    expect(
      forward.records[0].wallets.map((wallet) => wallet.id)
    ).toEqual([
      '11111111-aaaa-4aaa-8aaa-111111111111',
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    ]);

    expect(
      forward.records[0].validation.matchedWalletIds
    ).toEqual([
      '11111111-aaaa-4aaa-8aaa-111111111111',
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    ]);

    expect(
      forward.records[0].validation.matchedUserIds
    ).toEqual([
      'user-a',
      'user-z'
    ]);
  });
});

describe('user identity evidence integrity', () => {
  it('includes a reproducible SHA-256 digest of the canonical evidence payload', () => {
    const profile = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      walletAddress: '0x2222222222222222222222222222222222222222',
      tenantId: 'panorama'
    };

    const user = {
      userId: 'user-integrity',
      tenantId: 'panorama'
    };

    const wallet = {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      userId: 'user-integrity',
      address: '0x2222222222222222222222222222222222222222',
      tenantId: 'panorama'
    };

    const evidence = buildUserIdentityEvidence({
      profiles: [profile],
      users: [user],
      wallets: [wallet]
    });

    const { integrity, ...payload } = evidence;

    const expectedDigest = createHash('sha256')
      .update(canonicalStringifyForVerification(payload))
      .digest('hex');

    expect(integrity).toEqual({
      algorithm: 'sha256',
      canonicalisation: 'panoramablock-json-canonical-v1',
      payloadHash: expectedDigest
    });

    const reordered = buildUserIdentityEvidence({
      profiles: [profile],
      users: [user],
      wallets: [wallet]
    });

    expect(reordered.integrity).toEqual(integrity);
  });
});

describe('user identity evidence canonical serialisation', () => {
  it('produces the same integrity hash regardless of source object key insertion order', () => {
    const profileForward = {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      walletAddress: '0x3333333333333333333333333333333333333333',
      nickname: 'Canonical User',
      metadata: {
        source: 'thirdweb',
        environment: 'production'
      },
      tenantId: 'panorama'
    };

    const profileReordered = {
      tenantId: 'panorama',
      metadata: {
        environment: 'production',
        source: 'thirdweb'
      },
      nickname: 'Canonical User',
      walletAddress: '0x3333333333333333333333333333333333333333',
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    };

    const userForward = {
      userId: 'user-canonical',
      displayName: 'Canonical User',
      attributes: {
        provider: 'thirdweb',
        status: 'active'
      },
      tenantId: 'panorama'
    };

    const userReordered = {
      tenantId: 'panorama',
      attributes: {
        status: 'active',
        provider: 'thirdweb'
      },
      displayName: 'Canonical User',
      userId: 'user-canonical'
    };

    const walletForward = {
      id: 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee',
      userId: 'user-canonical',
      chain: 'AVALANCHE',
      address: '0x3333333333333333333333333333333333333333',
      walletType: 'smart_wallet',
      metadata: {
        provider: 'thirdweb',
        accountType: 'embedded'
      },
      tenantId: 'panorama'
    };

    const walletReordered = {
      tenantId: 'panorama',
      metadata: {
        accountType: 'embedded',
        provider: 'thirdweb'
      },
      walletType: 'smart_wallet',
      address: '0x3333333333333333333333333333333333333333',
      chain: 'AVALANCHE',
      userId: 'user-canonical',
      id: 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee'
    };

    const forward = buildUserIdentityEvidence({
      profiles: [profileForward],
      users: [userForward],
      wallets: [walletForward]
    });

    const reordered = buildUserIdentityEvidence({
      profiles: [profileReordered],
      users: [userReordered],
      wallets: [walletReordered]
    });

    expect(forward.integrity.payloadHash).toBe(
      reordered.integrity.payloadHash
    );
  });
});

describe('user identity evidence estate completeness', () => {
  it('explicitly accounts for a canonical wallet that has no matching user profile', () => {
    const profile = {
      id: 'profile-linked',
      walletAddress: '0x1111111111111111111111111111111111111111',
      tenantId: 'panorama'
    };

    const users = [
      {
        userId: 'user-linked',
        tenantId: 'panorama'
      },
      {
        userId: 'user-without-profile',
        tenantId: 'panorama'
      }
    ];

    const wallets = [
      {
        id: 'wallet-linked',
        userId: 'user-linked',
        address: '0x1111111111111111111111111111111111111111',
        tenantId: 'panorama'
      },
      {
        id: 'wallet-without-profile',
        userId: 'user-without-profile',
        address: '0x2222222222222222222222222222222222222222',
        tenantId: 'panorama'
      }
    ];

    const evidence = buildUserIdentityEvidence({
      profiles: [profile],
      users,
      wallets
    });

    expect(evidence.summary).toMatchObject({
      profileCount: 1,
      walletCount: 2,
      userCount: 2,
      walletWithoutProfileCount: 1
    });

    expect(evidence.unmatchedWallets).toEqual([
      wallets[1]
    ]);
  });
});

describe('user identity evidence user completeness', () => {
  it('explicitly accounts for a canonical user that is not referenced by any wallet', () => {
    const profile = {
      id: 'profile-linked-user',
      walletAddress: '0x3333333333333333333333333333333333333333',
      tenantId: 'panorama'
    };

    const users = [
      {
        userId: 'user-linked-wallet',
        tenantId: 'panorama'
      },
      {
        userId: 'user-without-wallet',
        tenantId: 'panorama'
      }
    ];

    const wallets = [
      {
        id: 'wallet-linked-user',
        userId: 'user-linked-wallet',
        address: '0x3333333333333333333333333333333333333333',
        tenantId: 'panorama'
      }
    ];

    const evidence = buildUserIdentityEvidence({
      profiles: [profile],
      users,
      wallets
    });

    expect(evidence.summary).toMatchObject({
      profileCount: 1,
      walletCount: 1,
      userCount: 2,
      userWithoutWalletCount: 1
    });

    expect(evidence.usersWithoutWallets).toEqual([
      users[1]
    ]);
  });
});

describe('user identity evidence wallet-to-user completeness', () => {
  it('explicitly accounts for a canonical wallet whose referenced user does not exist', () => {
    const profiles = [
      {
        id: 'profile-valid',
        walletAddress: '0x4444444444444444444444444444444444444444',
        tenantId: 'panorama'
      }
    ];

    const users = [
      {
        userId: 'user-valid',
        tenantId: 'panorama'
      }
    ];

    const wallets = [
      {
        id: 'wallet-valid',
        userId: 'user-valid',
        address: '0x4444444444444444444444444444444444444444',
        tenantId: 'panorama'
      },
      {
        id: 'wallet-missing-user',
        userId: 'user-does-not-exist',
        address: '0x5555555555555555555555555555555555555555',
        tenantId: 'panorama'
      }
    ];

    const evidence = buildUserIdentityEvidence({
      profiles,
      users,
      wallets
    });

    expect(evidence.summary).toMatchObject({
      profileCount: 1,
      walletCount: 2,
      userCount: 1,
      walletWithoutUserCount: 1
    });

    expect(evidence.walletsWithoutUsers).toEqual([
      wallets[1]
    ]);
  });
});

describe('user identity evidence source population completeness', () => {
  it('includes every retrieved source record even when it is not reachable through a profile identity record', () => {
    const profiles = [
      {
        id: 'profile-linked',
        walletAddress: '0x6666666666666666666666666666666666666666',
        tenantId: 'panorama'
      }
    ];

    const wallets = [
      {
        id: 'wallet-linked',
        userId: 'user-linked',
        address: '0x6666666666666666666666666666666666666666',
        tenantId: 'panorama'
      },
      {
        id: 'wallet-no-profile',
        userId: 'user-no-profile',
        address: '0x7777777777777777777777777777777777777777',
        tenantId: 'panorama'
      }
    ];

    const users = [
      {
        userId: 'user-linked',
        tenantId: 'panorama'
      },
      {
        userId: 'user-no-profile',
        tenantId: 'panorama'
      }
    ];

    const evidence = buildUserIdentityEvidence({
      profiles,
      wallets,
      users
    });

    expect(evidence.sourcePopulation).toEqual({
      profiles,
      wallets,
      users
    });

    expect(evidence.summary).toMatchObject({
      profileCount: evidence.sourcePopulation.profiles.length,
      walletCount: evidence.sourcePopulation.wallets.length,
      userCount: evidence.sourcePopulation.users.length
    });
  });
});
