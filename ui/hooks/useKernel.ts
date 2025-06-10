import { useState, useEffect, useRef, useCallback } from "react";
import { Kernel } from "../../core/kernel";
import { eventBus } from "../../core/utils/eventBus";

export const useKernel = () => {
    const kernelRef = useRef<Kernel | null>(null);
    const bootStartRef = useRef<number>(0);
    const [shellReady, setShellReady] = useState(false);

    const startKernel = useCallback(async () => {
        bootStartRef.current = performance.now();
        const kernel = await Kernel.create();
        kernelRef.current = kernel;
        kernel.start().catch(console.error);
    }, []);

    useEffect(() => {
        startKernel();
        return () => {
            kernelRef.current = null;
        };
    }, [startKernel]);

    useEffect(() => {
        const handler = () => {
            kernelRef.current?.stop();
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, []);

    useEffect(() => {
        const handler = () => {
            const dur = performance.now() - bootStartRef.current;
            console.log(`Boot completed in ${Math.round(dur)} ms`);
            setShellReady(true);
        };
        eventBus.on("boot.shellReady", handler);
        return () => eventBus.off("boot.shellReady", handler);
    }, []);

    useEffect(() => {
        const handler = () => {
            setShellReady(false);
            startKernel();
        };
        eventBus.on("system.reboot", handler);
        return () => eventBus.off("system.reboot", handler);
    }, [startKernel]);

    return { kernel: kernelRef.current, shellReady };
};
