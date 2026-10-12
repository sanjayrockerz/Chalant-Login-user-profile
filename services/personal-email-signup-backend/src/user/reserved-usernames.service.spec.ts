// filepath: src/user/reserved-usernames.service.spec.ts
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { ReservedUsernamesService } from "./reserved-usernames.service";

describe("ReservedUsernamesService", () => {
  let service: ReservedUsernamesService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn().mockReturnValue([]), // Default to empty custom reserved list
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservedUsernamesService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<ReservedUsernamesService>(ReservedUsernamesService);
    configService = module.get(ConfigService);
  });

  describe("isReserved", () => {
    it("should identify system reserved usernames", () => {
      const systemReserved = [
        "admin",
        "root",
        "api",
        "support",
        "help",
        "www",
        "mail",
        "ftp",
        "ssh",
        "http",
        "https",
      ];

      systemReserved.forEach((username) => {
        const result = service.isReserved(username);
        expect(result.isReserved).toBe(true);
        expect(result.category).toBe("system");
        expect(result.reason).toContain("system");
      });
    });

    it("should identify API reserved usernames", () => {
      const apiReserved = [
        "get",
        "post",
        "put",
        "patch",
        "delete",
        "create",
        "read",
        "update",
        "list",
        "search",
      ];

      apiReserved.forEach((username) => {
        const result = service.isReserved(username);
        expect(result.isReserved).toBe(true);
        expect(result.category).toBe("api");
        expect(result.reason).toContain("API");
      });
    });

    it("should identify security reserved usernames", () => {
      const securityReserved = [
        "null",
        "undefined",
        "anonymous",
        "guest",
        "test",
        "demo",
        "example",
        "script",
        "eval",
      ];

      securityReserved.forEach((username) => {
        const result = service.isReserved(username);
        expect(result.isReserved).toBe(true);
        expect(result.category).toBe("security");
        expect(result.reason).toContain("security");
      });
    });

    it("should identify brand reserved usernames", () => {
      const brandReserved = [
        "colleging",
        "college",
        "university",
        "student",
        "facebook",
        "twitter",
        "google",
        "apple",
      ];

      brandReserved.forEach((username) => {
        const result = service.isReserved(username);
        expect(result.isReserved).toBe(true);
        expect(result.category).toBe("brand");
        expect(result.reason).toContain("brand");
      });
    });

    it("should be case-insensitive", () => {
      const variations = ["ADMIN", "Admin", "aDmIn", "admin"];

      variations.forEach((username) => {
        const result = service.isReserved(username);
        expect(result.isReserved).toBe(true);
        expect(result.category).toBe("system");
      });
    });

    it("should allow non-reserved usernames", () => {
      const allowedUsernames = [
        "john",
        "mary",
        "user123",
        "cool_user",
        "student123",
        "my_profile",
        "awesome.dev",
      ];

      allowedUsernames.forEach((username) => {
        const result = service.isReserved(username);
        expect(result.isReserved).toBe(false);
      });
    });

    it("should handle empty/null input", () => {
      expect(service.isReserved("").isReserved).toBe(false);
      expect(service.isReserved(null as any).isReserved).toBe(false);
      expect(service.isReserved(undefined as any).isReserved).toBe(false);
    });

    it("should detect pattern-based reservations", () => {
      const adminPatterns = [
        "administrator",
        "admin123",
        "mod_user",
        "staff_member",
      ];

      adminPatterns.forEach((username) => {
        const result = service.isReserved(username);
        expect(result.isReserved).toBe(true);
        expect(result.category).toBe("admin");
      });

      const systemPatterns = ["sys_user", "app_service", "api_client"];

      systemPatterns.forEach((username) => {
        const result = service.isReserved(username);
        expect(result.isReserved).toBe(true);
        expect(result.category).toBe("system");
      });

      const testPatterns = ["test_user", "demo_account", "sample_data"];

      testPatterns.forEach((username) => {
        const result = service.isReserved(username);
        expect(result.isReserved).toBe(true);
        expect(result.category).toBe("security");
      });
    });

    it("should reserve short numeric usernames", () => {
      const shortNumeric = ["1", "12", "123", "1234", "12345", "123456"];

      shortNumeric.forEach((username) => {
        const result = service.isReserved(username);
        expect(result.isReserved).toBe(true);
        expect(result.category).toBe("system");
        expect(result.reason).toContain("ID conflicts");
      });

      // But longer numeric should be allowed
      const result = service.isReserved("1234567");
      expect(result.isReserved).toBe(false);
    });

    it("should handle custom reserved usernames", () => {
      const customReserved = ["company_name", "special_term"];
      configService.get.mockReturnValue(customReserved);

      customReserved.forEach((username) => {
        const result = service.isReserved(username);
        expect(result.isReserved).toBe(true);
        expect(result.category).toBe("custom");
      });
    });
  });

  describe("getReservedCount", () => {
    it("should return accurate counts", () => {
      const counts = service.getReservedCount();

      expect(counts.system).toBeGreaterThan(0);
      expect(counts.api).toBeGreaterThan(0);
      expect(counts.security).toBeGreaterThan(0);
      expect(counts.brand).toBeGreaterThan(0);
      expect(counts.total).toBe(
        counts.system +
          counts.api +
          counts.security +
          counts.brand +
          counts.custom,
      );
    });

    it("should include custom reserved count", () => {
      const customReserved = ["custom1", "custom2", "custom3"];
      configService.get.mockReturnValue(customReserved);

      const counts = service.getReservedCount();
      expect(counts.custom).toBe(3);
      expect(counts.total).toBeGreaterThan(
        counts.system + counts.api + counts.security + counts.brand,
      );
    });
  });

  describe("isSimilarToReserved", () => {
    it("should detect substrings of reserved names", () => {
      const similar = service.isSimilarToReserved("admin123");
      expect(similar.similar).toBe(true);
      expect(similar.matches).toContain("admin");
    });

    it("should detect reserved names as substrings", () => {
      const similar = service.isSimilarToReserved("api");
      expect(similar.similar).toBe(true);
      expect(similar.matches).toContain("api");
    });

    it("should detect character substitution", () => {
      const substitutions = [
        { username: "adm1n", original: "admin" },
        { username: "r00t", original: "root" },
        { username: "supp0rt", original: "support" },
      ];

      substitutions.forEach(({ username, original }) => {
        const similar = service.isSimilarToReserved(username);
        expect(similar.similar).toBe(true);
        expect(similar.matches).toContain(original);
      });
    });

    it("should not flag unrelated usernames", () => {
      const unrelated = ["john", "mary", "unique_user", "completely_different"];

      unrelated.forEach((username) => {
        const similar = service.isSimilarToReserved(username);
        expect(similar.similar).toBe(false);
        expect(similar.matches).toHaveLength(0);
      });
    });
  });

  describe("addCustomReserved", () => {
    it("should add new custom reserved usernames", () => {
      const result = service.addCustomReserved("new_reserved", "Test reason");
      expect(result).toBe(true);
    });

    it("should handle duplicate additions gracefully", () => {
      configService.get.mockReturnValue(["existing"]);

      const result = service.addCustomReserved("existing", "Already exists");
      expect(result).toBe(false);
    });

    it("should normalize usernames when adding", () => {
      const result = service.addCustomReserved("NEW_RESERVED");
      expect(result).toBe(true);

      // Should now be reserved in lowercase
      const check = service.isReserved("new_reserved");
      expect(check.isReserved).toBe(true);
    });
  });

  describe("Performance and edge cases", () => {
    it("should handle large input efficiently", () => {
      const veryLongUsername = "a".repeat(1000);

      const start = Date.now();
      const result = service.isReserved(veryLongUsername);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(10); // Should complete quickly
      expect(result.isReserved).toBe(false);
    });

    it("should be consistent across multiple calls", () => {
      const username = "admin";
      const result1 = service.isReserved(username);
      const result2 = service.isReserved(username);

      expect(result1).toEqual(result2);
    });

    it("should handle special characters gracefully", () => {
      const specialChars = ["@admin", "#root", "$api", "%support"];

      specialChars.forEach((username) => {
        const result = service.isReserved(username);
        // These shouldn't crash the service
        expect(typeof result.isReserved).toBe("boolean");
      });
    });

    it("should maintain thread safety", async () => {
      const promises = Array.from({ length: 100 }, (_, i) =>
        Promise.resolve(service.isReserved(`user${i}`)),
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(100);

      // All should be false (not reserved)
      results.forEach((result) => {
        expect(result.isReserved).toBe(false);
      });
    });
  });

  describe("Security considerations", () => {
    it("should prevent enumeration of reserved names", () => {
      // The service should not leak information about which specific
      // reserved names exist through timing or error differences
      const testUsernames = ["admin", "notreserved"];

      testUsernames.forEach((username) => {
        const start = Date.now();
        const result = service.isReserved(username);
        const duration = Date.now() - start;

        // Response time should be consistently fast
        expect(duration).toBeLessThan(5);
        expect(typeof result.isReserved).toBe("boolean");
      });
    });

    it("should handle injection attempts safely", () => {
      const injectionAttempts = [
        "'; DROP TABLE users; --",
        "admin' OR '1'='1",
        "<script>alert('xss')</script>",
        "admin\x00null",
      ];

      injectionAttempts.forEach((attempt) => {
        expect(() => {
          const result = service.isReserved(attempt);
          expect(typeof result.isReserved).toBe("boolean");
        }).not.toThrow();
      });
    });
  });
});
