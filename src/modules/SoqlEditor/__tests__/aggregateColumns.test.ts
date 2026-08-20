import { describe, expect, test } from "vitest";
import {
  getByPath,
  parseSoqlLayout,
  remapAggregateExprColumns,
} from "../resultLayout";

describe("remapAggregateExprColumns", () => {
  test("COUNT(Id) 无别名 → expr0 映射", () => {
    const layout = parseSoqlLayout("SELECT Count(Id) FROM Account");
    expect(layout).not.toBeNull();
    const rows = [{ attributes: { type: "AggregateResult" }, expr0: 42 }];
    const cols = remapAggregateExprColumns(layout!.mainColumns, rows);
    expect(cols).toHaveLength(1);
    expect(getByPath(rows[0], (cols[0] as { path: string[] }).path)).toBe(42);
  });

  test("多个聚合 → 按位置映射 expr0/expr1/expr2", () => {
    const layout = parseSoqlLayout(
      "SELECT StageName, COUNT(Id), SUM(Amount), MAX(CloseDate) FROM Opportunity GROUP BY StageName",
    );
    const rows = [
      { attributes: { type: "AggregateResult" }, StageName: "Closed Won", expr0: 3, expr1: 150000, expr2: "2026-01-15" },
    ];
    const cols = remapAggregateExprColumns(layout!.mainColumns, rows);
    // 第一列是普通字段 StageName，保持原 path
    expect(getByPath(rows[0], (cols[0] as { path: string[] }).path)).toBe("Closed Won");
    expect(getByPath(rows[0], (cols[1] as { path: string[] }).path)).toBe(3);
    expect(getByPath(rows[0], (cols[2] as { path: string[] }).path)).toBe(150000);
    expect(getByPath(rows[0], (cols[3] as { path: string[] }).path)).toBe("2026-01-15");
  });

  test("带别名的聚合不受影响", () => {
    const layout = parseSoqlLayout("SELECT COUNT(Id) cnt FROM Account");
    const rows = [{ attributes: { type: "AggregateResult" }, cnt: 7 }];
    const cols = remapAggregateExprColumns(layout!.mainColumns, rows);
    // 别名列本身能取到值（normalizeFieldLabel 去掉别名留 COUNT(Id)，
    // 取不到值且没有 expr 键 → 原样返回）
    expect(cols[0].kind).toBe("field");
  });

  test("普通查询（无 expr 键）不改动列", () => {
    const layout = parseSoqlLayout("SELECT Id, Name FROM Account");
    const rows = [{ attributes: { type: "Account" }, Id: "001xx", Name: "Acme" }];
    const cols = remapAggregateExprColumns(layout!.mainColumns, rows);
    expect((cols[0] as { path: string[] }).path).toEqual(["Id"]);
    expect((cols[1] as { path: string[] }).path).toEqual(["Name"]);
  });

  test("COUNT() 空参聚合同样映射", () => {
    const layout = parseSoqlLayout("SELECT COUNT() FROM Contact");
    const rows = [{ attributes: { type: "AggregateResult" }, expr0: 0 }];
    const cols = remapAggregateExprColumns(layout!.mainColumns, rows);
    expect(getByPath(rows[0], (cols[0] as { path: string[] }).path)).toBe(0);
  });

  test("空行时原样返回", () => {
    const layout = parseSoqlLayout("SELECT Count(Id) FROM Account");
    const cols = remapAggregateExprColumns(layout!.mainColumns, []);
    expect(cols).toBe(layout!.mainColumns);
  });
});
