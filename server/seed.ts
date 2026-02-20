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

    const bestPracticeEntries = [
      {
        title: "How to Interact with the Bot",
        content: "You can interact with the bot in several ways:\n- Mention the bot by username (@) to ask a direct question\n- Reply to one of the bot's messages to continue a conversation\n- Ask a question (messages with ? or starting with who/what/how/why/when) and the bot may respond in smart mode\n- The bot remembers what it said when you reply to its messages, so you can have back-and-forth conversations",
        category: "documentation" as const,
        sourceUrl: null,
        isActive: true,
      },
      {
        title: "Reporting Issues",
        content: "To report an issue or problem, simply describe it in the group chat. The bot automatically detects messages containing keywords like bug, issue, problem, broken, not working, or error. Reports are logged and visible to admins on the dashboard. You do not need to use any special command — just describe what went wrong in plain language.",
        category: "faq" as const,
        sourceUrl: null,
        isActive: true,
      },
      {
        title: "Group Etiquette",
        content: "Best practices for group members:\n- Be respectful and constructive in all interactions\n- Stay on topic for the relevant channel or group\n- Avoid spamming, excessive self-promotion, or repeated messages\n- Search the chat history or ask the bot before posting common questions\n- When reporting issues, include as much detail as possible (what happened, what you expected, steps to reproduce)",
        category: "rules" as const,
        sourceUrl: null,
        isActive: true,
      },
      {
        title: "Bot Capabilities & Limitations",
        content: "The bot can:\n- Answer questions based on its knowledge base and configured context\n- Understand and reference project/community information provided by admins\n- Detect and log issue reports for admin review\n- Continue conversations when you reply to its messages\n\nThe bot cannot:\n- Perform actions outside of the group chat (e.g., create accounts, process transactions)\n- Access private messages or other groups\n- Guarantee 100% accuracy — always verify critical information from official sources\n- Respond during cooldown periods (to avoid being spammy)",
        category: "documentation" as const,
        sourceUrl: null,
        isActive: true,
      },
    ];

    for (const entry of bestPracticeEntries) {
      await storage.createKnowledgeEntry(entry);
    }

    log(`Default config and ${bestPracticeEntries.length} best practice entries seeded`, "seed");
  } catch (err: any) {
    log(`Seed error: ${err.message}`, "seed");
  }
}
