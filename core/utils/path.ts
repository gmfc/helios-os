export function getParentPath(path: string): string {
    const parts = path.split("/").filter((p) => p);
    if (parts.length <= 1) return "/";
    return "/" + parts.slice(0, -1).join("/");
}

export function getBaseName(path: string): string {
    return (
        path
            .split("/")
            .filter((p) => p)
            .pop() || ""
    );
}
