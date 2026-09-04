import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { parseDeskIndex, serializeDeskIndex } from "./harness.mjs";

const execFileP = promisify(execFile);

export async function installKit({ agentCwd, gitUrl, id, ref = "" }) {
  if (!agentCwd || !gitUrl || !id) {
    throw new Error("usage: AGENT_CWD=<desk> node install-kit.mjs <gitUrl> <id> [ref]");
  }
  const harnessDir = join(agentCwd, ".harness");
  const dest = join(harnessDir, "kits", id);
  await mkdir(join(harnessDir, "kits"), { recursive: true });
  await execFileP("git", ["clone", "--", gitUrl, dest]);
  if (ref) {
    await execFileP("git", ["-C", dest, "checkout", "--detach", ref]);
  }
  const indexPath = join(harnessDir, "index.yaml");
  let kits = [];
  try {
    kits = parseDeskIndex(await readFile(indexPath, "utf8"));
  } catch {}
  const rec = {
    id,
    path: `kits/${id}`,
    git: gitUrl,
    ref,
    active: true,
  };
  kits = [...kits.filter((k) => k.id !== id), rec];
  await writeFile(indexPath, serializeDeskIndex(kits));
  return rec;
}

const [gitUrl, id, ref] = process.argv.slice(2);
const isCli = process.argv[1] && process.argv[1].endsWith("install-kit.mjs");
if (isCli && process.argv[2]) {
  const rec = await installKit({
    agentCwd: process.env.AGENT_CWD,
    gitUrl,
    id,
    ref: ref || "",
  });
  console.log(`installed ${rec.id} -> ${rec.path}`);
}
