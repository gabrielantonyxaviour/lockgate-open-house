import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("hygiene", () => {
  it("keeps TypeScript files under 300 lines and out of console.log", () => {
    const paths = [...files("src"), ...files("test")];
    expect(paths.length).toBeGreaterThan(10);
    for (const path of paths) {
      const text = readFileSync(path, "utf8");
      const lines = text.split("\n").length;
      expect(lines, path).toBeLessThanOrEqual(300);
      if (path.startsWith("src/")) {
        const call = ["console", "log"].join(".");
        expect(text.includes(`${call}(`), path).toBe(false);
      }
    }
  });
});
