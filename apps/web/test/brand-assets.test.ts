import { expect, test } from "bun:test";

const turtleMark = await Bun.file(
  new URL("../../../assets/brand/turtle-mark.svg", import.meta.url)
).text();

test("the turtle mark is a browser-safe standalone SVG", () => {
  expect(turtleMark.startsWith("<svg ")).toBe(true);
  expect(turtleMark).toContain("<title>Trademark Turtle</title>");
  expect(turtleMark).not.toContain("<?xml");
});
