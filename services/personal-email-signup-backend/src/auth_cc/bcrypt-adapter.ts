// Lightweight adapter that prefers native `bcrypt` but falls back to `bcryptjs` when
// the native module isn't available (useful for dev/test environments without
// native build toolchain). This file provides the small subset of APIs used by
// the codebase: genSalt, hash, compare.

let impl: any;
try {
  // Prefer native bcrypt when available
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  impl = require("bcrypt");
} catch (err) {
  // Fallback to bcryptjs (pure JS)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  impl = require("bcryptjs");
}

export const genSalt = (rounds?: number): Promise<string> => {
  // bcryptjs returns a callback-style API for genSalt; wrap to promise for parity
  if (impl.genSalt.length === 1) {
    return new Promise((resolve, reject) => {
      impl.genSalt((err: Error, salt: string) => {
        if (err) return reject(err);
        resolve(salt);
      });
    });
  }
  return impl.genSalt(rounds);
};

export const hash = (data: string, saltOrRounds: any): Promise<string> => {
  // bcryptjs has same signature but may be sync if rounds is number; use promise wrapper
  return new Promise((resolve, reject) => {
    impl.hash(data, saltOrRounds, (err: Error, hashed: string) => {
      if (err) return reject(err);
      resolve(hashed);
    });
  });
};

export const compare = (data: string, encrypted: string): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    impl.compare(data, encrypted, (err: Error, same: boolean) => {
      if (err) return reject(err);
      resolve(same);
    });
  });
};
