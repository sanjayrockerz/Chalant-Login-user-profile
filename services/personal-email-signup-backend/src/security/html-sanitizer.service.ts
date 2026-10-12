import { Injectable } from "@nestjs/common";
import createDOMPurify from "dompurify";
import type { Config as DomPurifyConfig } from "dompurify";
import { JSDOM } from "jsdom";

@Injectable()
export class HtmlSanitizerService {
  private readonly domPurify: ReturnType<typeof createDOMPurify>;

  constructor() {
    const window = new JSDOM("").window;
    this.domPurify = createDOMPurify(window as unknown as any);
  }

  sanitize(
    input: string | null | undefined,
    options: DomPurifyConfig = {},
  ): string {
    if (!input) {
      return "";
    }

    return this.domPurify.sanitize(input, {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: [],
      ...options,
    });
  }

  sanitizeToText(input: string | null | undefined): string {
    const sanitized = this.sanitize(input);
    return sanitized.replace(/\s+/g, " ").trim();
  }
}
