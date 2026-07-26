import { expect, test } from "bun:test";

const terminalMark = await Bun.file(
  new URL("../../../assets/brand/terminal-mark.svg", import.meta.url)
).text();

test("the terminal mark is a browser-safe standalone SVG", () => {
  expect(terminalMark.startsWith("<svg ")).toBe(true);
  expect(terminalMark).toContain("<title>Trademark Terminal</title>");
  expect(terminalMark).not.toContain("<?xml");
});
