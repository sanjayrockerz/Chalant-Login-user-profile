export class IdentityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityValidationError";
  }
}

export class IdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityConflictError";
  }
}

export class IdentityNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityNotFoundError";
  }
}

export class UnauthorizedIdentityLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedIdentityLinkError";
  }
}
