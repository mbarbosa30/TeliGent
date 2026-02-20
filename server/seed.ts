import { storage } from "./storage";
import { log } from "./index";

export async function seedDatabase() {
  try {
    const existingConfig = await storage.getConfig();
    if (existingConfig) {
      log("Database already seeded, skipping", "seed");
      return;
    }

    log("Seeding default config...", "seed");

    await storage.upsertConfig({
      botName: "ContextBot",
      personality: "You are a helpful and friendly group assistant. Answer questions based on the knowledge base provided. Be concise, clear, and avoid being repetitive. If someone reports an issue, acknowledge it professionally.",
      responseMode: "smart",
      cooldownSeconds: 15,
      maxResponseLength: 500,
      isActive: true,
      onlyRespondWhenMentioned: false,
      respondToReplies: true,
      trackReports: true,
      reportKeywords: ["report", "issue", "bug", "problem", "broken", "not working", "error", "help"],
    });

    log("Default config seeded", "seed");
  } catch (err: any) {
    log(`Seed error: ${err.message}`, "seed");
  }
}
