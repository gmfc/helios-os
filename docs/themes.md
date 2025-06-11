# Theme Creation

Custom themes live under `/opt/themes/<name>` and must provide `wallpaper.jpg` and `theme.css` files. The wallpaper fills the desktop background while the CSS overrides window styling.

To package a theme, create a tarball containing the two files at its root. Installing it via `apt install <pkg>` will place the files under `/opt/themes/<pkg>`.

Select a theme at runtime with:

```sh
themes select <name>
```

The choice is stored in `/etc/theme` and read by the desktop program on startup.

