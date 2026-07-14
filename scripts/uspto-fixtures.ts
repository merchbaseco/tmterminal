import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

type CachedEvidence = {
    path: string;
    bytes: number;
    sha256: string;
};

type Artifact = {
    id: string;
    cachePath: string;
    zip: { filename: string; bytes: number; sha256: string };
    xml: {
        filename: string;
        bytes: number;
        sha256: string;
        recordCount: number;
        actionRecordCounts: Record<string, number>;
        actionGroups: Array<{ actionKey: string; actionOccurrence: number; recordCount: number }>;
        transactionDateRange: { from: string; to: string };
        root: { name: string; version: string; versionDate: string; creationDatetime: string };
    };
};

type Fixture = {
    id: string;
    artifactId: string;
    actionKey: string;
    actionOccurrence: number;
    recordIndex: number;
    actionRecordIndex: number;
    serialNumber: string;
    path: string;
    bytes: number;
    sha256: string;
    sequence: string | null;
    evidence: string[];
    expectedPresence: {
        present: string[];
        absent: string[];
        empty: string[];
    };
};

type Manifest = {
    schemaVersion: number;
    cacheRootDefault: string;
    retainedEvidence: CachedEvidence[];
    artifacts: Artifact[];
    fixtures: Fixture[];
};

const repositoryRoot = join(import.meta.dir, '..');
const manifestPath = process.env.TMTURTLE_USPTO_MANIFEST
    ? resolve(repositoryRoot, process.env.TMTURTLE_USPTO_MANIFEST)
    : join(repositoryRoot, 'fixtures/uspto/manifest.json');
const manifest = (await Bun.file(manifestPath).json()) as Manifest;
const writeFixtures = Bun.argv.includes('--write');
const cacheRoot = process.env.TMTURTLE_USPTO_CACHE ?? join(homedir(), 'Library/Caches/tmturtle/uspto');

const artifactCounts = new Map<string, number>();
for (const artifact of manifest.artifacts) {
    artifactCounts.set(artifact.id, (artifactCounts.get(artifact.id) ?? 0) + 1);
}
for (const fixture of manifest.fixtures) {
    const matchCount = artifactCounts.get(fixture.artifactId) ?? 0;
    if (matchCount !== 1) {
        throw new Error(
            `Fixture ${fixture.id} must resolve to exactly one artifact; found ${matchCount} for ${fixture.artifactId}`,
        );
    }
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const readCachedBytes = async (relativePath: string) => {
    const path = join(cacheRoot, relativePath);
    const file = Bun.file(path);
    if (!(await file.exists())) {
        throw new Error(`Missing cached evidence: ${path}`);
    }
    return { path, bytes: new Uint8Array(await file.arrayBuffer()) };
};

const verifyCachedEvidence = async (evidence: CachedEvidence) => {
    const cached = await readCachedBytes(evidence.path);
    if (cached.bytes.byteLength !== evidence.bytes) {
        throw new Error(`Cached byte-size mismatch: ${cached.path}`);
    }
    if (sha256(cached.bytes) !== evidence.sha256) {
        throw new Error(`Cached SHA-256 mismatch: ${cached.path}`);
    }
};

const tagValue = (line: string, tag: string) => {
    const match = line.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return match?.[1];
};

const concat = (left: Buffer, right: Uint8Array) => Buffer.concat([left, Buffer.from(right)]);

const escapedTag = (tag: string) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const verifyPresence = (fixture: Fixture, excerpt: Buffer) => {
    const text = excerpt.toString('utf8');
    const hasTag = (tag: string) => new RegExp(`<${escapedTag(tag)}(?:\\s|>)`).test(text);

    for (const tag of fixture.expectedPresence.present) {
        if (!hasTag(tag)) {
            throw new Error(`Expected present element <${tag}> is missing: ${fixture.id}`);
        }
    }
    for (const tag of fixture.expectedPresence.absent) {
        if (hasTag(tag)) {
            throw new Error(`Expected absent element <${tag}> is present: ${fixture.id}`);
        }
    }
    for (const tag of fixture.expectedPresence.empty) {
        const escaped = escapedTag(tag);
        if (!new RegExp(`<${escaped}(?:\\s[^>]*)?>\\s*</${escaped}>|<${escaped}(?:\\s[^>]*)?\\s*/>`).test(text)) {
            throw new Error(`Expected empty element <${tag}> is not empty: ${fixture.id}`);
        }
    }
};

const verifyArtifact = async (artifact: Artifact, fixtures: Fixture[]) => {
    const cached = await readCachedBytes(artifact.cachePath);
    if (cached.bytes.byteLength !== artifact.zip.bytes || sha256(cached.bytes) !== artifact.zip.sha256) {
        throw new Error(`Cached ZIP does not match manifest: ${cached.path}`);
    }

    const process = Bun.spawn(['unzip', '-p', cached.path, artifact.xml.filename], {
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const stderr = new Response(process.stderr).text();
    const xmlHash = createHash('sha256');
    const decoder = new TextDecoder();
    const requestedByIndex = new Map(fixtures.map((fixture) => [fixture.recordIndex, fixture]));
    if (requestedByIndex.size !== fixtures.length) {
        throw new Error(`Duplicate fixture record index: ${artifact.id}`);
    }
    const found = new Set<string>();
    const actionOccurrences = new Map<string, number>();
    const actionRecordCounts = new Map<string, number>();
    const actionGroups: Artifact['xml']['actionGroups'] = [];

    let pending = Buffer.alloc(0);
    let xmlBytes = 0;
    let recordIndex = 0;
    let actionRecordIndex = 0;
    let actionKey = '';
    let actionOccurrence = 0;
    let capture: Buffer[] | null = null;
    let capturedFixture: Fixture | null = null;
    let serialNumber = '';
    let rootName = '';
    let version = '';
    let versionDate = '';
    let creationDatetime = '';
    let transactionFrom = '';
    let transactionTo = '';

    const consumeLine = async (line: Buffer) => {
        const text = decoder.decode(line);
        if (rootName === '') {
            rootName = text.match(/^<([a-z][a-z0-9-]*)>\s*$/)?.[1] ?? '';
        }
        const nextActionKey = tagValue(text, 'action-key');
        if (nextActionKey !== undefined) {
            actionKey = nextActionKey;
            actionOccurrence = (actionOccurrences.get(actionKey) ?? 0) + 1;
            actionOccurrences.set(actionKey, actionOccurrence);
            actionRecordIndex = 0;
            actionGroups.push({ actionKey, actionOccurrence, recordCount: 0 });
        }

        version ||= tagValue(text, 'version-no') ?? '';
        versionDate ||= tagValue(text, 'version-date') ?? '';
        creationDatetime ||= tagValue(text, 'creation-datetime') ?? '';

        if (/^\s*<case-file>\s*$/.test(text)) {
            recordIndex++;
            actionRecordIndex++;
            actionRecordCounts.set(actionKey, (actionRecordCounts.get(actionKey) ?? 0) + 1);
            const currentActionGroup = actionGroups.at(-1);
            if (!currentActionGroup) {
                throw new Error(`Record outside action group: ${artifact.id}`);
            }
            currentActionGroup.recordCount++;
            capturedFixture = requestedByIndex.get(recordIndex) ?? null;
            capture = capturedFixture ? [line] : null;
            serialNumber = '';
            return;
        }

        if (capture) {
            capture.push(line);
        }

        serialNumber ||= tagValue(text, 'serial-number') ?? '';
        const transactionDate = tagValue(text, 'transaction-date');
        if (transactionDate !== undefined) {
            transactionFrom = transactionFrom === '' || transactionDate < transactionFrom ? transactionDate : transactionFrom;
            transactionTo = transactionDate > transactionTo ? transactionDate : transactionTo;
        }

        if (!/^\s*<\/case-file>\s*$/.test(text) || !capturedFixture || !capture) {
            return;
        }

        if (
            capturedFixture.actionKey !== actionKey ||
            capturedFixture.actionOccurrence !== actionOccurrence ||
            capturedFixture.actionRecordIndex !== actionRecordIndex ||
            capturedFixture.serialNumber !== serialNumber
        ) {
            throw new Error(`Fixture selector drift: ${capturedFixture.id}`);
        }

        const excerpt = Buffer.concat(capture);
        verifyPresence(capturedFixture, excerpt);
        const excerptPath = join(repositoryRoot, capturedFixture.path);
        if (writeFixtures) {
            await mkdir(dirname(excerptPath), { recursive: true });
            await Bun.write(excerptPath, excerpt);
            capturedFixture.bytes = excerpt.byteLength;
            capturedFixture.sha256 = sha256(excerpt);
        } else {
            const committed = Bun.file(excerptPath);
            if (!(await committed.exists())) {
                throw new Error(`Missing committed fixture: ${excerptPath}`);
            }
            const committedBytes = new Uint8Array(await committed.arrayBuffer());
            if (
                committedBytes.byteLength !== capturedFixture.bytes ||
                sha256(committedBytes) !== capturedFixture.sha256 ||
                !committedBytes.every((byte, index) => byte === excerpt[index])
            ) {
                throw new Error(`Fixture is not the byte-exact source record: ${capturedFixture.id}`);
            }
        }

        found.add(capturedFixture.id);
        capture = null;
        capturedFixture = null;
    };

    for await (const chunk of process.stdout) {
        const bytes = Buffer.from(chunk);
        xmlHash.update(bytes);
        xmlBytes += bytes.byteLength;
        pending = concat(pending, bytes);
        let newline = pending.indexOf(10);
        while (newline !== -1) {
            const line = pending.subarray(0, newline + 1);
            pending = pending.subarray(newline + 1);
            await consumeLine(line);
            newline = pending.indexOf(10);
        }
    }
    if (pending.byteLength > 0) {
        await consumeLine(pending);
    }

    const exitCode = await process.exited;
    const errorOutput = await stderr;
    if (exitCode !== 0) {
        throw new Error(`Unable to read ${artifact.zip.filename}: ${errorOutput.trim()}`);
    }

    const actualActionCounts = Object.fromEntries([...actionRecordCounts].sort(([left], [right]) => left.localeCompare(right)));
    const expectedActionCounts = Object.fromEntries(
        Object.entries(artifact.xml.actionRecordCounts).sort(([left], [right]) => left.localeCompare(right)),
    );
    const metadataMatches =
        xmlBytes === artifact.xml.bytes &&
        xmlHash.digest('hex') === artifact.xml.sha256 &&
        recordIndex === artifact.xml.recordCount &&
        JSON.stringify(actualActionCounts) === JSON.stringify(expectedActionCounts) &&
        JSON.stringify(actionGroups) === JSON.stringify(artifact.xml.actionGroups) &&
        transactionFrom === artifact.xml.transactionDateRange.from &&
        transactionTo === artifact.xml.transactionDateRange.to &&
        rootName === artifact.xml.root.name &&
        version === artifact.xml.root.version &&
        versionDate === artifact.xml.root.versionDate &&
        creationDatetime === artifact.xml.root.creationDatetime;
    if (!metadataMatches) {
        throw new Error(`Source XML metadata drift: ${artifact.id}`);
    }

    for (const fixture of fixtures) {
        if (!found.has(fixture.id)) {
            throw new Error(`Fixture record not found: ${fixture.id}`);
        }
    }
};

for (const evidence of manifest.retainedEvidence) {
    await verifyCachedEvidence(evidence);
}

for (const artifact of manifest.artifacts) {
    await verifyArtifact(
        artifact,
        manifest.fixtures.filter((fixture) => fixture.artifactId === artifact.id),
    );
}

if (writeFixtures) {
    await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(
    `Verified ${manifest.artifacts.length} retained USPTO ZIPs and ${manifest.fixtures.length} byte-exact record fixtures${writeFixtures ? ' (fixtures regenerated)' : ''}.`,
);
