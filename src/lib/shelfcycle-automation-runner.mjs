import { openShelfCycleSessionForLogin, submitShelfCycleNote, loadSubmissionPayload } from "./shelfcycle-automation.mjs";

function parseArgs(argv = []) {
  const [command = "", ...rest] = argv;
  const args = { command, payload: "" };

  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--payload") {
      args.payload = rest[index + 1] ?? "";
      index += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "login") {
    const { context, ...result } = await openShelfCycleSessionForLogin();
    console.log(JSON.stringify(result));
    await new Promise((resolve) => {
      context.on("close", resolve);
    });
    return;
  }

  if (args.command === "create-note") {
    if (!args.payload) {
      throw new Error("Missing --payload path for create-note.");
    }

    const payload = await loadSubmissionPayload(args.payload);
    const result = await submitShelfCycleNote(payload);
    console.log(JSON.stringify(result));
    return;
  }

  throw new Error("Usage: node src/lib/shelfcycle-automation-runner.mjs <login|create-note> [--payload file.json]");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
