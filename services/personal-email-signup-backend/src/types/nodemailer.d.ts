declare module "nodemailer" {
  export interface TransportOptions {
    jsonTransport?: boolean;
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: { user?: string; pass?: string };
    connectionTimeout?: number;
    greetingTimeout?: number;
    socketTimeout?: number;
  }

  export interface SendMailOptions {
    from: string;
    to: string;
    subject: string;
    text: string;
    headers?: Record<string, string>;
  }

  export interface SentMessageInfo {
    accepted: string[];
    messageId?: string;
  }

  export interface Transporter {
    sendMail(options: SendMailOptions): Promise<SentMessageInfo>;
    verify(): Promise<void>;
  }

  export function createTransport(options: TransportOptions): Transporter;
}
