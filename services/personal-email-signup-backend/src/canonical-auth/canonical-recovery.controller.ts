import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { IsEmail, IsString, MinLength } from "class-validator";
import { CanonicalRecoveryService } from "./canonical-recovery.service";

class RecoveryRequestDto {
  @IsEmail()
  email!: string;
}

class RecoveryResetDto {
  @IsString()
  @MinLength(32)
  token!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

@Controller("auth/recovery")
export class CanonicalRecoveryController {
  constructor(private readonly recovery: CanonicalRecoveryService) {}

  @Post("request")
  @HttpCode(HttpStatus.ACCEPTED)
  request(@Body() dto: RecoveryRequestDto) {
    return this.recovery.requestReset(dto.email);
  }

  @Post("reset")
  @HttpCode(HttpStatus.NO_CONTENT)
  async reset(@Body() dto: RecoveryResetDto): Promise<void> {
    await this.recovery.resetPassword(dto.token, dto.password);
  }
}
