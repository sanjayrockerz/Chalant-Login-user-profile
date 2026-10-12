import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { OnboardingStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.module";
import {
  hasConsecutiveSpecials,
  isValidUsernameForm,
  normalizeUsername,
  startsOrEndsWithSpecial,
} from "../validation/normalizers/username.normalizer";
import { CanonicalUserId, toCanonicalUserId } from "../identity/identity.types";
import {
  UpdateCanonicalProfileDto,
  UpdateOnboardingDto,
} from "./canonical-profile.dto";

const profileSelect = {
  id: true,
  username: true,
  email: true,
  isVerified: true,
  displayName: true,
  profileImageUrl: true,
  pronouns: true,
  allowContactDiscovery: true,
  onboardingStatus: true,
  onboardingCompletedAt: true,
  termsVersion: true,
  termsAcceptedAt: true,
} satisfies Prisma.UserSelect;

type ProfileRecord = Prisma.UserGetPayload<{ select: typeof profileSelect }>;

function parseUserId(value: string): CanonicalUserId {
  try {
    return toCanonicalUserId(value);
  } catch {
    throw new BadRequestException("Invalid canonical user identifier");
  }
}

function serializeProfile(user: ProfileRecord) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: user.isVerified,
    displayName: user.displayName,
    profileImageUrl: user.profileImageUrl,
    pronouns: user.pronouns,
    allowContactDiscovery: user.allowContactDiscovery,
    onboarding: {
      status: user.onboardingStatus,
      completedAt: user.onboardingCompletedAt,
    },
    policy: {
      termsVersion: user.termsVersion,
      termsAcceptedAt: user.termsAcceptedAt,
    },
  };
}

@Injectable()
export class CanonicalProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: parseUserId(userId) },
      select: profileSelect,
    });
    if (!user) throw new NotFoundException("Profile not found");
    return serializeProfile(user);
  }

  async updateProfile(userId: string, input: UpdateCanonicalProfileDto) {
    const canonicalUserId = parseUserId(userId);
    const data: Prisma.UserUpdateInput = {};

    if (input.username !== undefined) {
      const username = normalizeUsername(input.username);
      if (
        !isValidUsernameForm(username) ||
        hasConsecutiveSpecials(username) ||
        startsOrEndsWithSpecial(username)
      ) {
        throw new ConflictException("Username is not available");
      }
      data.username = username;
      data.normalizedUsername = username;
      data.usernameUpdatedAt = new Date();
    }
    if (input.displayName !== undefined)
      data.displayName = input.displayName?.trim() || null;
    if (input.profileImageUrl !== undefined)
      data.profileImageUrl = input.profileImageUrl || null;
    if (input.pronouns !== undefined)
      data.pronouns = input.pronouns?.trim() || null;
    if (input.allowContactDiscovery !== undefined)
      data.allowContactDiscovery = input.allowContactDiscovery;

    try {
      const updated = await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.user.findUnique({
          where: { id: canonicalUserId },
          select: { id: true },
        });
        if (!existing) throw new NotFoundException("Profile not found");
        return transaction.user.update({
          where: { id: canonicalUserId },
          data,
          select: profileSelect,
        });
      });
      return serializeProfile(updated);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Username is already in use");
      }
      throw error;
    }
  }

  async getOnboarding(userId: string) {
    const profile = await this.getProfile(userId);
    return profile.onboarding;
  }

  async updateOnboarding(userId: string, input: UpdateOnboardingDto) {
    const canonicalUserId = parseUserId(userId);
    const completedAt =
      input.status === OnboardingStatus.COMPLETE ? new Date() : null;
    try {
      const updated = await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.user.findUnique({
          where: { id: canonicalUserId },
          select: { onboardingStatus: true },
        });
        if (!current) throw new NotFoundException("Profile not found");
        if (
          (current.onboardingStatus === OnboardingStatus.NOT_STARTED &&
            input.status === OnboardingStatus.COMPLETE) ||
          (current.onboardingStatus === OnboardingStatus.COMPLETE &&
            input.status !== OnboardingStatus.COMPLETE)
        ) {
          throw new BadRequestException("Invalid onboarding transition");
        }
        return transaction.user.update({
          where: { id: canonicalUserId },
          data: {
            onboardingStatus: input.status,
            onboardingCompletedAt: completedAt,
          },
          select: profileSelect,
        });
      });
      return serializeProfile(updated).onboarding;
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new NotFoundException("Profile not found");
      }
      throw error;
    }
  }
}
