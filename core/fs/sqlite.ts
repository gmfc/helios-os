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
  return (snapshot: FileSystemSnapshot) => {
    persistSnapshot(snapshot);
  };
}
