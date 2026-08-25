/**
 * Word pools for the synthetic trademark catalog. Nothing here is real USPTO
 * data; it exists so a dev search returns marks, owners, classes, and goods
 * wording that read like the register instead of `mark-1`.
 *
 * The pools are deliberately small and overlapping. Print-on-demand sellers
 * search crowded word families, so a realistic dev catalog needs the same
 * shape: many marks sharing a token, several sharing a whole word mark, and
 * short single-token marks that a screened paragraph can actually hit.
 */

/** Single-token marks. Short enough that text screening finds them in prose. */
export const soloMarks = [
  "GNOME",
  "HARVEST",
  "TIDEPOOL",
  "WILDFLOWER",
  "MOONLIT",
  "SASQUATCH",
  "PAWSITIVE",
  "BOOKWORM",
  "CAMPFIRE",
  "SOURDOUGH",
] as const;

export const themeWords = [
  "ALPINE",
  "COASTAL",
  "COSMIC",
  "DESERT",
  "HARVEST",
  "LAKESIDE",
  "MIDNIGHT",
  "RETRO",
  "SUNRISE",
  "TIDEPOOL",
  "VINTAGE",
  "WILDFLOWER",
] as const;

export const subjectWords = [
  "BOOK CLUB",
  "BREAD BAKER",
  "CAMP COOK",
  "DOG MOM",
  "FLY FISHER",
  "GARDEN GNOME",
  "HIKING CREW",
  "KAYAK SQUAD",
  "MUSHROOM HUNTER",
  "TRAIL RUNNER",
] as const;

export const toneWords = [
  "CLUB",
  "CO",
  "COLLECTIVE",
  "GOODS",
  "PRESS",
  "STUDIO",
  "SUPPLY",
  "THREADS",
] as const;

export const ownerSuffixes = ["LLC", "INC", "CO", "GROUP LLC", "HOLDINGS LLC"] as const;

export const ownerRoots = [
  "BRIGHT HARBOR",
  "CABIN SEASON",
  "FIELD NOTE",
  "LOUD FERRET",
  "NORTHWIND",
  "QUIET HOURS",
  "SLOW SUNDAY",
  "WANDERING PINE",
] as const;

/**
 * USPTO party types: 1 individual, 2 firm, 3 corporation, 16 limited liability
 * company. The spread matters because the mark detail page prints the type.
 */
export const partyTypes = ["1", "2", "3", "16", "16", "16"] as const;

/**
 * International classes weighted towards apparel, because that is what a
 * print-on-demand seller screens against. 025 apparel, 009 software, 016
 * paper, 018 leather, 021 housewares, 030 coffee, 035 retail, 041 education.
 */
export const internationalClasses = [
  "025",
  "025",
  "025",
  "016",
  "018",
  "021",
  "009",
  "030",
  "035",
  "041",
] as const;

export const goodsServicesByClass: Record<string, readonly string[]> = {
  "009": ["Downloadable mobile applications for tracking outdoor activity"],
  "016": ["Stickers; notebooks; art prints", "Greeting cards; posters"],
  "018": ["Tote bags; backpacks; drawstring bags"],
  "021": ["Mugs; drinking glasses; water bottles sold empty"],
  "025": [
    "Clothing, namely, t-shirts, sweatshirts, and hooded sweatshirts",
    "Apparel, namely, tank tops, long sleeve shirts, and raglans",
    "T-shirts; hats; socks",
  ],
  "030": ["Coffee; tea; cocoa"],
  "035": ["Online retail store services featuring apparel and accessories"],
  "041": ["Entertainment services, namely, providing a podcast in the field of the outdoors"],
};

/**
 * Drawing codes, weighted the way the register is: standard character marks
 * dominate. 1 typeset, 2/3/5 design, 4 standard character. The `markTypeSql`
 * projection buckets these into typeset, design, text, and other, and the
 * seed covers every bucket including `other`.
 */
export const drawingCodes = ["4", "4", "4", "4", "4", "1", "2", "3", "5", "6"] as const;

/**
 * Status codes drawn so the generated `search_status` column covers live, dead
 * and unknown with a live-dominant mix, matching the real register. See
 * `src/search/status-policy.ts` for the code-to-status table.
 */
export const liveStatusCodes = ["700", "630", "641", "820", "616", "800", "686"] as const;
export const deadStatusCodes = ["606", "710", "602", "404", "900", "712"] as const;
export const unknownStatusCodes = ["000", "622", "715", "970"] as const;

export const statusEventVocabulary = [
  { code: "NPUB", description: "NOTICE OF PUBLICATION", type: "O" },
  { code: "PUBO", description: "PUBLISHED FOR OPPOSITION", type: "O" },
  { code: "NOAM", description: "NOTICE OF ALLOWANCE E-MAILED", type: "O" },
  { code: "REGS", description: "REGISTERED-PRINCIPAL REGISTER", type: "R" },
  { code: "CNSA", description: "NOTICE OF ACCEPTANCE OF SEC. 8 & 15", type: "R" },
  { code: "GNRN", description: "NON-FINAL ACTION E-MAILED", type: "O" },
  { code: "TEME", description: "TEAS RESPONSE TO OFFICE ACTION RECEIVED", type: "I" },
  { code: "DOCK", description: "ASSIGNED TO EXAMINER", type: "I" },
] as const;
