import { invoke } from '@tauri-apps/api/tauri';
import type { FileSystemSnapshot, PersistHook } from './index';

export async function loadSnapshot(): Promise<FileSystemSnapshot | null> {
  try {
    const result = await invoke<any>('load_fs');
    return result as FileSystemSnapshot | null;
  } catch {
    return null;
  }
}

export async function persistSnapshot(snapshot: FileSystemSnapshot) {
  try {
    await invoke('save_fs', { json: JSON.stringify(snapshot) });
  } catch {
    // ignore
  }
}

export function createPersistHook(): PersistHook {
  return async (snapshot: FileSystemSnapshot) => {
    await persistSnapshot(snapshot);
  };
}

// Full kernel snapshot helpers
export async function loadKernelSnapshot(): Promise<any | null> {
  try {
    const result = await invoke<any>('load_snapshot');
    return result as any;
  } catch {
    return null;
  }
}

export async function persistKernelSnapshot(snapshot: any) {
  try {
    await invoke('save_snapshot', { json: JSON.stringify(snapshot) });
  } catch {
    // ignore
  }
}

export async function saveNamedSnapshot(name: string, snapshot: any) {
    try {
        await invoke('save_named_snapshot', {
            name,
            json: JSON.stringify(snapshot),
        });
    } catch {
        // ignore
    }
}

export async function loadNamedSnapshot(name: string): Promise<any | null> {
    try {
        const result = await invoke<any>('load_named_snapshot', { name });
        return result as any;
    } catch {
        return null;
    }
}
