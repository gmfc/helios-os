# Networking Tools

This page describes the basic CLI utilities bundled with Helios-OS for
managing network interfaces and testing connectivity. These commands
mirror common Linux tools but run entirely within the TypeScript kernel.

## ifconfig

`ifconfig` lists and configures network interfaces. Without arguments it
shows all NICs with their IP, netmask and status. `ifconfig eth0 up`
brings an interface online, `ifconfig wlan0 down` disables it and
`ifconfig eth0 10.0.0.2/24` sets an address manually.

## dhclient

`dhclient <nic>` requests an IP address from the local DHCP service. On
success the assigned address and mask are printed. The kernel keeps the
lease so subsequent `ifconfig` calls display it.

## iwlist

`iwlist` scans for nearby Wi‑Fi networks and prints the SSIDs detected.
It relies on the host exposing wireless NICs to the kernel.

## iwconfig

`iwconfig <nic> <ssid> <passphrase>` connects a wireless interface to a
network. The command fails if authentication does not succeed.

## route

The `route` utility adds or removes entries from the routing table.
`route add 192.168.0.0/24 eth0` directs packets for that subnet through a
specific interface while `route del 192.168.0.0/24` removes the rule.

## ping

`ping <ip>` sends a UDP echo and reports the round-trip time. It is
useful for verifying that routes are configured correctly.

## service

`service list` shows running daemons. `service start <name>` launches a
daemon from `/bin` while `service stop <name>` terminates it.

## httpd

`httpd [port] [root]` starts a tiny web server serving files from the
given directory. The default port is `80` and root `/var/www`.

## ftpd

`ftpd [port] [root]` exposes the filesystem over FTP. Only active mode is
supported and uploads/downloads are limited to a few megabytes.

## smtp

`smtp [port] [root]` runs the simple mail daemon described below which
stores incoming messages under `/var/mail`. Use `sendmail` to submit
messages and `mail` to read them via the IMAP interface.

## Host hub communication

When running multiple Helios instances on the same machine the host acts
as a virtual hub. Each VM sends its Ethernet frames to the host which
forwards them to all other active instances. This allows local
multiplayer testing without an external router. When MMO mode is
enabled the host hub tunnels frames to the world router so remote
players share the same simulated network.


## sshd

The `ssh` command starts a minimal SSH-like daemon, equivalent to
calling `startSshd(kernel, { port: 22 })` from TypeScript. Each connection is given its own
pseudo-terminal and spawns `/bin/bash` inside the VM. Any username and
password are currently accepted. Once running you can connect from the
kernel's TCP stack or a host client:

```bash
ssh -p 22 localhost
```

This opens an interactive shell just like the main terminal.

## smtpd and imapd

`startSmtpd(kernel, { port: 25 })` launches a very small mail daemon. Incoming
messages are written to `/var/mail/<recipient>/` as plain text files. An
optional IMAP-like service can also be started with `startImapd(kernel, { port:
143 })` which exposes simple `LIST` and `RETR` commands for reading those
stored messages.

Example SMTP session using `telnet`:

```text
HELO client
MAIL FROM:<me@example.com>
RCPT TO:<bob>
DATA
Hello Bob
.
QUIT
```

The bundled `sendmail` and `mail` CLI utilities wrap these protocols for quick
testing.


## coin

The peer-to-peer coin daemon is started with `startCoinService(kernel, { port: 3333 })`.
Blocks are exchanged over UDP and mined with a simple proof-of-work. A
small example program resides under `apps/examples/coin.ts`.

