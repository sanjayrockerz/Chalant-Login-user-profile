import { AccountDeletionRecoveryWorker } from "./account-deletion-recovery.worker";

describe("AccountDeletionRecoveryWorker", () => {
  it("does not query deletion operations while deletion is disabled", async () => {
    const deletion = { recoverPendingDeletions: jest.fn() };
    const config = { get: jest.fn().mockReturnValue(false) };
    const worker = new AccountDeletionRecoveryWorker(
      deletion as never,
      config as never,
    );
    await worker.recoverOnce();
    expect(deletion.recoverPendingDeletions).not.toHaveBeenCalled();
  });

  it("coalesces concurrent local polls and delegates to bounded SOC recovery", async () => {
    let release!: () => void;
    const deletion = {
      recoverPendingDeletions: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    };
    const config = { get: jest.fn().mockReturnValue(true) };
    const worker = new AccountDeletionRecoveryWorker(
      deletion as never,
      config as never,
    );
    const first = worker.recoverOnce();
    await Promise.resolve();
    const overlapping = worker.recoverOnce();
    release();
    await Promise.all([first, overlapping]);
    expect(deletion.recoverPendingDeletions).toHaveBeenCalledTimes(1);
    expect(deletion.recoverPendingDeletions).toHaveBeenCalledWith(25);
  });
});
