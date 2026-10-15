import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.module";
import { RedisService } from "../redis/redis.service";

export interface LocalUser {
  id: string;
  username: string;
  email: string;
  password: string;
  isVerified: boolean;
  verificationToken?: string | null;
  // Optional policy acceptance fields
  termsVersion?: string | null;
  termsAcceptedAt?: Date | null;
  phone?: string | null;
  phoneVerifiedAt?: Date | null;
  hashedPhone?: string | null;
  // Optional identity fields
  displayName?: string | null;
  declaredAge?: number | null;
  profileImageUrl?: string | null;
  pronouns?: string | null;
  // Normalized/display username fields
  normalizedUsername?: string | null;
  displayUsername?: string | null;
  usernameUpdatedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class UserService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}
  onModuleDestroy() {
    // PrismaService owns the shared client lifecycle for the application.
  }

  async onModuleInit() {
    console.log("Initializing Prisma Client...");
    await this.prisma.$connect();
    console.log("Prisma Client Initialized");
  }

  async close() {
    if (this.prisma) {
      await this.prisma.$disconnect(); // Properly disconnect Prisma
    }
  }

  async findByUsername(username: string): Promise<LocalUser | null> {
    try {
      const user = await this.prisma.user.findUnique({ where: { username } });
      return user ? this.mapPrismaUserToLocalUser(user) : null;
    } catch (error) {
      console.error("Error finding user by username:", error);
      throw new Error("Database error while finding user by username");
    }
  }

  async findByNormalizedUsername(
    normalized: string,
  ): Promise<LocalUser | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { normalizedUsername: normalized } as any,
      });
      return user ? this.mapPrismaUserToLocalUser(user) : null;
    } catch (error) {
      console.error("Error finding user by normalized username:", error);
      throw new Error(
        "Database error while finding user by normalized username",
      );
    }
  }

  async findByEmail(email: string): Promise<LocalUser | null> {
    try {
      const user = await this.prisma.user.findUnique({ where: { email } });
      return user ? this.mapPrismaUserToLocalUser(user) : null;
    } catch (error) {
      console.error("Error finding user by email:", error);
      throw new Error("Database error while finding user by email");
    }
  }

  async findByVerificationToken(token: string): Promise<LocalUser | null> {
    const userId = await this.redisService.get<string>(
      `legacy:email-verification:${token}`,
    );
    return userId ? this.findById(userId) : null;
  }

  async createUser(userData: Partial<LocalUser>): Promise<LocalUser> {
    try {
      const createdUser = await this.prisma.user.create({
        data: {
          username: userData.username as string,
          normalizedUsername: (userData as any).normalizedUsername || null,
          displayUsername: (userData as any).displayUsername || null,
          email: userData.email as string,
          password: userData.password as string,
          displayName: userData.displayName || null,
          declaredAge: userData.declaredAge || null,
          profileImageUrl: userData.profileImageUrl || null,
          pronouns: userData.pronouns || null,
          usernameUpdatedAt: (userData as any).usernameUpdatedAt || null,
        },
      });
      return this.mapPrismaUserToLocalUser(createdUser);
    } catch (error) {
      console.error("Error creating user:", error);
      throw new Error("Database error while creating user");
    }
  }

  async updateUser(
    id: string,
    updatedData: Partial<LocalUser>,
  ): Promise<LocalUser> {
    try {
      const updatedUser = await this.prisma.user.update({
        where: { id },
        data: updatedData,
      });
      return this.mapPrismaUserToLocalUser(updatedUser);
    } catch (error) {
      console.error("Error updating user:", error);
      throw new Error("Database error while updating user");
    }
  }

  async saveVerificationToken(userId: string, token: string): Promise<void> {
    await this.redisService.set(`legacy:email-verification:${token}`, userId, {
      ttl: 24 * 60 * 60,
    });
  }

  async markVerified(userId: string): Promise<LocalUser> {
    try {
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: {
          isVerified: true,
          updatedAt: new Date(),
        },
      });

      console.log("User marked as verified:", userId);
      return this.mapPrismaUserToLocalUser(updatedUser);
    } catch (error) {
      console.error("Error marking user as verified:", error);
      throw new Error("Database error while marking user as verified");
    }
  }

  async findById(id: string): Promise<LocalUser | null> {
    try {
      const user = await this.prisma.user.findUnique({ where: { id } });
      return user ? this.mapPrismaUserToLocalUser(user) : null;
    } catch (error) {
      console.error("Error finding user by ID:", error);
      throw new Error("Database error while finding user by ID");
    }
  }

  async updatePassword(userId: string, newPassword: string): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { password: newPassword },
      });
    } catch (error) {
      console.error("Error updating user password:", error);
      throw new Error("Database error while updating password");
    }
  }

  async deleteUser(userId: string): Promise<void> {
    try {
      await this.prisma.user.delete({
        where: { id: userId },
      });
    } catch (error) {
      console.error("Error deleting user:", error);
      throw new Error("Database error while deleting user");
    }
  }

  private mapPrismaUserToLocalUser(user: any): LocalUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      password: user.password,
      isVerified: user.isVerified,
      termsVersion: user.termsVersion || null,
      termsAcceptedAt: user.termsAcceptedAt || null,
      phone: (user as any).phone || null,
      phoneVerifiedAt: (user as any).phoneVerifiedAt || null,
      hashedPhone: (user as any).hashedPhone || null,
      displayName: user.displayName || null,
      declaredAge: user.declaredAge || null,
      profileImageUrl: user.profileImageUrl || null,
      pronouns: user.pronouns || null,
      normalizedUsername: user.normalizedUsername || null,
      displayUsername: user.displayUsername || null,
      usernameUpdatedAt: user.usernameUpdatedAt || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
