import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  ValidateNested,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  Matches,
  ValidateIf,
} from "class-validator";

export const SAFETY_OPERATION_TYPES = [
  "ACCOUNT_MUTATION",
  "BLOCK",
  "UNBLOCK",
  "MATCH",
  "DISCLOSURE",
] as const;

export class CreateSafetyOperationDto {
  @IsUUID()
  operationId!: string;

  @IsIn(SAFETY_OPERATION_TYPES)
  type!: (typeof SAFETY_OPERATION_TYPES)[number];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsUUID(undefined, { each: true })
  subjects!: string[];

  @IsOptional()
  @IsString()
  @Length(64, 64)
  @Matches(/^[a-f0-9]{64}$/i)
  commandHash?: string;
}

export class MatchParticipantBindingDto {
  @IsUUID()
  authSubject!: string;

  @IsUUID()
  searchId!: string;

  @IsUUID()
  originatingSessionId!: string;

  @IsString()
  @Matches(/^[1-9]\d{0,18}$/)
  generation!: string;
}

export class MatchReservationDto {
  @IsUUID()
  operationId!: string;

  @IsUUID()
  chatOperationId!: string;

  @IsUUID()
  proposalId!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => MatchParticipantBindingDto)
  participants!: MatchParticipantBindingDto[];
}

export class SafetyReceiptDto {
  @IsString()
  @Length(1, 128)
  receiptId!: string;

  @IsUUID()
  operationId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @Matches(/^(account:[0-9a-f-]{36}|pair:[0-9a-f-]{36}:[0-9a-f-]{36})$/, {
    each: true,
  })
  resourceKeys!: string[];

  @IsString()
  @Length(1, 40)
  @IsIn([
    "AUTH_SOURCE_COMMITTED",
    "PROFILE_SOURCE_COMMITTED",
    "CHAT_PAIR_TERMINATED",
    "NO_PROTECTED_EFFECT",
  ])
  kind!: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  transactionId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Matches(/^[a-f0-9]{64}$/i)
  payloadHash?: string;

  @IsDateString()
  committedAt!: string;

  @IsOptional()
  @IsObject()
  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Object)
  revisions?: Record<string, unknown>;
}

export class SafetyOperationIdDto {
  @IsUUID()
  operationId!: string;
}

export class SafetyRecoveryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SafetyDenyDto extends SafetyReceiptDto {
  @IsString()
  @Length(2, 96)
  @Matches(/^[A-Z][A-Z0-9_]+$/)
  failureCode!: string;
}

export class SafetyRecoveryRequiredDto {
  @IsString()
  @Length(2, 96)
  @Matches(/^[A-Z][A-Z0-9_]+$/)
  reasonCode!: string;
}
