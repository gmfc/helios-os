# FTP Example

This short guide demonstrates transferring a file using the built-in FTP daemon.

1. Start the server on one VM:

```ts
import { startFtpd } from "../core/services/ftp";

startFtpd(kernel, { port: 2121 });
```

2. From another VM connect using an FTP client and enable active mode. After
sending `USER`, `PASS` and `PORT`, issue `RETR foo.txt` or `STOR bar.txt` to
transfer files.

Routing between instances must be configured so the data connection reaches the
client.
