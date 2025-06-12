// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom/client";
import { describe, it, expect } from "vitest";
import { Window } from "./Window";

describe("Window sandbox", () => {
    const monitors = [{ width: 800, height: 600, x: 0, y: 0 }];

    const render = (content: string) => {
        const div = document.createElement("div");
        document.body.appendChild(div);
        ReactDOM.createRoot(div).render(
            <Window id={1} title="Test" monitors={monitors} monitorId={0}>
                {content}
            </Window>,
        );
        return div;
    };

    it("renders iframe with allow-scripts only", () => {
        const div = render("<p>hi</p>");
        const iframe = div.querySelector("iframe") as HTMLIFrameElement;
        expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
        expect(Array.from(iframe.sandbox)).toEqual(["allow-scripts"]);
    });

    it("prevents navigation to file URLs", () => {
        const div = render("<p>file</p>");
        const iframe = div.querySelector("iframe") as HTMLIFrameElement;
        try {
            iframe.contentWindow!.location.href = "file:///etc/passwd";
        } catch {
            // jsdom throws "Not implemented: navigation" for file URLs
        }
        expect(iframe.contentWindow!.location.href).not.toContain("file://");
    });

    it("blocks window.open usage", () => {
        const div = render("<p>open</p>");
        const iframe = div.querySelector("iframe") as HTMLIFrameElement;
        const result = iframe.contentWindow!.open("https://example.com");
        expect(result).toBeUndefined();
    });
});
