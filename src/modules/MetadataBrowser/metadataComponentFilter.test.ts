import { describe, expect, it } from "vitest";
import type { MetadataComponentMeta } from "../../lib/tauri";
import { filterMetadataComponents } from "./metadataComponentFilter";

function row(full_name: string): MetadataComponentMeta {
  return { full_name, file_name: null, last_modified: null, created_by_name: null };
}

describe("filterMetadataComponents", () => {
  const sample: MetadataComponentMeta[] = [
    row("AI_Chat_Message__c.Body__c"),
    row("Opportunity__hd.CloseDate__c"),
    row("Account.Name"),
  ];

  it("contains match on object part", () => {
    const out = filterMetadataComponents(sample, "AI_Chat_Message__c", "CustomField");
    expect(out.map((r) => r.full_name)).toEqual(["AI_Chat_Message__c.Body__c"]);
  });

  it("contains match is case-insensitive on full Object.Field", () => {
    const out = filterMetadataComponents(sample, "OPPORTUNITY__HD.CLOSEDATE", "CustomField");
    expect(out.map((r) => r.full_name)).toEqual(["Opportunity__hd.CloseDate__c"]);
  });

  it("contains field fragment", () => {
    const out = filterMetadataComponents(sample, "CloseDate", "CustomField");
    expect(out.map((r) => r.full_name)).toEqual(["Opportunity__hd.CloseDate__c"]);
  });

  it("no false match when substring absent", () => {
    const out = filterMetadataComponents(sample, "AI_Chat_Message__c", "CustomField");
    expect(out.some((r) => r.full_name === "Opportunity__hd.CloseDate__c")).toBe(false);
  });
});
