import type { BotInstance } from "./types";

const instances = new Map<number, BotInstance>();

export function registerBotInstance(botConfigId: number, instance: BotInstance): void {
  instances.set(botConfigId, instance);
}

export function unregisterBotInstance(botConfigId: number): void {
  instances.delete(botConfigId);
}

export function getActiveBotInstance(botConfigId: number): BotInstance | undefined {
  return instances.get(botConfigId);
}

export function listActiveBotInstances(): Array<{ botConfigId: number; instance: BotInstance }> {
  return Array.from(instances.entries()).map(([botConfigId, instance]) => ({ botConfigId, instance }));
}
