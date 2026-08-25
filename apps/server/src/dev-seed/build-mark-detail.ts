import type { SeededRandom } from "./random.ts";
import { dayLabel, shiftDays } from "./time-offsets.ts";
import type { MarkDetailSink } from "./types.ts";
import {
  goodsServicesByClass,
  internationalClasses,
  ownerRoots,
  ownerSuffixes,
  partyTypes,
  statusEventVocabulary,
} from "./vocabulary.ts";

/**
 * The rows hanging off one mark: its international classes and the goods and
 * services wording for each, its owners, and the prosecution events the mark
 * detail page prints as a timeline.
 */

const secondClassChance = 0.35;
const secondOwnerChance = 0.18;
const activeClassStatusCode = "6";
const minStatusEvents = 2;
const maxStatusEvents = 5;

export function addClassesAndGoods(input: {
  catalog: MarkDetailSink;
  random: SeededRandom;
  serialNumber: string;
  source: Record<string, unknown>;
  transactionDate: string;
}) {
  const { catalog, random, serialNumber, source, transactionDate } = input;
  const codes = new Set<string>();
  const classCount = random.chance(secondClassChance) ? random.int(2, 3) : 1;
  while (codes.size < classCount) {
    codes.add(random.pick(internationalClasses));
  }

  for (const [index, internationalCode] of [...codes].sort().entries()) {
    catalog.classes.push({
      ...source,
      international_code: internationalCode,
      ordinal: index + 1,
      serial_number: serialNumber,
      // 6 is the active class status code; see ACTIVE_CLASS_STATUS_CODE.
      status_code: activeClassStatusCode,
      status_date: transactionDate,
    });

    const wording = goodsServicesByClass[internationalCode];
    if (wording) {
      catalog.goodsServices.push({
        ...source,
        ordinal: index + 1,
        serial_number: serialNumber,
        text: random.pick(wording),
        // GS<class><sequence> is the USPTO type code shape the mark summary
        // ranks on when it picks an excerpt.
        type_code: `GS${internationalCode}${index + 1}`,
      });
    }
  }
}

export function addOwners(input: {
  catalog: MarkDetailSink;
  random: SeededRandom;
  serialNumber: string;
  source: Record<string, unknown>;
}) {
  const { catalog, random, serialNumber, source } = input;
  const ownerCount = random.chance(secondOwnerChance) ? 2 : 1;

  for (let ordinal = 1; ordinal <= ownerCount; ordinal += 1) {
    catalog.owners.push({
      ...source,
      entry_number: String(ordinal),
      ordinal,
      party_name: `${random.pick(ownerRoots)} ${random.pick(ownerSuffixes)}`,
      party_type: random.pick(partyTypes),
      serial_number: serialNumber,
    });
  }
}

export function addStatusEvents(input: {
  catalog: MarkDetailSink;
  filingDate: string;
  random: SeededRandom;
  serialNumber: string;
  source: Record<string, unknown>;
  transactionDate: string;
}) {
  const { catalog, filingDate, random, serialNumber, source, transactionDate } = input;
  const events = random
    .shuffle(statusEventVocabulary)
    .slice(0, random.int(minStatusEvents, maxStatusEvents));
  const span = Math.max(
    1,
    Math.round((new Date(transactionDate).getTime() - new Date(filingDate).getTime()) / 86_400_000)
  );

  for (const [index, event] of events.entries()) {
    const eventDate = dayLabel(
      shiftDays(new Date(filingDate), Math.round((span * (index + 1)) / (events.length + 1)))
    );
    catalog.statusEvents.push({
      ...source,
      code: event.code,
      description: event.description,
      event_date: eventDate,
      // Unique per mark: the vocabulary is sampled without replacement.
      event_key: `${event.code}-${index + 1}`,
      event_number: String(index + 1),
      serial_number: serialNumber,
      type: event.type,
    });
  }
}
