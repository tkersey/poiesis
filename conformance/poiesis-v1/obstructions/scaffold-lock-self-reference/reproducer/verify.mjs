import { createHash } from "node:crypto";

const sha1 = (value) => createHash("sha1").update(value).digest();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const objectId = (type, value) => sha1(Buffer.concat([Buffer.from(`${type} ${value.length}\0`), value]));
const parent = "1".repeat(40);
let candidate = "0".repeat(40);
const observations = [];

for (let iteration = 0; iteration < 64; iteration += 1) {
  const policy = Buffer.from(`${JSON.stringify({ format: "praxis-workspace-policy/v1", baseRevision: candidate })}\n`);
  const lock = Buffer.from(`${JSON.stringify({ format: "poiesis-scaffold-lock/v1", baselineCommit: candidate, birthPolicySha256: sha256(policy) })}\n`);
  const blob = objectId("blob", lock);
  const treeBody = Buffer.concat([Buffer.from("100644 scaffold.lock.json\0"), blob]);
  const tree = objectId("tree", treeBody).toString("hex");
  const commitBody = Buffer.from(`tree ${tree}\nparent ${parent}\nauthor Poiesis <poiesis@example.invalid> 0 +0000\ncommitter Poiesis <poiesis@example.invalid> 0 +0000\n\nFreeze scaffold\n`);
  const successor = objectId("commit", commitBody).toString("hex");
  observations.push({ iteration, candidate, successor });
  if (successor === candidate) throw new Error("unexpected cryptographic fixed point; preserve this result and reassess the obstruction");
  candidate = successor;
}

process.stdout.write(`${JSON.stringify({
  format: "poiesis-scaffold-self-reference-reproducer/v1",
  iterations: observations.length,
  stabilized: false,
  dependency_cycle: ["commit", "policy.baseRevision", "policy.sha256", "lock.birthPolicySha256", "lock.baselineCommit", "lock.blob", "tree", "commit"],
  first: observations[0],
  last: observations.at(-1),
  preserving_resolution: "tag scaffold commit A, then commit lock and policy evidence B with first parent A",
})}\n`);
