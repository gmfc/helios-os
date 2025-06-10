# Developer Workflow

This project uses `pnpm` for managing Node dependencies and scripts.

1. Install dependencies:

    ```sh
    pnpm i
    ```

2. Start the development environment (launches Tauri and the front‑end in watch mode):

    ```sh
    pnpm dev

    # Compile the Rust host with optimizations
    pnpm dev:release
    ```

3. Build a release bundle for distribution:

    ```sh
    pnpm build:release
    ```

4. Run the test suite with **Vitest** before committing:

    ```sh
    pnpm test
    ```

    Vitest compiles the TypeScript sources automatically, so no esbuild step is
    required.

The project enforces TypeScript strict mode. Use four spaces for indentation and ensure files end with a trailing newline.
