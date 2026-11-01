import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, type BufferChannel } from "@/db/schema";
import { BufferApiError, bufferGraphQL, CHANNELS_QUERY, type ChannelsData } from "./api";
import { getValidAccessToken, ReconnectRequired } from "./tokens";

const CHANNEL_CACHE_MS = 60_000; // manual re-sync cooldown; protects the shared app quota

/** Returns cached channels; hits Buffer only when forced (and past cooldown) or never synced. */
export async function getChannels(userId: string, force = false): Promise<{ channels: BufferChannel[]; syncedAt: Date | null; cooldown: boolean }> {
  const db = getDb();
  const [u] = await db.select({ orgId: users.orgId, channelsCache: users.channelsCache, channelsSyncedAt: users.channelsSyncedAt })
    .from(users).where(eq(users.id, userId));
  if (!u) throw new ReconnectRequired("Your TeachQueue account no longer exists. Please connect again.");
  const fresh = u.channelsSyncedAt && Date.now() - u.channelsSyncedAt.getTime() < CHANNEL_CACHE_MS;
  if (u.channelsCache && (!force || fresh)) {
    return { channels: u.channelsCache, syncedAt: u.channelsSyncedAt, cooldown: Boolean(force && fresh) };
  }
  if (!u.orgId) return { channels: [], syncedAt: null, cooldown: false };
  const token = await getValidAccessToken(userId);
  let data: ChannelsData;
  try {
    data = await bufferGraphQL<ChannelsData>(token, CHANNELS_QUERY, { organizationId: u.orgId });
  } catch (e) {
    // A 401 with an unexpired token means the grant was revoked in Buffer: ask to reconnect.
    if (e instanceof BufferApiError && e.status === 401) throw new ReconnectRequired();
    throw e;
  }
  const channels: BufferChannel[] = data.channels.map((c) => ({
    id: c.id, name: c.name, displayName: c.displayName ?? null, service: c.service,
    descriptor: c.descriptor, avatar: c.avatar ?? null, isDisconnected: c.isDisconnected, isLocked: c.isLocked,
  }));
  const syncedAt = new Date();
  await db.update(users).set({ channelsCache: channels, channelsSyncedAt: syncedAt }).where(eq(users.id, userId));
  return { channels, syncedAt, cooldown: false };
}
