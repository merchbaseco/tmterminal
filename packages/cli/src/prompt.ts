import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

import { BadRequestError } from "./cli-error.js";

interface TerminalInput extends NodeJS.ReadableStream {
  isTTY?: boolean;
}

interface TerminalOutput extends NodeJS.WritableStream {
  isTTY?: boolean;
}

export async function readHiddenApiKey(
  input: TerminalInput = process.stdin,
  output: TerminalOutput = process.stderr
) {
  if (!(input.isTTY && output.isTTY)) {
    throw new BadRequestError("Interactive input requires a terminal; use --stdin instead");
  }

  output.write("API key: ");
  const silentOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const prompt = createInterface({ input, output: silentOutput, terminal: true });
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  prompt.once("SIGINT", cancel);
  prompt.once("close", cancel);

  try {
    return await prompt.question("", { signal: cancellation.signal });
  } catch (error) {
    if (cancellation.signal.aborted) {
      throw new BadRequestError("API key input cancelled", { cause: error });
    }
    throw error;
  } finally {
    prompt.off("SIGINT", cancel);
    prompt.off("close", cancel);
    prompt.close();
    output.write("\n");
  }
}
