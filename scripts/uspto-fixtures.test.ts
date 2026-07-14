import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const verifyManifest = async (artifactIds: string[]) => {
    const directory = await mkdtemp(join(tmpdir(), 'tmturtle-uspto-fixtures-'));
    temporaryDirectories.push(directory);
    const manifestPath = join(directory, 'manifest.json');
    await Bun.write(
        manifestPath,
        JSON.stringify({
            schemaVersion: 1,
            retainedEvidence: [],
            artifacts: artifactIds.map((id) => ({ id })),
            fixtures: [{ id: 'orphan', artifactId: 'expected-artifact' }],
        }),
    );

    const process = Bun.spawn(['bun', join(import.meta.dir, 'uspto-fixtures.ts')], {
        env: { ...Bun.env, TMTURTLE_USPTO_MANIFEST: manifestPath },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
    ]);
    return { exitCode, output: `${stdout}${stderr}` };
};

test('rejects a fixture whose artifact reference has no match', async () => {
    const result = await verifyManifest([]);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('Fixture orphan must resolve to exactly one artifact; found 0 for expected-artifact');
});

test('rejects a fixture whose artifact reference has multiple matches', async () => {
    const result = await verifyManifest(['expected-artifact', 'expected-artifact']);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('Fixture orphan must resolve to exactly one artifact; found 2 for expected-artifact');
});
