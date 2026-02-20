import { storage } from "./storage";
import { log } from "./index";

export async function seedDatabase() {
  try {
    const existingKnowledge = await storage.getKnowledgeEntries();
    if (existingKnowledge.length > 0) {
      log("Database already seeded, skipping", "seed");
      return;
    }

    log("Seeding database with sample data...", "seed");

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

    const knowledgeEntries = [
      {
        title: "Getting Started Guide",
        content: "Welcome to our community! Here's how to get started:\n1. Read the rules in the pinned message\n2. Introduce yourself in the introductions channel\n3. Ask questions anytime - we're here to help\n4. Check the FAQ before asking common questions",
        category: "documentation" as const,
        sourceUrl: null,
        isActive: true,
      },
      {
        title: "Community Rules",
        content: "1. Be respectful to all members\n2. No spam or self-promotion without permission\n3. Keep discussions relevant to the channel topic\n4. No NSFW content\n5. Use English as the primary language\n6. Report any issues to the admins",
        category: "rules" as const,
        sourceUrl: null,
        isActive: true,
      },
      {
        title: "How to Report Issues",
        content: "To report an issue, simply describe what happened in the group chat. The bot will automatically detect reports containing keywords like 'bug', 'issue', 'problem', or 'broken'. Admins will review all reports on the dashboard.",
        category: "faq" as const,
        sourceUrl: null,
        isActive: true,
      },
      {
        title: "Project Documentation",
        content: "Our project documentation is available at docs.example.com. It covers API references, tutorials, and troubleshooting guides. For specific questions, ask in the group and the bot will try to help based on the knowledge base.",
        category: "links" as const,
        sourceUrl: "https://docs.example.com",
        isActive: true,
      },
      {
        title: "FAQ - Common Questions",
        content: "Q: How do I reset my password?\nA: Go to settings > account > reset password.\n\nQ: Where can I find the latest updates?\nA: Check the announcements channel or visit our blog.\n\nQ: How do I contact support?\nA: Send a message in the group with your issue, or email support@example.com",
        category: "faq" as const,
        sourceUrl: null,
        isActive: true,
      },
    ];

    for (const entry of knowledgeEntries) {
      await storage.createKnowledgeEntry(entry);
    }

    log(`Seeded ${knowledgeEntries.length} knowledge base entries`, "seed");
  } catch (err: any) {
    log(`Seed error: ${err.message}`, "seed");
  }
}
