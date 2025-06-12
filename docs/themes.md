# Theme Creation

Custom themes live under `/opt/themes/<name>` and must provide `wallpaper.jpg` and `theme.css` files. The wallpaper fills the desktop background while the CSS overrides window styling.

To package a theme, create a tarball containing the two files at its root. Installing it via `apt install <pkg>` will place the files under `/opt/themes/<pkg>`.

Select a theme at runtime with:

```sh
themes select <name>
```

The choice is stored in `/etc/theme` and read by the desktop program on startup.


## Built-in example

A colour-blind friendly high-contrast theme is provided at `ui/themes/high-contrast.css`.
Copy this file and a `wallpaper.jpg` into `/opt/themes/high-contrast/` then run:

```sh
themes select high-contrast
```

The palette uses WCAG compliant contrast ratios.

