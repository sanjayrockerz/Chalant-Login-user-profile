import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createTransport, Transporter } from "nodemailer";
import { ConfigService } from "../config/config.service";

export interface EmailOptions {
  correlationId?: string;
  tenantId?: string;
  priority?: "high" | "normal" | "low";
}

export interface OTPEmailData {
  email: string;
  otp: string;
  expirationMinutes: number;
}

export interface EmailDeliveryResult {
  accepted: boolean;
  providerMessageId?: string;
}

export interface EmailHealthResult {
  status: "disabled" | "configured" | "unhealthy";
  details?: string;
}

type EmailTransport = Transporter;

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly enabled: boolean;
  private readonly provider: "smtp" | "test";
  private readonly sender: string;
  private readonly transport?: EmailTransport;

  constructor(private readonly config: ConfigService) {
    this.enabled = config.get("EMAIL_DELIVERY_ENABLED");
    this.provider = config.get("EMAIL_PROVIDER");
    this.sender = config.get("EMAIL_FROM");

    if (!this.enabled) return;

    if (this.provider === "test") {
      if (config.get("NODE_ENV") !== "test") {
        throw new Error("Test email transport is only permitted in test mode");
      }
      this.transport = createTransport({ jsonTransport: true });
      return;
    }

    const host = config.get("EMAIL_SMTP_HOST");
    const port = config.get("EMAIL_SMTP_PORT");
    if (!host || !port || !this.sender) {
      throw new Error(
        "SMTP email delivery requires EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, and EMAIL_FROM",
      );
    }

    this.transport = createTransport({
      host,
      port,
      secure: config.get("EMAIL_SMTP_SECURE"),
      auth: config.get("EMAIL_SMTP_USER")
        ? {
            user: config.get("EMAIL_SMTP_USER"),
            pass: config.get("EMAIL_SMTP_PASSWORD"),
          }
        : undefined,
      connectionTimeout: config.get("EMAIL_SMTP_TIMEOUT_MS"),
      greetingTimeout: config.get("EMAIL_SMTP_TIMEOUT_MS"),
      socketTimeout: config.get("EMAIL_SMTP_TIMEOUT_MS"),
    });
  }

  async sendOTP(
    data: OTPEmailData,
    options: EmailOptions = {},
  ): Promise<EmailDeliveryResult> {
    return this.send(
      data.email,
      "Your verification code",
      `Your verification code is ${data.otp}. It expires in ${data.expirationMinutes} minutes.`,
      options,
    );
  }

  async sendWelcome(
    email: string,
    username: string,
    options: EmailOptions = {},
  ): Promise<EmailDeliveryResult> {
    return this.send(
      email,
      "Welcome",
      `Welcome, ${this.safeText(username)}.`,
      options,
    );
  }

  async sendPasswordReset(
    email: string,
    resetToken: string,
    options: EmailOptions = {},
  ): Promise<EmailDeliveryResult> {
    const baseUrl = this.config.get("PASSWORD_RESET_BASE_URL");
    const resetUrl = baseUrl
      ? `${baseUrl.replace(/\/$/, "")}?token=${encodeURIComponent(resetToken)}`
      : resetToken;
    return this.send(
      email,
      "Reset your password",
      `Use this password reset link: ${resetUrl}`,
      options,
    );
  }

  async sendVerificationEmail(
    email: string,
    verificationToken: string,
    options: { correlation_id?: string; tenant_id?: string } = {},
  ): Promise<EmailDeliveryResult> {
    const baseUrl = this.config.get("EMAIL_VERIFY_BASE_URL");
    const verificationUrl = baseUrl
      ? `${baseUrl.replace(/\/$/, "")}?token=${encodeURIComponent(verificationToken)}`
      : verificationToken;
    return this.send(
      email,
      "Verify your email address",
      `Use this verification link: ${verificationUrl}`,
      { correlationId: options.correlation_id, tenantId: options.tenant_id },
    );
  }

  async sendSecurityAlert(
    email: string,
    alertType: string,
    _details: unknown,
    options: EmailOptions = {},
  ): Promise<EmailDeliveryResult> {
    return this.send(
      email,
      "Account security notification",
      `A security event occurred on your account: ${this.safeText(alertType)}.`,
      options,
    );
  }

  async healthCheck(): Promise<EmailHealthResult> {
    if (!this.enabled) {
      return { status: "disabled", details: "Email delivery is disabled" };
    }
    if (!this.transport) {
      return { status: "unhealthy", details: "Email transport is unavailable" };
    }
    if (this.provider === "test") return { status: "configured" };

    try {
      await this.transport.verify();
      return { status: "configured" };
    } catch {
      return { status: "unhealthy", details: "SMTP provider is unreachable" };
    }
  }

  private async send(
    recipient: string,
    subject: string,
    text: string,
    options: EmailOptions,
  ): Promise<EmailDeliveryResult> {
    if (!this.enabled || !this.transport) {
      throw new ServiceUnavailableException("Email delivery is not enabled");
    }

    try {
      const result = await this.transport.sendMail({
        from: this.sender,
        to: recipient,
        subject,
        text,
        headers: options.correlationId
          ? { "X-Correlation-ID": options.correlationId }
          : undefined,
      });
      return {
        accepted:
          this.provider === "test" || result.accepted.includes(recipient),
        providerMessageId: result.messageId,
      };
    } catch (error) {
      this.logger.warn("Email provider rejected delivery", {
        provider: this.provider,
        correlationId: options.correlationId,
        tenantId: options.tenantId,
      });
      throw new ServiceUnavailableException("Email delivery failed", {
        cause: error,
      });
    }
  }

  private safeText(value: string): string {
    return value.replace(/[\r\n]/g, " ").slice(0, 200);
  }
}
