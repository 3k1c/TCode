import { describe, expect, it } from "vitest";
import { descendantsOf, type WinProcessInfo } from "../src/windows-process-tree";

describe("Windows process tree", () => {
	const rows: WinProcessInfo[] = [
		{ pid: 100, parentPid: 1, createdAt: "a" },
		{ pid: 101, parentPid: 100, createdAt: "b" },
		{ pid: 102, parentPid: 101, createdAt: "c" },
		{ pid: 200, parentPid: 1, createdAt: "d" },
		{ pid: 201, parentPid: 200, createdAt: "e" },
	];
	it("tracks children and grandchildren, not unrelated processes", () => {
		expect(descendantsOf(100, rows).map((r) => r.pid)).toEqual([101, 102]);
	});
	it("does not traverse a cycle or include the parent", () => {
		expect(descendantsOf(100, [...rows, { pid: 100, parentPid: 102, createdAt: "a" }]).map((r) => r.pid)).toEqual([101, 102]);
	});
	it("does not kill unrelated process trees", () => {
		expect(descendantsOf(200, rows).map((r) => r.pid)).toEqual([201]);
	});
});
