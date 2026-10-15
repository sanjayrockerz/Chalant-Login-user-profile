import { ServiceUnavailableException } from "@nestjs/common";
import { ContactsService } from "./contacts.service";

describe("ContactsService secure discovery boundary", () => {
  function serviceWithHashMode(mode: string) {
    const service = Object.create(ContactsService.prototype) as any;
    service.configService = {
      get: jest.fn().mockReturnValue(mode),
    };
    return service;
  }

  it("rejects upload while legacy SHA-256 mode is active", async () => {
    const service = serviceWithHashMode("sha256-v1");

    await expect(
      service.uploadContacts(
        "00000000-0000-4000-8000-000000000001",
        {
          contacts: [],
          privacy_acknowledgment: true,
          data_retention_consent: true,
        },
        { correlationId: "test-correlation", tenantId: "test-tenant" },
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("rejects suggestions while legacy SHA-256 mode is active", async () => {
    const service = serviceWithHashMode("sha256-v1");

    await expect(
      service.getSuggestions(
        "00000000-0000-4000-8000-000000000001",
        {} as never,
        { correlationId: "test-correlation", tenantId: "test-tenant" },
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
