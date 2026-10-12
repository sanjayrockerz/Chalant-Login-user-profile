import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { CanonicalAuthModule } from "../canonical-auth/canonical-auth.module";
import { CanonicalPolicyController } from "./canonical-policy.controller";
import { CanonicalPolicyService } from "./canonical-policy.service";

@Module({
  imports: [PrismaModule, CanonicalAuthModule],
  controllers: [CanonicalPolicyController],
  providers: [CanonicalPolicyService],
  exports: [CanonicalPolicyService],
})
export class CanonicalPolicyModule {}
