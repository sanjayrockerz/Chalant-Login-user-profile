import { z } from "zod";

export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  notificationType?: string;
  correlationId?: string;
  priority?: "normal" | "high";
}

export const notificationPayloadSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  data: z.record(z.string(), z.string()).optional(),
  notificationType: z.string().optional(),
  correlationId: z.string().uuid().optional(),
  priority: z.enum(["normal", "high"]).optional(),
});
