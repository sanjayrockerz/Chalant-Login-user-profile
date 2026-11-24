import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import {
  CreateSafetyOperationDto,
  DisclosureReservationDto,
  MatchReservationDto,
  SafetyDenyDto,
  SafetyRecoveryRequiredDto,
  SafetyReceiptDto,
} from "./safety-ordering.dto";
import { SafetyCaller, SafetyOrderingService } from "./safety-ordering.service";
import { SafetyServiceCredentialVerifier } from "./safety-service-credential-verifier";

const BASE_PATH = "/internal/v1/safety-operations";

@Controller("internal/v1/safety-operations")
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class SafetyOrderingController {
  constructor(
    private readonly safety: SafetyOrderingService,
    private readonly credentials: SafetyServiceCredentialVerifier,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async create(
    @Body() body: CreateSafetyOperationDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const caller = await this.authorize(
      "POST",
      BASE_PATH,
      body,
      headers,
      "safety:operations:request",
    );
    return this.safety.createOrGet(caller, body);
  }

  @Post("match-reservations")
  @HttpCode(HttpStatus.OK)
  async reserveMatch(
    @Body() body: MatchReservationDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const path = `${BASE_PATH}/match-reservations`;
    const caller = await this.authorize(
      "POST",
      path,
      body,
      headers,
      "safety:operations:match:reserve",
    );
    return this.safety.reserveMatch(caller, body);
  }

  @Post("disclosure-reservations")
  @HttpCode(HttpStatus.OK)
  async reserveDisclosure(
    @Body() body: DisclosureReservationDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const path = `${BASE_PATH}/disclosure-reservations`;
    const caller = await this.authorize(
      "POST",
      path,
      body,
      headers,
      "safety:operations:disclosure:reserve",
    );
    return this.safety.reserveDisclosure(caller, body);
  }

  @Get("recovery/work")
  async recoveryWork(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const path = `${BASE_PATH}/recovery/work`;
    const caller = await this.authorize(
      "GET",
      path,
      null,
      headers,
      "safety:operations:recover",
    );
    return this.safety.recoveryQueue(caller);
  }

  @Get(":operationId")
  async inspect(
    @Param("operationId", new ParseUUIDPipe()) operationId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const path = `${BASE_PATH}/${operationId}`;
    const caller = await this.authorize(
      "GET",
      path,
      null,
      headers,
      "safety:operations:inspect",
    );
    return this.safety.getOperation(operationId, caller);
  }

  @Get(":operationId/chat-verification")
  async inspectForChat(
    @Param("operationId", new ParseUUIDPipe()) operationId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const path = `${BASE_PATH}/${operationId}/chat-verification`;
    const caller = await this.authorize(
      "GET",
      path,
      null,
      headers,
      "safety:operations:chat:inspect",
    );
    return this.safety.getOperationForChat(operationId, caller);
  }

  @Get(":operationId/chat-match-verification")
  async inspectMatchForChat(
    @Param("operationId", new ParseUUIDPipe()) operationId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const path = `${BASE_PATH}/${operationId}/chat-match-verification`;
    const caller = await this.authorize(
      "GET",
      path,
      null,
      headers,
      "safety:operations:chat:match:inspect",
    );
    return this.safety.getMatchOperationForChat(operationId, caller);
  }

  @Post(":operationId/chat-pair-terminated")
  @HttpCode(HttpStatus.OK)
  async recordChatPairTermination(
    @Param("operationId", new ParseUUIDPipe()) operationId: string,
    @Body() body: SafetyReceiptDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    if (body.operationId !== operationId)
      throw new BadRequestException(
        "Receipt operation ID does not match route",
      );
    const path = `${BASE_PATH}/${operationId}/chat-pair-terminated`;
    const caller = await this.authorize(
      "POST",
      path,
      body,
      headers,
      "safety:receipts:chat",
    );
    return this.safety.recordChatPairTermination(caller, body);
  }

  @Post(":operationId/finalize")
  @HttpCode(HttpStatus.OK)
  async finalize(
    @Param("operationId", new ParseUUIDPipe()) operationId: string,
    @Body() body: SafetyReceiptDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    if (body.operationId !== operationId)
      throw new BadRequestException(
        "Receipt operation ID does not match route",
      );
    const path = `${BASE_PATH}/${operationId}/finalize`;
    const caller = await this.authorize(
      "POST",
      path,
      body,
      headers,
      "safety:operations:finalize",
    );
    return this.safety.finalize(caller, body);
  }

  @Post(":operationId/finalize-match")
  @HttpCode(HttpStatus.OK)
  async finalizeMatch(
    @Param("operationId", new ParseUUIDPipe()) operationId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const path = `${BASE_PATH}/${operationId}/finalize-match`;
    const caller = await this.authorize(
      "POST",
      path,
      null,
      headers,
      "safety:operations:finalize",
    );
    return this.safety.finalizeMatch(caller, operationId);
  }

  @Post(":operationId/finalize-disclosure")
  @HttpCode(HttpStatus.OK)
  async finalizeDisclosure(
    @Param("operationId", new ParseUUIDPipe()) operationId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const path = `${BASE_PATH}/${operationId}/finalize-disclosure`;
    const caller = await this.authorize(
      "POST",
      path,
      null,
      headers,
      "safety:operations:disclosure:finalize",
    );
    return this.safety.finalizeDisclosure(caller, operationId);
  }

  @Post(":operationId/abort-match")
  @HttpCode(HttpStatus.OK)
  async abortMatch(
    @Param("operationId", new ParseUUIDPipe()) operationId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const path = `${BASE_PATH}/${operationId}/abort-match`;
    const caller = await this.authorize(
      "POST",
      path,
      null,
      headers,
      "safety:operations:abort",
    );
    return this.safety.abortMatch(caller, operationId);
  }

  @Post(":operationId/abort")
  @HttpCode(HttpStatus.OK)
  async abort(
    @Param("operationId", new ParseUUIDPipe()) operationId: string,
    @Body() body: SafetyReceiptDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    if (body.operationId !== operationId)
      throw new BadRequestException(
        "Receipt operation ID does not match route",
      );
    const path = `${BASE_PATH}/${operationId}/abort`;
    const caller = await this.authorize(
      "POST",
      path,
      body,
      headers,
      "safety:operations:abort",
    );
    return this.safety.abort(caller, body);
  }

  @Post(":operationId/deny")
  @HttpCode(HttpStatus.OK)
  async deny(
    @Param("operationId", new ParseUUIDPipe()) operationId: string,
    @Body() body: SafetyDenyDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    if (body.operationId !== operationId)
      throw new BadRequestException(
        "Receipt operation ID does not match route",
      );
    const path = `${BASE_PATH}/${operationId}/deny`;
    const caller = await this.authorize(
      "POST",
      path,
      body,
      headers,
      "safety:operations:deny",
    );
    const { failureCode, ...receipt } = body;
    return this.safety.deny(caller, receipt, failureCode);
  }

  @Post(":operationId/recovery-required")
  @HttpCode(HttpStatus.OK)
  async markRecoveryRequired(
    @Param("operationId", new ParseUUIDPipe()) operationId: string,
    @Body() body: SafetyRecoveryRequiredDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const path = `${BASE_PATH}/${operationId}/recovery-required`;
    const caller = await this.authorize(
      "POST",
      path,
      body,
      headers,
      "safety:operations:recover",
    );
    return this.safety.markRecoveryRequired(
      caller,
      operationId,
      body.reasonCode,
    );
  }

  private async authorize(
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
    scope: string,
  ): Promise<SafetyCaller> {
    return this.credentials.verify(
      method,
      path,
      body,
      {
        serviceId: this.header(headers, "x-auth-service-id"),
        keyId: this.header(headers, "x-auth-key-id"),
        timestamp: this.header(headers, "x-auth-timestamp"),
        nonce: this.header(headers, "x-auth-nonce"),
        audience: this.header(headers, "x-auth-audience"),
        scope: this.header(headers, "x-auth-scope"),
        signature: this.header(headers, "x-auth-signature"),
      },
      scope,
    );
  }

  private header(
    headers: Record<string, string | string[] | undefined>,
    key: string,
  ): string {
    const value = headers[key];
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  }
}
