import {
  openShelfCycleSessionForLogin,
  submitShelfCycleContact,
  submitShelfCycleCustomer,
  submitShelfCycleNote,
  submitShelfCyclePriceBookEntry,
  submitShelfCycleProductCode,
  submitShelfCycleProductDocument,
  submitShelfCycleSupplier,
  loadSubmissionPayload
} from "./shelfcycle-automation.mjs";

function parseArgs(argv = []) {
  const [command = "", ...rest] = argv;
  const args = { command, payload: "", url: "" };

  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--payload") {
      args.payload = rest[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (rest[index] === "--url") {
      args.url = rest[index + 1] ?? "";
      index += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "login") {
    const { context, ...result } = await openShelfCycleSessionForLogin({ url: args.url });
    console.log(JSON.stringify(result));
    await new Promise((resolve) => {
      context.on("close", resolve);
    });
    return;
  }

  if (args.command === "create-note" || args.command === "execute-action") {
    if (!args.payload) {
      throw new Error(`Missing --payload path for ${args.command}.`);
    }

    const payload = await loadSubmissionPayload(args.payload);

    const executors = {
      customer_note: submitShelfCycleNote,
      supplier_note: submitShelfCycleNote,
      order_or_logistics_note: submitShelfCycleNote,
      customer_create: submitShelfCycleCustomer,
      supplier_create: submitShelfCycleSupplier,
      contact_create: submitShelfCycleContact,
      pricing_record: submitShelfCyclePriceBookEntry,
      product_create_or_update: submitShelfCycleProductCode,
      product_document_followup: submitShelfCycleProductDocument
    };
    const executor = args.command === "create-note" ? submitShelfCycleNote : executors[payload.actionType];

    if (!executor) {
      throw new Error(`Unsupported ShelfCycle action type: ${payload.actionType || "unknown"}.`);
    }

    const result = await executor(payload);
    console.log(JSON.stringify(result));
    return;
  }

  throw new Error("Usage: node src/lib/shelfcycle-automation-runner.mjs <login|create-note|execute-action> [--payload file.json]");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
