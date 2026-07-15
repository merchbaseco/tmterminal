export const assertFixtureArtifactReferences = (
    artifacts: ReadonlyArray<{ id: string }>,
    fixtures: ReadonlyArray<{ id: string; artifactId: string }>,
) => {
    const artifactCounts = new Map<string, number>();
    for (const artifact of artifacts) {
        artifactCounts.set(artifact.id, (artifactCounts.get(artifact.id) ?? 0) + 1);
    }
    for (const fixture of fixtures) {
        const matchCount = artifactCounts.get(fixture.artifactId) ?? 0;
        if (matchCount !== 1) {
            throw new Error(
                `Fixture ${fixture.id} must resolve to exactly one artifact; found ${matchCount} for ${fixture.artifactId}`,
            );
        }
    }
};

export const assertArtifactMetadataReferences = (
    metadataSources: ReadonlyArray<{ id: string }>,
    artifacts: ReadonlyArray<{ id: string; officialMetadata?: { sourceId: string } }>,
) => {
    const sourceCounts = new Map<string, number>();
    for (const source of metadataSources) {
        sourceCounts.set(source.id, (sourceCounts.get(source.id) ?? 0) + 1);
    }
    for (const artifact of artifacts) {
        const sourceId = artifact.officialMetadata?.sourceId;
        if (!sourceId) {
            continue;
        }
        const matchCount = sourceCounts.get(sourceId) ?? 0;
        if (matchCount !== 1) {
            throw new Error(
                `Artifact ${artifact.id} must resolve to exactly one official metadata source; found ${matchCount} for ${sourceId}`,
            );
        }
    }
};

export const assertFixturePathInventory = (recordPaths: readonly string[], manifestPaths: readonly string[]) => {
    const recordPathSet = new Set(recordPaths);
    const manifestPathSet = new Set(manifestPaths);
    const unlisted = recordPaths.filter((path) => !manifestPathSet.has(path));
    const missing = manifestPaths.filter((path) => !recordPathSet.has(path));

    if (unlisted.length > 0 || missing.length > 0 || recordPaths.length !== manifestPaths.length) {
        const details = [
            unlisted.length > 0 ? `unlisted records: ${unlisted.join(', ')}` : null,
            missing.length > 0 ? `missing records: ${missing.join(', ')}` : null,
            recordPaths.length !== manifestPaths.length ? 'record and manifest counts differ' : null,
        ]
            .filter(Boolean)
            .join('; ');
        throw new Error(`Fixture path inventory mismatch: ${details}`);
    }
};

export type TrademarkSourceContract = {
    id: string;
    currentApplicationDocument?: {
        url: string;
        bytes: number;
        sha256: string;
        activeClassStatusCode: string;
        retainedInRepository: boolean;
    };
    currentStatusTable?: {
        url: string;
        bytes: number;
        sha256: string;
        entryCount: number;
        dispositionSha256: string;
        tableUpdated: string;
        retainedInRepository: boolean;
    };
};

export const assertTrademarkSourceContract = (
    contracts: readonly TrademarkSourceContract[],
    expected: Pick<TrademarkSourceContract, 'currentApplicationDocument' | 'currentStatusTable'>,
) => {
    const sources = contracts.filter(({ id }) => id === 'xml-resources');
    if (sources.length !== 1) {
        throw new Error(`Expected one xml-resources source contract; found ${sources.length}`);
    }
    const application = sources[0]!.currentApplicationDocument;
    const status = sources[0]!.currentStatusTable;
    const expectedApplication = expected.currentApplicationDocument;
    const expectedStatus = expected.currentStatusTable;
    if (
        !application || !expectedApplication ||
        application.url !== expectedApplication.url ||
        application.bytes !== expectedApplication.bytes ||
        application.sha256 !== expectedApplication.sha256 ||
        application.activeClassStatusCode !== expectedApplication.activeClassStatusCode ||
        application.retainedInRepository !== expectedApplication.retainedInRepository ||
        !status || !expectedStatus ||
        status.url !== expectedStatus.url ||
        status.bytes !== expectedStatus.bytes ||
        status.sha256 !== expectedStatus.sha256 ||
        status.entryCount !== expectedStatus.entryCount ||
        status.dispositionSha256 !== expectedStatus.dispositionSha256 ||
        status.tableUpdated !== expectedStatus.tableUpdated ||
        status.retainedInRepository !== expectedStatus.retainedInRepository
    ) {
        throw new Error('Current trademark source contract drift');
    }
};

type AnnualFixturePair = {
    id: string;
    generationFromDate: string;
    generationToDate: string;
    fullFixtureId: string;
    statusOnlyFixtureId: string;
};

type PairFixture = {
    id: string;
    artifactId: string;
    actionKey: string;
    expectedPresence: { present: string[]; absent: string[] };
};

type PairArtifact = {
    id: string;
    officialMetadata?: { generationFromDate: string; generationToDate: string };
};

export const assertAnnualFixturePairs = (
    pairs: readonly AnnualFixturePair[],
    artifacts: readonly PairArtifact[],
    fixtures: readonly PairFixture[],
) => {
    const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    const fixturesById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

    for (const pair of pairs) {
        const full = fixturesById.get(pair.fullFixtureId);
        const statusOnly = fixturesById.get(pair.statusOnlyFixtureId);
        if (!full || !statusOnly) {
            throw new Error(`Annual fixture pair ${pair.id} references a missing fixture`);
        }
        if (full.actionKey !== 'TX' || statusOnly.actionKey !== 'TX') {
            throw new Error(`Annual fixture pair ${pair.id} must use TX observations`);
        }

        for (const fixture of [full, statusOnly]) {
            const metadata = artifactsById.get(fixture.artifactId)?.officialMetadata;
            if (
                !metadata ||
                metadata.generationFromDate !== pair.generationFromDate ||
                metadata.generationToDate !== pair.generationToDate
            ) {
                throw new Error(`Annual fixture pair ${pair.id} crosses official generations`);
            }
        }

        const fullGroups = ['mark-identification', 'case-file-statements', 'classifications', 'case-file-owners'];
        if (!fullGroups.every((group) => full.expectedPresence.present.includes(group))) {
            throw new Error(`Annual fixture pair ${pair.id} does not identify a full application fixture`);
        }
        if (!fullGroups.every((group) => statusOnly.expectedPresence.absent.includes(group))) {
            throw new Error(`Annual fixture pair ${pair.id} does not identify a status-only fixture`);
        }
    }
};
