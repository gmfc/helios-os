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
3. CLI programs run in a sandbox. The build process fails if Node/Electron APIs are detected unless the manifest entry sets `allowNode: true`.

### Creating new apps

Run the CLI scaffolding command for GUI or CLI programs:

```sh
pnpm helios new gui-app my-gui
pnpm helios new cli-app my-cli
```

This generates a folder under `apps/examples/` with boilerplate code. Build the apps afterwards using `pnpm build:apps` and update the default snapshot with `pnpm update-snapshot`.

### Packaging and publishing

The `helios` CLI can bundle a directory into a package:

```sh
pnpm helios makepkg apps/examples/my-gui
```

Install the resulting archive inside the VM with `apt install <pkg>` and remove it with `apt remove <pkg>`.

To publish a package to the local workshop directory run:

```sh
pnpm helios publish my-gui-0.1.0.tar.gz
```

### Messaging and crash handling

GUI windows communicate via `postMessage`:

```ts
import { postMessage, onMessage } from "../../lib/gui";

const id = await createWindow("<p>Hello</p>", { title: "demo" });
onMessage(id, (data) => console.log("got", data));
postMessage(0, id, { ping: true });
```

Listen for `desktop.appCrashed` on the event bus to be notified when a process terminates unexpectedly.

### Continuous Integration

CI runs on GitHub Actions (`.github/workflows/test.yml`). It installs dependencies, builds the project and runs `pnpm test`.
To run the same checks locally:

```sh
pnpm lint && pnpm test
```
