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
