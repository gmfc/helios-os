import { Kernel } from "../../core/kernel";
import { startCoinService } from "../../core/services/coin";

/**
 * Start a local coin daemon. Mining does not begin automatically.
 *
 * Usage:
 * ```ts
 * const coin = await runCoinExample(kernel);
 * const block = coin.mine("hello world");
 * console.log(`mined block ${block.hash}`);
 * ```
 */
export async function runCoinExample(kernel: Kernel) {
    return startCoinService(kernel, { port: 6000, difficulty: 2, peers: [] });
}
