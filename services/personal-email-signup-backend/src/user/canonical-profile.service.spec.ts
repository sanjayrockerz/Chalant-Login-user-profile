import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { OnboardingStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.module";
import {
  UpdateCanonicalProfileDto,
  UpdateOnboardingDto,
} from "./canonical-profile.dto";
import { CanonicalProfileService } from "./canonical-profile.service";

const userId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const profileRecord = {
  id: userId,
  username: "canonical_user",
  email: "canonical@example.test",
  isVerified: true,
  displayName: "Canonical User",
  profileImageUrl: null,
  pronouns: null,
  allowContactDiscovery: true,
  onboardingStatus: OnboardingStatus.IN_PROGRESS,
  onboardingCompletedAt: null,
  termsVersion: "terms-v1",
  termsAcceptedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("CanonicalProfileService", () => {
  let service: CanonicalProfileService;
  let findUnique: jest.Mock<Promise<unknown>, unknown[]>;
  let update: jest.Mock<Promise<unknown>, unknown[]>;
  let transaction: jest.Mock<Promise<unknown>, [(tx: unknown) => unknown]>;
  let prisma: PrismaService;

  beforeEach(() => {
    findUnique = jest.fn<Promise<unknown>, unknown[]>();
    update = jest.fn<Promise<unknown>, unknown[]>();
    transaction = jest.fn<Promise<unknown>, [(tx: unknown) => unknown]>(
      (callback) => Promise.resolve(callback({ user: { findUnique, update } })),
    );
    prisma = {
      user: { findUnique, update },
      $transaction: transaction,
    } as unknown as PrismaService;
    service = new CanonicalProfileService(prisma);
  });

  it("rejects malformed canonical IDs before querying persistence", async () => {
    await expect(service.getProfile("not-a-uuid")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns only the selected profile fields in the public response shape", async () => {
    findUnique.mockResolvedValue(profileRecord);

    await expect(service.getProfile(userId)).resolves.toEqual({
      id: userId,
      username: "canonical_user",
      email: "canonical@example.test",
      emailVerified: true,
      displayName: "Canonical User",
      profileImageUrl: null,
      pronouns: null,
      allowContactDiscovery: true,
      onboarding: { status: OnboardingStatus.IN_PROGRESS, completedAt: null },
      policy: {
        termsVersion: "terms-v1",
        termsAcceptedAt: profileRecord.termsAcceptedAt,
      },
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: userId } }),
    );
  });

  it("reports a missing profile without opening a transaction", async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.getProfile(userId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("normalizes profile updates inside one transaction and serializes the result", async () => {
    findUnique.mockResolvedValue({ id: userId });
    update.mockResolvedValue({
      ...profileRecord,
      username: "new_name",
      normalizedUsername: "new_name",
      displayName: "New Name",
      pronouns: "they/them",
      allowContactDiscovery: false,
    });

    await expect(
      service.updateProfile(userId, {
        username: " New_Name ",
        displayName: " New Name ",
        pronouns: " they/them ",
        allowContactDiscovery: false,
      } as UpdateCanonicalProfileDto),
    ).resolves.toMatchObject({
      username: "new_name",
      displayName: "New Name",
      pronouns: "they/them",
      allowContactDiscovery: false,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    const updateArgs: unknown = update.mock.calls[0]?.[0];
    const updateData = (
      updateArgs as { where: { id: string }; data: Record<string, unknown> }
    ).data;
    expect((updateArgs as { where: { id: string } }).where.id).toBe(userId);
    expect(updateData).toMatchObject({
      username: "new_name",
      normalizedUsername: "new_name",
      displayName: "New Name",
      pronouns: "they/them",
      allowContactDiscovery: false,
    });
    expect(updateData.usernameUpdatedAt).toBeInstanceOf(Date);
  });

  it("rejects invalid usernames without persisting profile changes", async () => {
    await expect(
      service.updateProfile(userId, {
        username: "_invalid_",
      } as UpdateCanonicalProfileDto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("reports a missing update target from the transaction", async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      service.updateProfile(userId, {
        displayName: "Missing",
      } as UpdateCanonicalProfileDto),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it("maps a duplicate-username database error to a conflict", async () => {
    findUnique.mockResolvedValue({ id: userId });
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    await expect(
      service.updateProfile(userId, {
        username: "already_used",
      } as UpdateCanonicalProfileDto),
    ).rejects.toThrow("Username is already in use");
  });

  it("does not translate unrelated persistence errors", async () => {
    findUnique.mockResolvedValue({ id: userId });
    const failure = new Error("database unavailable");
    update.mockRejectedValue(failure);
    await expect(
      service.updateProfile(userId, {
        displayName: "Name",
      } as UpdateCanonicalProfileDto),
    ).rejects.toBe(failure);
  });

  it("returns onboarding state from the canonical profile", async () => {
    findUnique.mockResolvedValue(profileRecord);
    await expect(service.getOnboarding(userId)).resolves.toEqual({
      status: OnboardingStatus.IN_PROGRESS,
      completedAt: null,
    });
  });

  it.each([
    [OnboardingStatus.NOT_STARTED, OnboardingStatus.COMPLETE],
    [OnboardingStatus.COMPLETE, OnboardingStatus.IN_PROGRESS],
  ])(
    "rejects invalid onboarding transition %s -> %s",
    async (current, next) => {
      findUnique.mockResolvedValue({ onboardingStatus: current });
      await expect(
        service.updateOnboarding(userId, {
          status: next,
        } as UpdateOnboardingDto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(update).not.toHaveBeenCalled();
    },
  );

  it("persists completion timestamps for COMPLETE and clears them on progress", async () => {
    findUnique.mockResolvedValue({
      onboardingStatus: OnboardingStatus.IN_PROGRESS,
    });
    update.mockResolvedValue({
      ...profileRecord,
      onboardingStatus: OnboardingStatus.COMPLETE,
      onboardingCompletedAt: new Date("2026-11-17T00:00:00.000Z"),
    });
    const completed = await service.updateOnboarding(userId, {
      status: OnboardingStatus.COMPLETE,
    } as UpdateOnboardingDto);
    expect(completed.status).toBe(OnboardingStatus.COMPLETE);
    expect(completed.completedAt).toBeInstanceOf(Date);
    const completeArgs: unknown = update.mock.calls[0]?.[0];
    const completeData = (completeArgs as { data: Record<string, unknown> })
      .data;
    expect(completeData.onboardingCompletedAt).toBeInstanceOf(Date);

    findUnique.mockResolvedValue({
      onboardingStatus: OnboardingStatus.NOT_STARTED,
    });
    update.mockResolvedValue({
      ...profileRecord,
      onboardingStatus: OnboardingStatus.IN_PROGRESS,
      onboardingCompletedAt: null,
    });
    await expect(
      service.updateOnboarding(userId, {
        status: OnboardingStatus.IN_PROGRESS,
      } as UpdateOnboardingDto),
    ).resolves.toEqual({
      status: OnboardingStatus.IN_PROGRESS,
      completedAt: null,
    });
    const progressArgs: unknown = update.mock.calls[1]?.[0];
    const progressData = (progressArgs as { data: Record<string, unknown> })
      .data;
    expect(progressData.onboardingCompletedAt).toBeNull();
  });

  it("maps a disappeared onboarding row to NotFound", async () => {
    findUnique.mockResolvedValue({
      onboardingStatus: OnboardingStatus.IN_PROGRESS,
    });
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("missing", {
        code: "P2025",
        clientVersion: "test",
      }),
    );
    await expect(
      service.updateOnboarding(userId, {
        status: OnboardingStatus.COMPLETE,
      } as UpdateOnboardingDto),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
