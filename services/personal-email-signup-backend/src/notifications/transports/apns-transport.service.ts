import { Injectable, Logger } from '@nestjs/common';
import { NotificationTransport, NotificationTransportContext, NotificationTransportResponse } from '../interfaces/notification-transport.interface';
import { NotificationPayload } from '../dto/notification.dto';

@Injectable()
export class ApnsTransportService implements NotificationTransport {
  private readonly logger = new Logger(ApnsTransportService.name);

  async send(
    deviceToken: string,
    payload: NotificationPayload,
    context: NotificationTransportContext
  ): Promise<NotificationTransportResponse> {
    this.logger.warn({
      message: 'APNs transport not yet implemented',
      tokenId: context.tokenId,
      correlationId: context.correlationId
    });

    return {
      success: false,
      errorCode: 'APNS_NOT_IMPLEMENTED',
      retryable: false
    };
  }
}
