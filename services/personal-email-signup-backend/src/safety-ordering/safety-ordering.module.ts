import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { ConfigModule } from "../config/config.module";
import { SafetyOrderingController } from "./safety-ordering.controller";
import { SafetyOrderingService } from "./safety-ordering.service";
import { SafetyServiceCredentialVerifier } from "./safety-service-credential-verifier";
import { ProfilePairStateClient } from "./profile-pair-state.client";
import { ChatMatchJournalClient } from "./chat-match-journal.client";

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [SafetyOrderingController],
  providers: [
    SafetyOrderingService,
    SafetyServiceCredentialVerifier,
    ProfilePairStateClient,
    ChatMatchJournalClient,
  ],
  exports: [SafetyOrderingService],
})
export class SafetyOrderingModule {}
