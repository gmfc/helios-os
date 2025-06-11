# Contributing to Helios-OS

Thank you for helping make Helios-OS better! This guide explains the coding conventions and common tasks in the repository.

## Coding style

- **Indentation:** 4 spaces. No tabs.
- **Semicolons:** required.
- **Trailing newline:** every file must end with a newline.
- **Lint:** run `pnpm lint` before committing. The `precommit` script also runs `pnpm test`.
- **TypeScript:** strict mode is enabled across the project; do not disable it.

## Running tests

The project uses [Vitest](https://vitest.dev/). Execute all tests with:

```sh
pnpm test
```

Vitest compiles the sources automatically so no extra build step is needed.

## Adding or modifying a built-in CLI app

1. Create a new file under `apps/cli/programs/` that exports an async `main(syscall, argv)` function.
2. Run `pnpm build:apps` to regenerate `core/fs/generatedApps.ts`. This file embeds the program sources and manifests so they are available under `/bin` at runtime.
3. Commit the updated `core/fs/generatedApps.ts` along with your program.

## Adding a new syscall

1. Implement the function in `core/kernel/syscalls.ts` following the pattern of existing syscalls.
2. Export it and register the handler in `core/kernel/index.ts`.
3. Update any relevant manifests in `tools/build-apps.ts` so user programs can request the new syscall.
4. Add tests under `core/` exercising the new functionality.

## Creating a new service daemon

1. Add your service under `core/services/` exposing a `startXxx(kernel, opts)` function.
2. Register the service in the kernel via `kernel.registerService()` or during snapshot restore.
3. Document any ports or protocols in the service README.


