import { expect, test } from 'bun:test';
import {
    assertAnnualFixturePairs,
    assertArtifactMetadataReferences,
    assertFixtureArtifactReferences,
    assertFixturePathInventory,
} from './uspto-fixture-manifest.ts';

test('rejects an artifact whose official metadata source has no match', () => {
    expect(() =>
        assertArtifactMetadataReferences([], [
            { id: 'annual-part', officialMetadata: { sourceId: 'misspelled-source' } },
        ]),
    ).toThrow(
        'Artifact annual-part must resolve to exactly one official metadata source; found 0 for misspelled-source',
    );
});

test('rejects a fixture whose artifact reference has no match', () => {
    expect(() => assertFixtureArtifactReferences([], [{ id: 'orphan', artifactId: 'expected-artifact' }])).toThrow(
        'Fixture orphan must resolve to exactly one artifact; found 0 for expected-artifact',
    );
});

test('rejects a fixture whose artifact reference has multiple matches', () => {
    const artifacts = [{ id: 'expected-artifact' }, { id: 'expected-artifact' }];

    expect(() => assertFixtureArtifactReferences(artifacts, [{ id: 'orphan', artifactId: 'expected-artifact' }])).toThrow(
        'Fixture orphan must resolve to exactly one artifact; found 2 for expected-artifact',
    );
});

test('rejects a fixture record omitted from the manifest', () => {
    const record = 'fixtures/uspto/records/unlisted.xml';

    expect(() => assertFixturePathInventory([record], [])).toThrow(`unlisted records: ${record}`);
});

test('accepts full and status-only fixtures from one official annual generation', () => {
    const officialMetadata = { generationFromDate: '1884-04-07', generationToDate: '2025-12-31' };
    const groups = ['mark-identification', 'case-file-statements', 'classifications', 'case-file-owners'];

    expect(() =>
        assertAnnualFixturePairs(
            [
                {
                    id: 'annual-shapes',
                    generationFromDate: '1884-04-07',
                    generationToDate: '2025-12-31',
                    fullFixtureId: 'full',
                    statusOnlyFixtureId: 'status-only',
                },
            ],
            [
                { id: 'full-artifact', officialMetadata },
                { id: 'status-artifact', officialMetadata },
            ],
            [
                {
                    id: 'full',
                    artifactId: 'full-artifact',
                    actionKey: 'TX',
                    expectedPresence: { present: groups, absent: [] },
                },
                {
                    id: 'status-only',
                    artifactId: 'status-artifact',
                    actionKey: 'TX',
                    expectedPresence: { present: [], absent: groups },
                },
            ],
        ),
    ).not.toThrow();
});

test('rejects annual fixture shapes from different official generations', () => {
    const groups = ['mark-identification', 'case-file-statements', 'classifications', 'case-file-owners'];

    expect(() =>
        assertAnnualFixturePairs(
            [
                {
                    id: 'annual-shapes',
                    generationFromDate: '1884-04-07',
                    generationToDate: '2025-12-31',
                    fullFixtureId: 'full',
                    statusOnlyFixtureId: 'status-only',
                },
            ],
            [
                {
                    id: 'full-artifact',
                    officialMetadata: { generationFromDate: '1884-04-07', generationToDate: '2025-12-31' },
                },
                {
                    id: 'status-artifact',
                    officialMetadata: { generationFromDate: '1884-04-07', generationToDate: '2024-12-31' },
                },
            ],
            [
                {
                    id: 'full',
                    artifactId: 'full-artifact',
                    actionKey: 'TX',
                    expectedPresence: { present: groups, absent: [] },
                },
                {
                    id: 'status-only',
                    artifactId: 'status-artifact',
                    actionKey: 'TX',
                    expectedPresence: { present: [], absent: groups },
                },
            ],
        ),
    ).toThrow('crosses official generations');
});
