import { startServer } from "./src/server/server.mjs";

const port = Number.parseInt(process.env.PORT ?? "4318", 10);

startServer({ port });
