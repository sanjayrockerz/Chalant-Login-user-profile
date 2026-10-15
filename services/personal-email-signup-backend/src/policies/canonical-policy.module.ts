import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { ConfigModule } from "../config/config.module";
import { CanonicalAuthModule } from "../canonical-auth/canonical-auth.module";
import { CanonicalPolicyController } from "./canonical-policy.controller";
import { CanonicalPolicyService } from "./canonical-policy.service";

@Module({
  imports: [PrismaModule, ConfigModule, CanonicalAuthModule],
  controllers: [CanonicalPolicyController],
  providers: [CanonicalPolicyService],
  exports: [CanonicalPolicyService],
})
export class CanonicalPolicyModule {}
