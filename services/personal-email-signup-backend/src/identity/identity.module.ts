import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { IdentityService } from "./identity.service";
import { PrismaIdentityRepository } from "./identity.repository";

@Module({
  imports: [PrismaModule],
  providers: [
    PrismaIdentityRepository,
    {
      provide: "IdentityRepositoryPort",
      useExisting: PrismaIdentityRepository,
    },
    IdentityService,
  ],
  exports: [IdentityService],
})
export class IdentityModule {}
