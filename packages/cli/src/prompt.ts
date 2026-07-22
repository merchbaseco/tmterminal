import { BadRequestError } from "./cli-error.js";

interface TerminalInput extends NodeJS.ReadableStream {
  isRaw?: boolean;
  isTTY?: boolean;
  readableFlowing?: boolean | null;
  setRawMode?: (enabled: boolean) => void;
}

interface TerminalOutput extends NodeJS.WritableStream {
  isTTY?: boolean;
}

export function readHiddenApiKey(
  input: TerminalInput = process.stdin,
  output: TerminalOutput = process.stderr
) {
  if (!(input.isTTY && output.isTTY && input.setRawMode)) {
    return Promise.reject(
      new BadRequestError("Interactive input requires a terminal; use --stdin instead")
    );
  }

  const wasFlowing = input.readableFlowing === true;
  const wasRaw = input.isRaw === true;
  input.setRawMode(true);

  return new Promise<string>((resolve, reject) => {
    const bytes: number[] = [];

    const finish = (result: { error?: Error; value?: string }) => {
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      input.removeListener("error", onError);
      if (!wasRaw) {
        input.setRawMode?.(false);
      }
      if (!wasFlowing) {
        input.pause();
      }
      output.write("\n");

      if (result.error) {
        reject(result.error);
      } else {
        resolve(result.value ?? "");
      }
    };
    const cancel = () => finish({ error: new BadRequestError("API key input cancelled") });
    const onData = (chunk: Buffer | string) => {
      for (const byte of Buffer.from(chunk)) {
        if (byte === 3 || byte === 4) {
          cancel();
          return;
        }
        if (byte === 10 || byte === 13) {
          finish({ value: Buffer.from(bytes).toString("utf8") });
          return;
        }
        if (byte === 8 || byte === 127) {
          bytes.pop();
          continue;
        }
        bytes.push(byte);
      }
    };
    const onEnd = () => cancel();
    const onError = (error: Error) => finish({ error });

    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", onError);
    input.resume();
    output.write("API key: ");
  });
}
