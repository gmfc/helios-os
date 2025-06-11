# Developer Workflow

This project uses `pnpm` for managing Node dependencies and scripts.

1. Install dependencies:

    ```sh
    pnpm i
    ```

2. Start the development environment. Tauri runs the unified build script in watch mode so the Vite dev server starts automatically:

    ```sh
    pnpm dev

    # Compile the Rust host with optimizations
    pnpm dev:release
    ```

3. Build a release bundle for distribution using the same script:

    ```sh
    pnpm build:release
    ```

    On Linux the host requires the `glib-2.0` development
    package. Without it the build fails with a missing
    `glib-2.0.pc` error when bundling the Tauri binary.

4. Run the test suite with **Vitest** (powered by Vite) before committing:

    ```sh
    pnpm test
    ```

    Vitest compiles the TypeScript sources automatically, so no esbuild step is
    required.

The project enforces TypeScript strict mode. Use four spaces for indentation and ensure files end with a trailing newline.

### Adding built-in CLI apps

1. Add a new file in `apps/cli/programs/` that exports an async `main(syscall, argv)` function.
2. Run `pnpm build:apps` to regenerate `core/fs/generatedApps.ts` and commit the result.

### Creating a new GUI app

Run the CLI scaffolding command:

```sh
pnpm helios new gui-app my-app
```

This generates `apps/examples/my-app/index.tsx` with a basic window example. Build the apps afterwards using `pnpm build:apps`.
Use `pnpm update-snapshot` to refresh the default snapshot after adding new programs.

### Continuous Integration

CI runs on GitHub Actions (`.github/workflows/test.yml`). It installs dependencies, builds the project and runs `pnpm test`.
To run the same checks locally:

```sh
pnpm lint && pnpm test
```
