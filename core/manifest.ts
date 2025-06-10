export interface ProgramManifest {
    name: string;
    syscalls: string[];
    quotaMs?: number;
    quotaMem?: number;
}

export function parseManifest(data: Uint8Array): ProgramManifest {
    const text = new TextDecoder().decode(data);
    return JSON.parse(text) as ProgramManifest;
}
