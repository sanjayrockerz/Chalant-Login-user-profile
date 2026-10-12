import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.module";
import { IdentityModule } from "./identity.module";
import { IdentityService } from "./identity.service";

const databaseUrl = process.env.PHASE1_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("IdentityModule PostgreSQL initialization", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let identity: IdentityService;

  beforeAll(async () => {
    process.env.DATABASE_URL_AUTH = databaseUrl;
    moduleRef = await Test.createTestingModule({
      imports: [IdentityModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    identity = moduleRef.get(IdentityService);
    await prisma.user.upsert({
      where: { email: "pre-identity@example.test" },
      update: {},
      create: {
        username: "pre_identity",
        email: "pre-identity@example.test",
      },
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it("initializes the real Prisma-backed module and resolves a synthetic principal", async () => {
    const user = await prisma.user.findUnique({
      where: { email: "pre-identity@example.test" },
      select: { id: true },
    });
    expect(user).not.toBeNull();
    await expect(
      identity.getCanonicalPrincipal(user?.id ?? ""),
    ).resolves.toMatchObject({
      email: "pre-identity@example.test",
    });
  });
});
