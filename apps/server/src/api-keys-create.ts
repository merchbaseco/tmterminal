import { createDatabaseClient } from "./db/client.ts";
import { resolveHostAccount } from "./queries/account-repository.ts";
import { createApiKey } from "./queries/api-key-repository.ts";

function readName(args: string[]) {
  if (args.length !== 2 || args[0] !== "--name") {
    throw new Error("Usage: bun run api-keys:create --name <caller>");
  }

  const name = args[1]?.trim();
  if (!name || name.length > 80) {
    throw new Error("API key name must contain 1 to 80 characters");
  }
  return name;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const name = readName(Bun.argv.slice(2));
const database = createDatabaseClient(databaseUrl);

try {
  const accountId = await resolveHostAccount(database, name);
  const { token } = await createApiKey(database, accountId, name);
  process.stdout.write(`${token}\n`);
} finally {
  await database.end({ timeout: 1 });
}
