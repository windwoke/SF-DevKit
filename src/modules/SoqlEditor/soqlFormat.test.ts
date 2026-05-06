import { describe, expect, it } from "vitest";
import { collapseSoqlWhitespace, extractParenSubqueryInner, formatSoql, splitTopLevelCommaSegments } from "./soqlFormat";

describe("collapseSoqlWhitespace", () => {
  it("preserves spaces inside single-quoted strings", () => {
    expect(collapseSoqlWhitespace("SELECT  Name  FROM  User  WHERE  Name  =  'a  b'")).toBe(
      "SELECT Name FROM User WHERE Name = 'a  b'",
    );
  });
});

describe("splitTopLevelCommaSegments", () => {
  it("does not split on comma inside parentheses", () => {
    const segs = splitTopLevelCommaSegments("Id, (SELECT Name FROM Contact), Name");
    expect(segs).toEqual(["Id", "(SELECT Name FROM Contact)", "Name"]);
  });
});

describe("extractParenSubqueryInner", () => {
  it("returns inner only for full (SELECT …) segment", () => {
    expect(extractParenSubqueryInner("(SELECT Id FROM Contact)")).toBe("SELECT Id FROM Contact");
    expect(extractParenSubqueryInner("(Today)")).toBeNull();
  });
});

describe("formatSoql", () => {
  it("breaks major clauses and uppercases keywords", () => {
    const out = formatSoql("select id,name from account where name!=null order by name limit 10");
    expect(out).toContain("SELECT");
    expect(out).toContain("\nFROM ");
    expect(out).toContain("\nWHERE ");
    expect(out).toContain("\nORDER BY ");
    expect(out).toContain("\nLIMIT ");
  });

  it("puts subquery on own lines with indentation", () => {
    const q = "select id, (select name from contact) from account limit 10";
    const out = formatSoql(q);
    expect(out).toMatch(/SELECT\n\s+id,/m);
    expect(out).toMatch(/\n\s+\(\n/m);
    expect(out).toMatch(/SELECT\n\s+name/m);
    expect(out).toMatch(/\n\s+FROM contact/mi);
    expect(out).toMatch(/\n\s+\)\nFROM account/i);
  });

  it("does not split FROM inside subquery when formatting inner", () => {
    const out = formatSoql("select id, (select name from contact) from account");
    expect(out).toMatch(/FROM contact/i);
    expect(out).toMatch(/\nFROM account/i);
  });
});
