import { PrismaIdentityRepository } from "./identity.repository";

describe("PrismaIdentityRepository Chat provisioning outbox", () => {
  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    username: "new-user",
    email: "new@example.test",
    isVerified: true,
    accountStatus: "ACTIVE",
  };

  function setup() {
    const outboxCreate = jest.fn().mockResolvedValue({ id: "event-id" });
    const userCreate = jest.fn().mockResolvedValue(user);
    const transaction = {
      user: { create: userCreate },
      outboxEvent: { create: outboxCreate },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    };
    return {
      repository: new PrismaIdentityRepository(prisma as never),
      prisma,
      userCreate,
      outboxCreate,
    };
  }

  it.each(["password", "provider"])(
    "stores %s signup provisioning intent in the account transaction",
    async (kind) => {
      const { repository, prisma, userCreate, outboxCreate } = setup();

      if (kind === "password") {
        await repository.createUser("new-user", "new@example.test", "hash");
      } else {
        await repository.createProviderUser("new-user", "new@example.test", {
          provider: "GOOGLE",
          issuer: "https://accounts.google.test",
          subject: "sub",
        });
      }

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(userCreate).toHaveBeenCalledTimes(1);
      expect(outboxCreate).toHaveBeenCalledWith({
        data: {
          eventType: "chat.profile.provision.v1",
          aggregateId: user.id,
          payload: { authUserId: user.id },
        },
      });
    },
  );
});
