import { describe, expect, test } from "vitest";
import { parseCompletionContext } from "../contextParser";

describe("parseCompletionContext", () => {
  test("SELECT 后空格 → FIELD 补全", () => {
    const ctx = parseCompletionContext("SELECT ");
    expect(ctx.clause).toBe("SELECT");
    expect(ctx.triggerKind).toBe("FIELD");
    expect(ctx.relationshipPath).toEqual([]);
  });

  test("SELECT 逗号后 → FIELD 补全", () => {
    const ctx = parseCompletionContext("SELECT Name, ");
    expect(ctx.clause).toBe("SELECT");
    expect(ctx.triggerKind).toBe("FIELD");
  });

  test("FROM 后空格 → OBJECT 补全", () => {
    const ctx = parseCompletionContext("SELECT Id FROM ");
    expect(ctx.clause).toBe("FROM");
    expect(ctx.triggerKind).toBe("OBJECT");
  });

  test("SELECT Account. → RELATIONSHIP_FIELD", () => {
    const ctx = parseCompletionContext("SELECT Account.");
    expect(ctx.triggerKind).toBe("RELATIONSHIP_FIELD");
    expect(ctx.relationshipPath).toEqual(["Account"]);
  });

  test("SELECT Account.Owner. → RELATIONSHIP_FIELD 二级", () => {
    const ctx = parseCompletionContext("SELECT Account.Owner.");
    expect(ctx.triggerKind).toBe("RELATIONSHIP_FIELD");
    expect(ctx.relationshipPath).toEqual(["Account", "Owner"]);
  });

  test("SELECT Account.Owner.Manager. → RELATIONSHIP_FIELD 三级", () => {
    const ctx = parseCompletionContext("SELECT Account.Owner.Manager.");
    expect(ctx.relationshipPath).toEqual(["Account", "Owner", "Manager"]);
  });

  test("混合字段后的关系补全", () => {
    const ctx = parseCompletionContext("SELECT Id, Name, Account.");
    expect(ctx.relationshipPath).toEqual(["Account"]);
    expect(ctx.primaryObject).toBe(null);
  });

  test("有 FROM 的混合", () => {
    const ctx = parseCompletionContext("SELECT Id, Name, Account. FROM Contact");
    expect(ctx.primaryObject).toBe("Contact");
    expect(ctx.relationshipPath).toEqual(["Account"]);
  });

  test("WHERE 字段后 → OPERATOR 补全", () => {
    const ctx = parseCompletionContext("SELECT Id FROM Account WHERE Name ");
    expect(ctx.clause).toBe("WHERE");
    expect(ctx.triggerKind).toBe("OPERATOR");
    expect(ctx.whereField).toBe("NAME");
  });

  test("WHERE 操作符后 → VALUE 补全", () => {
    const ctx = parseCompletionContext("SELECT Id FROM Account WHERE Name = ");
    expect(ctx.triggerKind).toBe("VALUE");
    expect(ctx.whereOperator).toBe("=");
  });

  test("子查询 FROM 补全", () => {
    const ctx = parseCompletionContext("SELECT Id, (SELECT Id FROM ");
    expect(ctx.clause).toBe("SUBQUERY_FROM");
  });

  test("子查询字段补全", () => {
    const ctx = parseCompletionContext("SELECT Id, (SELECT ");
    expect(ctx.clause).toBe("SUBQUERY_SELECT");
  });

  test("ORDER BY 字段补全", () => {
    const ctx = parseCompletionContext("SELECT Id FROM Account ORDER BY ");
    expect(ctx.clause).toBe("ORDER_BY");
    expect(ctx.triggerKind).toBe("FIELD");
  });
});
