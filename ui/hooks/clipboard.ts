import {
    readText as tauriReadText,
    writeText as tauriWriteText,
} from "@tauri-apps/plugin-clipboard-manager";

export async function copyText(text: string): Promise<void> {
    try {
        if ((window as any).__TAURI__) {
            await tauriWriteText(text);
        } else if (navigator.clipboard) {
            await navigator.clipboard.writeText(text);
        }
    } catch (e) {
        console.error(e);
    }
}

export async function pasteText(): Promise<string> {
    try {
        if ((window as any).__TAURI__) {
            return (await tauriReadText()) ?? "";
        }
        if (navigator.clipboard) {
            return await navigator.clipboard.readText();
        }
    } catch (e) {
        console.error(e);
    }
    return "";
}

