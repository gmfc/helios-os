# Developer Workflow

This project uses `pnpm` for managing Node dependencies and scripts.

1. Install dependencies:

    ```sh
    pnpm i
    ```

2. Start the development environment (launches Tauri and the front‑end in watch mode):

    ```sh
    pnpm dev
    ```

3. Run the test suite before committing:

    ```sh
    pnpm test
    ```

The project enforces TypeScript strict mode. Use four spaces for indentation and ensure files end with a trailing newline.
