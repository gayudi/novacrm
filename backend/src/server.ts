import { app } from "./app.js";
import { config } from "./config.js";
import { db } from "./db.js";

await db.$connect();
const server = app.listen(config.PORT, "0.0.0.0", () => console.info(`Nova CRM API listening on port ${config.PORT}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.info(`Received ${signal}; shutting down.`);
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    server.close(() => { void db.$disconnect().then(() => process.exit(0)); });
  });
}
