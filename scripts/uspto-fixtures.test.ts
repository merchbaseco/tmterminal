import { expect, test } from 'bun:test';
import { assertFixtureArtifactReferences, assertFixturePathInventory } from './uspto-fixture-manifest.ts';

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
