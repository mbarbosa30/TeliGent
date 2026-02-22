import { log } from "./index";

export async function seedDatabase() {
  log("Multi-tenant mode: no global seeding needed. Each user creates their own config.", "seed");
}
