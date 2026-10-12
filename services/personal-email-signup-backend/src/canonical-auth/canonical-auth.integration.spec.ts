import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.module";
import { CanonicalAuthModule } from "./canonical-auth.module";
import { Server } from "http";
import request from "supertest";

interface RegistrationBody {
  user: { subject: string };
}

interface TokenBody {
  access_token: string;
  refresh_token: string;
}

interface PrincipalBody {
  user: { email: string };
}

const databaseUrl = process.env.PHASE2A_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("canonical password authentication HTTP contract", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  const emails: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL_AUTH = databaseUrl;
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6399";
    process.env.COOKIE_SECRET = "phase2a-test-cookie-secret";
    process.env.JWT_SECRET = "phase2a-test-signing-secret-change-me";
    process.env.NODE_ENV = "test";
    const moduleRef = await Test.createTestingModule({
      imports: [CanonicalAuthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as unknown as Server;
    prisma = moduleRef.get(PrismaService);
  });

  afterEach(async () => {
    if (emails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      emails.length = 0;
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function registerAndVerify(email: string, username: string) {
    emails.push(email);
    const registration = await request(server)
      .post("/auth/register")
      .send({
        email,
        username,
        password: "A sufficiently unique passphrase 2026!",
      })
      .expect(201);
    await prisma.user.update({
      where: { email },
      data: { isVerified: true },
    });
    return (registration.body as RegistrationBody).user.subject;
  }

  it("registers a canonical credential without issuing a pre-verification session", async () => {
    const email = `phase2a-${Date.now()}@example.test`;
    const subject = await registerAndVerify(email, `phase2a_${Date.now()}`);
    expect(subject).toMatch(/[0-9a-f-]{36}/i);
    const stored = await prisma.user.findUnique({
      where: { email },
      include: { passwordCredential: true },
    });
    expect(stored?.passwordCredential?.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it("logs in, resolves the canonical principal, rotates refresh tokens, and revokes logout", async () => {
    const email = `phase2a-flow-${Date.now()}@example.test`;
    await registerAndVerify(email, `phase2a_flow_${Date.now()}`);
    const login = await request(server)
      .post("/auth/login")
      .send({ email, password: "A sufficiently unique passphrase 2026!" })
      .expect(200);
    const loginBody = login.body as TokenBody;
    expect(loginBody.access_token).toEqual(expect.any(String));
    expect(loginBody.refresh_token).toEqual(expect.any(String));

    await request(server)
      .get("/auth/me")
      .set("Authorization", `Bearer ${loginBody.access_token}`)
      .expect(200)
      .expect(({ body }) => {
        const principalBody = body as PrincipalBody;
        expect(principalBody.user.email).toBe(email);
      });

    const rotated = await request(server)
      .post("/auth/refresh")
      .send({ refresh_token: loginBody.refresh_token })
      .expect(200);
    const rotatedBody = rotated.body as TokenBody;
    expect(rotatedBody.refresh_token).not.toBe(loginBody.refresh_token);
    await request(server)
      .post("/auth/refresh")
      .send({ refresh_token: loginBody.refresh_token })
      .expect(401);

    await request(server)
      .post("/auth/logout")
      .send({ refresh_token: rotatedBody.refresh_token })
      .expect(204);
    await request(server)
      .post("/auth/refresh")
      .send({ refresh_token: rotatedBody.refresh_token })
      .expect(401);
  });

  it("rejects wrong credentials, duplicate registration, unverified login, and missing authentication", async () => {
    const email = `phase2a-deny-${Date.now()}@example.test`;
    emails.push(email);
    await request(server)
      .post("/auth/register")
      .send({
        email,
        username: `phase2a_deny_${Date.now()}`,
        password: "A sufficiently unique passphrase 2026!",
      })
      .expect(201);
    await request(server)
      .post("/auth/login")
      .send({ email, password: "wrong password" })
      .expect(401);
    await request(server)
      .post("/auth/login")
      .send({ email, password: "A sufficiently unique passphrase 2026!" })
      .expect(401);
    await request(server)
      .post("/auth/register")
      .send({
        email,
        username: `phase2a_duplicate_${Date.now()}`,
        password: "A sufficiently unique passphrase 2026!",
      })
      .expect(409);
    await request(server).get("/auth/me").expect(401);
  });
});
