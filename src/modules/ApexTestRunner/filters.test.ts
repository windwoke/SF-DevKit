import { describe, expect, it } from "vitest";
import {
  buildPackageCoverage,
  classKey,
  coverageTier,
  filterCoverage,
  filterTestClasses,
  formatCoverage,
  fullClassName,
  sortTestResults,
  testRunUrl,
} from "./filters";
import type { ApexCoverageResult, ApexTestClass, ApexTestMethodResult } from "./types";

const cls = (name: string, ns: string | null = null): ApexTestClass => ({
  id: null,
  name,
  namespace_prefix: ns,
  source: "org",
  file_path: null,
  is_test: true,
  member_type: "ApexClass",
});

describe("filterTestClasses", () => {
  const classes = [cls("AccountServiceSpec"), cls("PriceEngineTest"), cls("OrderSpec", "pack")];

  it("filters case-insensitively on name", () => {
    expect(filterTestClasses(classes, "price").map((c) => c.name)).toEqual(["PriceEngineTest"]);
    expect(filterTestClasses(classes, "SPEC").map((c) => c.name)).toEqual([
      "AccountServiceSpec",
      "OrderSpec",
    ]);
  });

  it("matches namespace", () => {
    expect(filterTestClasses(classes, "pack").map((c) => c.name)).toEqual(["OrderSpec"]);
  });

  it("returns all on empty search", () => {
    expect(filterTestClasses(classes, "  ").length).toBe(3);
  });

  it("keeps selection independent of search (caller-side keys are stable)", () => {
    const key = classKey(cls("AccountServiceSpec"));
    expect(filterTestClasses(classes, "price")).not.toContain(key);
    expect(classKey(cls("AccountServiceSpec"))).toBe(":AccountServiceSpec");
  });
});

describe("classKey / fullClassName", () => {
  it("joins namespace and name", () => {
    expect(fullClassName(null, "Foo")).toBe("Foo");
    expect(fullClassName("ns", "Foo")).toBe("ns.Foo");
    expect(classKey(cls("Foo", "ns"))).toBe("ns:Foo");
  });
});

const cov = (
  name: string,
  percent: number | null,
  total: number,
): ApexCoverageResult => ({
  id: name,
  name,
  covered_percent: percent,
  total_lines: total,
  covered_lines: Math.round(((percent ?? 0) / 100) * total),
  uncovered_lines: [],
});

describe("filterCoverage", () => {
  it("sorts DESCENDING by coverage (highest first)", () => {
    const rows = [cov("A", 90, 100), cov("B", 10, 100), cov("C", 50, 100)];
    expect(filterCoverage(rows, "").map((r) => r.name)).toEqual(["A", "C", "B"]);
  });

  it("sorts null coverage last", () => {
    const rows = [cov("Null", null, 0), cov("Low", 5, 100)];
    expect(filterCoverage(rows, "").map((r) => r.name)).toEqual(["Low", "Null"]);
  });

  it("filters by name case-insensitively", () => {
    const rows = [cov("AccountService", 90, 100), cov("OrderService", 10, 100)];
    expect(filterCoverage(rows, "order").map((r) => r.name)).toEqual(["OrderService"]);
  });
});

describe("coverageTier", () => {
  it("≥90 is green, 75–90 is yellow, below is red", () => {
    expect(coverageTier(100, 10)).toBe("green");
    expect(coverageTier(90, 10)).toBe("green");
    expect(coverageTier(89.9, 10)).toBe("yellow");
    expect(coverageTier(75, 10)).toBe("yellow");
    expect(coverageTier(74.9, 10)).toBe("red");
    expect(coverageTier(0, 10)).toBe("red");
  });

  it("null percent or zero lines is none", () => {
    expect(coverageTier(null, 0)).toBe("none");
    expect(coverageTier(50, 0)).toBe("none");
    expect(coverageTier(Number.NaN, 10)).toBe("none");
  });
});

describe("buildPackageCoverage", () => {
  const pkgClasses: ApexTestClass[] = [
    { ...cls("CoveredService"), source: "retrieve", is_test: false },
    { ...cls("UntouchedService"), source: "retrieve", is_test: false },
    { ...cls("UntouchedTrigger"), source: "retrieve", is_test: false, member_type: "ApexTrigger" },
    { ...cls("FooTest"), source: "retrieve", is_test: true },
  ];
  const runCoverage = [cov("CoveredService", 91, 100), cov("OutsideHelper", 40, 100)];

  it("merges package coverable members with run coverage, descending", () => {
    const rows = buildPackageCoverage(pkgClasses, runCoverage, "");
    const names = rows.map((r) => r.name);
    // Package members the run didn't touch appear with null percent, last.
    expect(names).toEqual([
      "CoveredService",
      "OutsideHelper",
      "UntouchedService",
      "UntouchedTrigger",
    ]);
    const untouched = rows.find((r) => r.name === "UntouchedService")!;
    expect(untouched.covered_percent).toBeNull();
    expect(untouched.in_package).toBe(true);
  });

  it("excludes package test classes from the coverage view", () => {
    const rows = buildPackageCoverage(pkgClasses, runCoverage, "");
    expect(rows.find((r) => r.name === "FooTest")).toBeUndefined();
  });

  it("includes triggers as untouched package members", () => {
    const rows = buildPackageCoverage(pkgClasses, runCoverage, "");
    const trigger = rows.find((r) => r.name === "UntouchedTrigger");
    expect(trigger).toBeDefined();
    expect(trigger!.in_package).toBe(true);
    expect(trigger!.covered_percent).toBeNull();
  });

  it("marks run-touched classes outside the package", () => {
    const rows = buildPackageCoverage(pkgClasses, runCoverage, "");
    const outside = rows.find((r) => r.name === "OutsideHelper")!;
    expect(outside.in_package).toBe(false);
    const inside = rows.find((r) => r.name === "CoveredService")!;
    expect(inside.in_package).toBe(true);
  });
});

describe("formatCoverage", () => {
  it("formats numbers with one decimal max", () => {
    expect(formatCoverage(82.46, 10)).toBe("82.5");
    expect(formatCoverage(100, 10)).toBe("100");
  });

  it("returns dash for zero lines and null percent (no NaN)", () => {
    expect(formatCoverage(null, 0)).toBe("—");
    expect(formatCoverage(50, 0)).toBe("—");
    expect(formatCoverage(Number.NaN, 10)).toBe("—");
  });
});

describe("testRunUrl", () => {
  it("builds the fixed Apex test queue setup URL", () => {
    expect(testRunUrl("https://x.my.salesforce.com")).toBe(
      "https://x.my.salesforce.com/lightning/setup/ApexTestQueue/home",
    );
  });

  it("trims trailing slashes from the instance url", () => {
    expect(testRunUrl("https://x.my.salesforce.com//")).toBe(
      "https://x.my.salesforce.com/lightning/setup/ApexTestQueue/home",
    );
  });
});

const test = (
  className: string,
  method: string,
  outcome: "Pass" | "Fail",
): ApexTestMethodResult => ({
  id: null,
  class_name: className,
  namespace_prefix: null,
  method_name: method,
  outcome,
  run_time_ms: 10,
  message: null,
  stack_trace: null,
});

describe("sortTestResults", () => {
  it("puts failures before passes", () => {
    const rows = [test("A", "t1", "Pass"), test("B", "t1", "Fail"), test("C", "t1", "Pass")];
    expect(sortTestResults(rows, "").map((r) => r.class_name)).toEqual(["B", "A", "C"]);
  });

  it("sorts by Class.Method within the same outcome", () => {
    const rows = [
      test("BClass", "zeta", "Pass"),
      test("AClass", "beta", "Pass"),
      test("AClass", "alpha", "Pass"),
    ];
    expect(sortTestResults(rows, "").map((r) => r.method_name)).toEqual(["alpha", "beta", "zeta"]);
  });

  it("filters by class or method name", () => {
    const rows = [test("AClass", "alpha", "Pass"), test("BClass", "beta", "Fail")];
    expect(sortTestResults(rows, "beta").map((r) => r.class_name)).toEqual(["BClass"]);
  });
});
