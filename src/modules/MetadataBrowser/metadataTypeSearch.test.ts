import { describe, expect, it } from "vitest";
import type { MetadataTypeMeta } from "../../lib/tauri";
import {
  normalizeMetadataSearchQuery,
  resolveTreeGroup,
  typeMatchesMetadataSearch,
} from "./metadataTypeSearch";

function typeRow(partial: Partial<MetadataTypeMeta> & Pick<MetadataTypeMeta, "xml_name">): MetadataTypeMeta {
  return {
    directory_name: null,
    suffix: null,
    in_folder: false,
    group_name: "",
    parent_xml_name: null,
    ...partial,
  };
}

describe("resolveTreeGroup", () => {
  it("maps empty or unknown group to Other", () => {
    expect(resolveTreeGroup("")).toBe("Other");
    expect(resolveTreeGroup("   ")).toBe("Other");
    expect(resolveTreeGroup("Nope")).toBe("Other");
  });

  it("keeps known groups", () => {
    expect(resolveTreeGroup("UI & layout")).toBe("UI & layout");
  });
});

describe("normalizeMetadataSearchQuery", () => {
  it("strips zero-width space so label matches", () => {
    const q = `la\u200Bbel`;
    expect(normalizeMetadataSearchQuery(q)).toBe("label");
  });
});

describe("typeMatchesMetadataSearch", () => {
  it("matches CustomLabel by custom or label", () => {
    const row = typeRow({
      xml_name: "CustomLabel",
      parent_xml_name: "CustomLabels",
      group_name: "UI & layout",
    });
    expect(typeMatchesMetadataSearch(row, "custom")).toBe(true);
    expect(typeMatchesMetadataSearch(row, "label")).toBe(true);
  });

  it("matches CustomLabels bundle and exposes singular alias", () => {
    const row = typeRow({ xml_name: "CustomLabels", group_name: "Other" });
    expect(typeMatchesMetadataSearch(row, "customlabel")).toBe(true);
    expect(typeMatchesMetadataSearch(row, "custom label")).toBe(true);
  });
});
