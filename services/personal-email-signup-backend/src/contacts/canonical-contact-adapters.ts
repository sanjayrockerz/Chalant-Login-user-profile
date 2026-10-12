import { Injectable } from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import { normalizePhone } from "../validation/normalizers/phone.normalizer";
import {
  hash,
  hashWithKey,
  assertHmacKey,
  verify,
  verifyWithKey,
} from "../security/phone-hash/phone-hash.util";
import { PhoneHashingPort, PhoneNormalizationPort } from "./contacts.tokens";

@Injectable()
export class CanonicalPhoneNormalizationAdapter
  implements PhoneNormalizationPort
{
  normalize(input: string) {
    const normalized = normalizePhone(input);
    return {
      e164: normalized.e164,
      countryCode: String(normalized.country),
      region: String(normalized.country),
      nationalNumber: normalized.nationalNumber,
    };
  }
}

@Injectable()
export class CanonicalPhoneHashingAdapter implements PhoneHashingPort {
  private readonly mode: "sha256-v1" | "hmac-sha256-v2";
  private readonly key?: string;

  constructor(config: ConfigService) {
    this.mode = config.get("CONTACT_HASH_MODE");
    this.key = config.get("CONTACT_HMAC_KEY");

    if (this.mode === "hmac-sha256-v2") {
      if (!this.key) {
        throw new Error(
          "CONTACT_HMAC_KEY is required when CONTACT_HASH_MODE=hmac-sha256-v2",
        );
      }
      assertHmacKey(this.key);
    }
  }

  hash(input: string): string {
    if (this.mode === "hmac-sha256-v2") {
      return hashWithKey(input, this.getHmacKey());
    }
    return hash(input);
  }

  verify(input: string, digest: string): boolean {
    if (this.mode === "hmac-sha256-v2") {
      return verifyWithKey(input, digest, this.getHmacKey());
    }
    return verify(input, digest);
  }

  private getHmacKey(): string {
    if (!this.key) {
      throw new Error(
        "CONTACT_HMAC_KEY is required when CONTACT_HASH_MODE=hmac-sha256-v2",
      );
    }
    return this.key;
  }
}
