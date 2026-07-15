import { expect, test } from "bun:test";

import {
  ACTIVE_CLASS_STATUS_CODE,
  APPLICATION_DOCUMENTATION_SOURCE,
  STATUS_POLICY_ENTRIES,
  STATUS_POLICY_SOURCE,
  STATUS_POLICY_VERSION,
} from "../../src/search/status-policy.ts";

test("pins the complete official 2025 status policy", () => {
  expect(STATUS_POLICY_VERSION).toBe("uspto-trademark-status-20250813");
  expect(STATUS_POLICY_SOURCE).toEqual({
    bytes: 154_624,
    sha256: "8d251bbd5af8e18eaf269524945bfd7b9714a2ac1600669486660fc75e5d6bf6",
    tableUpdated: "2023-06-20",
    url: "https://api.uspto.gov/api/v1/datasets/products/files/TRTDXFAP/Table1TrademarkStatusCodes_20250813.doc",
  });
  expect(APPLICATION_DOCUMENTATION_SOURCE).toEqual({
    bytes: 2_329_088,
    sha256: "96a1bcec082cad186ef3b41bb8bcb8fe970289ff0784de31c7e93e2a3780648b",
    url: "https://api.uspto.gov/api/v1/datasets/products/files/TRTDXFAP/Trademark-Applications-Documentation-v2.3-20250813.doc",
  });
  expect(ACTIVE_CLASS_STATUS_CODE).toBe("6");
  expect(STATUS_POLICY_ENTRIES).toHaveLength(169);
  expect(STATUS_POLICY_ENTRIES.filter((entry) => entry.status === "live")).toHaveLength(124);
  expect(STATUS_POLICY_ENTRIES.filter((entry) => entry.status === "dead")).toHaveLength(41);
  expect(STATUS_POLICY_ENTRIES.filter((entry) => entry.status === "unknown")).toHaveLength(4);
});

test("preserves representative and indifferent policy entries without losing 000 identity", () => {
  expect(STATUS_POLICY_ENTRIES.find(({ code }) => code === "616")?.status).toBe("live");
  expect(STATUS_POLICY_ENTRIES.find(({ code }) => code === "626")?.status).toBe("dead");
  expect(STATUS_POLICY_ENTRIES.filter(({ status }) => status === "unknown")).toEqual([
    { code: "000", status: "unknown" },
    { code: "622", status: "unknown" },
    { code: "715", status: "unknown" },
    { code: "970", status: "unknown" },
  ]);
  expect(STATUS_POLICY_ENTRIES[0]?.code).toBe("000");
});
