export const COLORS = {
    foreground: "#d4d4d4",
    background: "#1e1e1e",
};
import type React from "react";
import type { ITheme } from "@xterm/xterm";

export const TERMINAL_THEME: ITheme = {
    background: COLORS.background,
    foreground: COLORS.foreground,
    cursor: COLORS.foreground,
    selectionBackground: "rgba(255, 255, 255, 0.3)",
};

export const LOGIN_CONTAINER_STYLE: React.CSSProperties = {
    color: COLORS.foreground,
    padding: "10px",
};

export const INPUT_STYLE: React.CSSProperties = {
    background: "black",
    color: COLORS.foreground,
    border: "none",
    outline: "none",
};
