import { Kernel } from "../../core/kernel";
import { startCoinService } from "../../core/services/coin";

export async function runCoinExample(kernel: Kernel) {
    const coin = startCoinService(kernel, { port: 6000, difficulty: 2, peers: [] });
    setInterval(() => {
        const block = coin.mine(`block ${Date.now()}`);
        console.log(`mined block ${block.hash}`);
    }, 5000);
}
