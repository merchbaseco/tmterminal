import type { Keychain } from "./run.js";

const service = "co.merchbase.tmterminal";

export type SecurityCommand = (
  args: string[],
  stdin?: string
) => Promise<{ exitCode: number; stderr: string; stdout: string }>;

const passwordPromptScript = `
log_user 0
set timeout 10
set input [split [string trimright [read stdin] "\\r\\n"] "\\n"]
set password [lindex $input 0]
set arguments [lrange $input 1 end]
spawn /usr/bin/security {*}$arguments
expect {
  "password data for new item:" {
    send -- "$password\\r"
    exp_continue
  }
  "retype password for new item:" {
    send -- "$password\\r"
    exp_continue
  }
  eof {
    set result [wait]
    exit [lindex $result 3]
  }
  timeout { exit 124 }
}
`;

async function security(args: string[], stdin?: string) {
  const command =
    stdin === undefined
      ? ["/usr/bin/security", ...args]
      : ["/usr/bin/expect", "-c", passwordPromptScript];
  const child = Bun.spawn(command, {
    stderr: "pipe",
    stdin: "pipe",
    stdout: "pipe",
  });
  if (stdin) {
    child.stdin.write(`${stdin.trimEnd()}\n${args.join("\n")}\n`);
  }
  child.stdin.end();
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
}

function failed(result: Awaited<ReturnType<SecurityCommand>>) {
  return new Error(result.stderr.trim() || "macOS Keychain command failed");
}

export function createMacOsKeychain(command: SecurityCommand = security): Keychain {
  return {
    async clear(origin) {
      const result = await command(["delete-generic-password", "-a", origin, "-s", service]);
      if (result.exitCode === 44) {
        return;
      }
      if (result.exitCode !== 0) {
        throw failed(result);
      }
    },
    async get(origin) {
      const result = await command(["find-generic-password", "-a", origin, "-s", service, "-w"]);
      if (result.exitCode === 44) {
        return null;
      }
      if (result.exitCode !== 0) {
        throw failed(result);
      }
      return result.stdout.trim();
    },
    async set(origin, token) {
      const result = await command(
        ["add-generic-password", "-a", origin, "-s", service, "-U", "-w"],
        `${token}\n`
      );
      if (result.exitCode !== 0) {
        throw failed(result);
      }
    },
  };
}
