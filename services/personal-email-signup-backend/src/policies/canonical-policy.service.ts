import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.module";
import { ConfigService } from "../config/config.service";
import { AcceptPolicyDto } from "./canonical-policy.dto";

@Injectable()
export class CanonicalPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async accept(userId: string, input: AcceptPolicyDto) {
    const activeVersion = this.config.get("ACTIVE_POLICY_VERSION");
    if (input.policyVersion !== activeVersion) {
      throw new BadRequestException("Unknown policy version");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, termsVersion: true, termsAcceptedAt: true },
        });
        if (!user) throw new NotFoundException("Profile not found");

        const acceptedAt =
          user.termsVersion === input.policyVersion && user.termsAcceptedAt
            ? user.termsAcceptedAt
            : new Date();

        await tx.user.update({
          where: { id: userId },
          data: {
            termsVersion: input.policyVersion,
            termsAcceptedAt: acceptedAt,
          },
        });

        await tx.policyAcceptance.upsert({
          where: {
            userId_policyVersion: {
              userId,
              policyVersion: input.policyVersion,
            },
          },
          update: { acceptedAt, source: "api" },
          create: {
            userId,
            policyVersion: input.policyVersion,
            acceptedAt,
            source: "api",
          },
        });

        return {
          ok: true,
          policyVersion: input.policyVersion,
          acceptedAt,
        };
      });
    } catch (error: unknown) {
      if (error instanceof NotFoundException) throw error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003"
      ) {
        throw new NotFoundException("Profile not found");
      }
      throw error;
    }
  }
}
