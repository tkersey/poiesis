import { describe, expect, test } from "bun:test";
import { assertNoPrivateMaterial, finalReceipt } from "../../tools/build-release.mjs";

describe("Poiesis release builder", () => {
  test("emits only the proved final claims", () => {
    const receipt = finalReceipt();
    expect(receipt).toContain("outcome=generated_child_completed_and_merged_real_task");
    expect(receipt).toContain("parent_byte_frozen=true");
    expect(receipt).toContain("manual_target_file_edits=0");
    expect(receipt).toContain("second_reducer=false");
  });

  test("rejects secrets and private paths", () => {
    expect(assertNoPrivateMaterial(Buffer.from("public source"), "fixture")).toBe(true);
    expect(() => assertNoPrivateMaterial(Buffer.from("OPENAI_API_KEY=sk-proj-secretsecretsecret"), "fixture")).toThrow();
    expect(() => assertNoPrivateMaterial(Buffer.from("/Users/example/private"), "fixture")).toThrow();
  });
});
