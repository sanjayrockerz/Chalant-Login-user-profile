import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { FcmTransportService } from "./transports/fcm-transport.service";
import { ApnsTransportService } from "./transports/apns-transport.service";
import { APNS_TRANSPORT, FCM_TRANSPORT } from "./notification.constants";

@Module({
  providers: [
    NotificationsService,
    { provide: FCM_TRANSPORT, useClass: FcmTransportService },
    { provide: APNS_TRANSPORT, useClass: ApnsTransportService },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
