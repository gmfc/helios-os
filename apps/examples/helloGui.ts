import { createWindow, postMessage, onMessage } from "../../lib/gui";

export async function runHelloGui() {
    const id = await createWindow("<h1>Hello World</h1>", { title: "Hello" });
    onMessage(id, (data) => console.log("helloGui received", data));
    postMessage(0, id, { greeting: "hello" });
}
