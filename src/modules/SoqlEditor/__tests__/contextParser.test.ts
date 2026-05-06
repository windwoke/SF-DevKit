import { describe, expect, test } from "vitest";
import { findNearestSubqueryOpenParen, getSubqueryFromObjectBeforeCursor, parseCompletionContext } from "../contextParser";

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

  test("子查询 FROM 输入中仍走关系名补全", () => {
    const ctx = parseCompletionContext("SELECT Id, (SELECT Id FROM Acc");
    expect(ctx.clause).toBe("SUBQUERY_FROM");
    expect(ctx.triggerKind).toBe("OBJECT");
    expect(ctx.subquery?.childRelationshipName).toBe("Acc");
  });

  test("复杂主查询中首个子查询 FROM 仍可补全", () => {
    const ctx = parseCompletionContext("SELECT Id, Name, Industry, (Select id, AccountId,CreatedDate  from ");
    expect(ctx.clause).toBe("SUBQUERY_FROM");
    expect(ctx.triggerKind).toBe("OBJECT");
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

  test("TYPEOF WHEN 对象补全", () => {
    const ctx = parseCompletionContext("SELECT TYPEOF Who WHEN  FROM Task");
    expect(ctx.clause).toBe("TYPEOF_WHEN");
    expect(ctx.triggerKind).toBe("OBJECT");
    expect(ctx.typeof?.fieldName).toBe("Who");
  });

  test("TYPEOF THEN 字段补全", () => {
    const ctx = parseCompletionContext("SELECT TYPEOF Who WHEN Contact THEN  FROM Task");
    expect(ctx.clause).toBe("TYPEOF_THEN");
    expect(ctx.triggerKind).toBe("FIELD");
    expect(ctx.typeof?.whenObject).toBe("Contact");
  });
});

describe("findNearestSubqueryOpenParen", () => {
  test("子查询已闭合且光标在主查询末尾时返回 -1", () => {
    const q = "SELECT Id, (SELECT Name FROM Contact) FROM Account";
    expect(findNearestSubqueryOpenParen(q, q.length)).toBe(-1);
  });

  test("未闭合子查询可定位到 (", () => {
    const q = "SELECT Id, (SELECT Name, CreatedDate FROM ";
    const open = findNearestSubqueryOpenParen(q, q.length);
    expect(open).toBeGreaterThanOrEqual(0);
    expect(q.slice(open, open + 10)).toMatch(/^\(\s*SELECT/i);
  });
});

describe("getSubqueryFromObjectBeforeCursor", () => {
  test("光标在子查询 SELECT 列表时不会误用主查询的 FROM", () => {
    const q = `SELECT Id, (SELECT Name, x
FROM account
LIMIT 10`;
    const cursor = q.indexOf("x") + 1;
    expect(getSubqueryFromObjectBeforeCursor(q, cursor)).toBeNull();
  });

  test("光标在子查询 WHERE 前可解析出子查询 FROM 对象", () => {
    const q = "SELECT Id, (SELECT Name FROM Contact WHERE Id = '1'";
    const cursor = q.indexOf("WHERE");
    expect(getSubqueryFromObjectBeforeCursor(q, cursor)).toBe("Contact");
  });

  test("已闭合子查询：光标在 FROM 之前的 SELECT 列表仍能解析 FROM 后对象", () => {
    const q =
      "SELECT Id, Name, (select id, 输入 from AccountContactRelations)\nFROM Account\nLIMIT 20";
    const cursor = q.indexOf("输入") + "输入".length;
    expect(getSubqueryFromObjectBeforeCursor(q, cursor)).toBe("AccountContactRelations");
  });
});
