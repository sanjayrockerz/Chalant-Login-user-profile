import { IsString, MaxLength, MinLength } from "class-validator";

export class AcceptPolicyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  policyVersion!: string;
}
