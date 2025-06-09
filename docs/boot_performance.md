# Measuring Boot Time

To measure Helios-OS boot duration:

1. Open `ui/index.tsx` and ensure `bootStartRef` records the timestamp before `Kernel.create()`.
2. When the kernel emits `boot.shellReady`, subtract the timestamp from the current time and log the value.
3. Build the project in release mode and run the host:

    ```sh
    pnpm build:release
    ```

   Then check the console for `Boot completed in X ms`.

This method captures the time from kernel creation until the interactive shell is ready after login.

