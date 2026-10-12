import { UserService } from "./user.service";
import { CreateUserDto } from "../auth_cc/dto/create-user.dto";

// Helper to create complete mock user objects
const createMockUser = (overrides?: any) => ({
  id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  username: "testuser",
  email: "test@example.com",
  password: "hashedPassword",
  isVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  termsVersion: null,
  termsAcceptedAt: null,
  phone: null,
  phoneVerifiedAt: null,
  hashedPhone: null,
  displayName: null,
  declaredAge: null,
  profileImageUrl: null,
  pronouns: null,
  normalizedUsername: null,
  displayUsername: null,
  usernameUpdatedAt: null,
  ...overrides,
});

describe("UserService", () => {
  let service: UserService;
  let mockPrismaClient: any;
  let mockRedisService: { set: jest.Mock; get: jest.Mock };

  beforeEach(() => {
    // Create fresh mocks for each test
    mockPrismaClient = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
    };

    // Directly instantiate the service with mock Prisma
    mockRedisService = {
      set: jest.fn(),
      get: jest.fn(),
    };
    service = new UserService(mockPrismaClient, mockRedisService as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("findByUsername", () => {
    it("should return user when found", async () => {
      const mockUser = {
        id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        username: "testuser",
        email: "test@example.com",
        password: "hashedPassword",
        isVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        termsVersion: null,
        termsAcceptedAt: null,
        phone: null,
        phoneVerifiedAt: null,
        hashedPhone: null,
        displayName: null,
        declaredAge: null,
        profileImageUrl: null,
        pronouns: null,
        normalizedUsername: null,
        displayUsername: null,
        usernameUpdatedAt: null,
      };

      mockPrismaClient.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findByUsername("testuser");

      expect(result).toEqual(mockUser);
      expect(mockPrismaClient.user.findUnique).toHaveBeenCalledWith({
        where: { username: "testuser" },
      });
    });

    it("should return null when user not found", async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const result = await service.findByUsername("nonexistent");

      expect(result).toBeNull();
    });

    it("should handle database errors", async () => {
      const error = new Error("Database error");
      mockPrismaClient.user.findUnique.mockRejectedValue(error);

      await expect(service.findByUsername("testuser")).rejects.toThrow(
        "Database error",
      );
    });
  });

  describe("findByEmail", () => {
    it("should return user when found", async () => {
      const mockUser = createMockUser();
      mockPrismaClient.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findByEmail("test@example.com");

      expect(result).toEqual(mockUser);
    });

    it("should return null when user not found", async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const result = await service.findByEmail("nonexistent@example.com");

      expect(result).toBeNull();
    });
  });

  describe("createUser", () => {
    it("should create and return user", async () => {
      const createUserDto: CreateUserDto = {
        username: "newuser",
        email: "new@example.com",
        password: "hashedPassword",
      };

      const createdUser = createMockUser({
        username: "newuser",
        email: "new@example.com",
        password: "hashedPassword",
      });

      mockPrismaClient.user.create.mockResolvedValue(createdUser);

      const result = await service.createUser(createUserDto);

      expect(result).toEqual(createdUser);
    });

    it("should handle creation errors", async () => {
      const createUserDto: CreateUserDto = {
        username: "newuser",
        email: "new@example.com",
        password: "hashedPassword",
      };

      const error = new Error("Duplicate key");
      mockPrismaClient.user.create.mockRejectedValue(error);

      await expect(service.createUser(createUserDto)).rejects.toThrow(
        "Database error while creating user",
      );
    });
  });

  describe("updateUser", () => {
    it("should update and return user", async () => {
      const updatedUser = createMockUser({ isVerified: true });

      mockPrismaClient.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateUser(
        "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        { isVerified: true },
      );

      expect(result).toEqual(updatedUser);
    });

    it("should handle update errors", async () => {
      const error = new Error("User not found");
      mockPrismaClient.user.update.mockRejectedValue(error);

      await expect(
        service.updateUser("f47ac10b-58cc-4372-a567-0e02b2c3d479", {
          isVerified: true,
        }),
      ).rejects.toThrow("Database error while updating user");
    });
  });

  describe("findByVerificationToken", () => {
    it("should return user when found", async () => {
      const mockUser = createMockUser();
      mockRedisService.get.mockResolvedValue(mockUser.id);
      mockPrismaClient.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findByVerificationToken("token123");

      expect(result).toEqual(mockUser);
    });

    it("should return null when user not found", async () => {
      mockRedisService.get.mockResolvedValue(null);

      const result = await service.findByVerificationToken("invalidtoken");

      expect(result).toBeNull();
    });
  });

  describe("saveVerificationToken", () => {
    it("should save verification token", async () => {
      await service.saveVerificationToken(
        "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "new-token",
      );

      expect(mockRedisService.set).toHaveBeenCalledWith(
        "legacy:email-verification:new-token",
        "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        { ttl: 24 * 60 * 60 },
      );
    });
  });
});
