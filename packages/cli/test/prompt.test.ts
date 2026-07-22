import { expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";

import { readHiddenApiKey } from "../src/prompt.ts";

test("interactive API key input is hidden from terminal output", async () => {
  const input = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (enabled: boolean) => void;
  };
  const rawModes: boolean[] = [];
  input.isTTY = true;
  input.setRawMode = (enabled) => {
    rawModes.push(enabled);
  };

  let outputText = "";
  const output = new Writable({
    write(chunk, _encoding, callback) {
      outputText += chunk.toString();
      callback();
    },
  }) as Writable & { isTTY: boolean };
  output.isTTY = true;

  const answer = readHiddenApiKey(input, output);
  input.end("ttk_hidden_secret\n");

  await expect(answer).resolves.toBe("ttk_hidden_secret");
  expect(outputText).toBe("API key: \n");
  expect(rawModes).toEqual([true, false]);
});

test("non-interactive API key input requires the explicit stdin mode", async () => {
  const input = new PassThrough() as PassThrough & { isTTY: boolean };
  input.isTTY = false;
  const output = new PassThrough() as PassThrough & { isTTY: boolean };
  output.isTTY = true;

  await expect(readHiddenApiKey(input, output)).rejects.toThrow(
    "Interactive input requires a terminal; use --stdin instead"
  );
});

test("interactive cancellation restores terminal input", async () => {
  const input = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (enabled: boolean) => void;
  };
  const rawModes: boolean[] = [];
  input.isTTY = true;
  input.setRawMode = (enabled) => {
    rawModes.push(enabled);
  };
  const output = new PassThrough() as PassThrough & { isTTY: boolean };
  output.isTTY = true;

  const answer = readHiddenApiKey(input, output);
  input.write("\u0003");

  await expect(answer).rejects.toThrow("API key input cancelled");
  expect(rawModes).toEqual([true, false]);
});

test("interactive end-of-input cancels without waiting", async () => {
  const input = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (enabled: boolean) => void;
  };
  const rawModes: boolean[] = [];
  input.isTTY = true;
  input.setRawMode = (enabled) => {
    rawModes.push(enabled);
  };
  const output = new PassThrough() as PassThrough & { isTTY: boolean };
  output.isTTY = true;

  const answer = readHiddenApiKey(input, output);
  input.end();

  await expect(answer).rejects.toThrow("API key input cancelled");
  expect(rawModes).toEqual([true, false]);
});
