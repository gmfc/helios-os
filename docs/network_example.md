# Networking Example

This short guide shows how services can communicate once routing is configured.

1. Start the HTTP daemon on one VM:

```ts
import { startHttpd } from "../core/services/http";

startHttpd(kernel, { port: 8080 });
```

2. From another VM send a request using `curl` (or `cat` with a TCP client):

```sh
$ curl 10.0.0.2:8080
Hello from Helios HTTP on port 8080
```

Routing between instances is required so packets reach the HTTP service.

