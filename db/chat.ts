import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type StoredConversation = {
  id: string;
  participant_a: number;
  participant_a_name: string;
  participant_b: number;
  participant_b_name: string;
  created_at: number;
  updated_at: number;
};

export type StoredMessage = {
  id: string;
  conversation_id: string;
  sender_user_id: number;
  sender_name: string;
  body: string;
  created_at: number;
  read_at: number | null;
};

export type StoredPushSubscription = {
  user_id: number;
  endpoint: string;
  expiration_time: number | null;
  p256dh: string;
  auth: string;
  updated_at: number;
};

type ChatStore = {
  version: 1;
  conversations: StoredConversation[];
  messages: StoredMessage[];
  push_subscriptions: StoredPushSubscription[];
};

const dataDirectory = path.resolve(process.cwd(), "data");
const storePath = path.join(dataDirectory, "chat-store.json");
let mutationQueue: Promise<unknown> = Promise.resolve();

const emptyStore = (): ChatStore => ({
  version: 1,
  conversations: [],
  messages: [],
  push_subscriptions: [],
});

async function readStore(): Promise<ChatStore> {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as Partial<ChatStore>;
    return {
      version: 1,
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      push_subscriptions: Array.isArray(parsed.push_subscriptions) ? parsed.push_subscriptions : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw new Error("Não foi possível ler as conversas salvas.");
  }
}

async function writeStore(store: ChatStore) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryPath = `${storePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(store), "utf8");
  await rename(temporaryPath, storePath);
}

async function mutateStore<T>(mutation: (store: ChatStore) => T | Promise<T>) {
  const operation = mutationQueue.then(async () => {
    const store = await readStore();
    const result = await mutation(store);
    await writeStore(store);
    return result;
  });
  mutationQueue = operation.catch(() => undefined);
  return operation;
}

export function conversationId(firstUserId: number, secondUserId: number) {
  return [firstUserId, secondUserId].sort((left, right) => left - right).join(":");
}

export function isConversationParticipant(conversation: StoredConversation | undefined, userId: number) {
  return Boolean(
    conversation
    && (conversation.participant_a === userId || conversation.participant_b === userId),
  );
}

export async function listConversations(userId: number) {
  const store = await readStore();
  return store.conversations
    .filter((item) => isConversationParticipant(item, userId))
    .map((conversation) => {
      const messages = store.messages.filter((message) => message.conversation_id === conversation.id);
      const lastMessage = messages.sort((left, right) => right.created_at - left.created_at)[0];
      return {
        id: conversation.id,
        other_user_id: conversation.participant_a === userId ? conversation.participant_b : conversation.participant_a,
        other_user_name: conversation.participant_a === userId ? conversation.participant_b_name : conversation.participant_a_name,
        updated_at: conversation.updated_at,
        last_message: lastMessage?.body ?? null,
        last_message_at: lastMessage?.created_at ?? null,
        unread_count: messages.filter((message) =>
          message.sender_user_id !== userId && message.read_at == null,
        ).length,
      };
    })
    .sort((left, right) => right.updated_at - left.updated_at);
}

export async function createConversation(
  currentUser: { id: number; name: string },
  recipient: { id: number; name: string },
) {
  return mutateStore((store) => {
    const id = conversationId(currentUser.id, recipient.id);
    let conversation = store.conversations.find((item) => item.id === id);
    if (!conversation) {
      const currentIsA = currentUser.id < recipient.id;
      const now = Date.now();
      conversation = {
        id,
        participant_a: currentIsA ? currentUser.id : recipient.id,
        participant_a_name: currentIsA ? currentUser.name : recipient.name,
        participant_b: currentIsA ? recipient.id : currentUser.id,
        participant_b_name: currentIsA ? recipient.name : currentUser.name,
        created_at: now,
        updated_at: now,
      };
      store.conversations.push(conversation);
    }
    return {
      id,
      other_user_id: recipient.id,
      other_user_name: recipient.name,
      updated_at: conversation.updated_at,
      last_message: null,
      last_message_at: null,
      unread_count: 0,
    };
  });
}

export async function listMessages(conversationIdValue: string, userId: number) {
  return mutateStore((store) => {
    const conversation = store.conversations.find((item) => item.id === conversationIdValue);
    if (!isConversationParticipant(conversation, userId)) return null;
    const now = Date.now();
    store.messages.forEach((message) => {
      if (
        message.conversation_id === conversationIdValue
        && message.sender_user_id !== userId
        && message.read_at == null
      ) message.read_at = now;
    });
    return store.messages
      .filter((message) => message.conversation_id === conversationIdValue)
      .sort((left, right) => left.created_at - right.created_at)
      .slice(-250);
  });
}

export async function addMessage(
  conversationIdValue: string,
  sender: { id: number; name: string },
  body: string,
) {
  return mutateStore((store) => {
    const conversation = store.conversations.find((item) => item.id === conversationIdValue);
    if (!isConversationParticipant(conversation, sender.id)) return null;
    const message: StoredMessage = {
      id: crypto.randomUUID(),
      conversation_id: conversationIdValue,
      sender_user_id: sender.id,
      sender_name: sender.name,
      body,
      created_at: Date.now(),
      read_at: null,
    };
    store.messages.push(message);
    conversation!.updated_at = message.created_at;
    const recipientUserId = conversation!.participant_a === sender.id
      ? conversation!.participant_b
      : conversation!.participant_a;
    return { message, recipientUserId };
  });
}

export async function savePushSubscription(
  userId: number,
  subscription: Omit<StoredPushSubscription, "user_id" | "updated_at">,
) {
  return mutateStore((store) => {
    store.push_subscriptions = store.push_subscriptions.filter(
      (item) => item.endpoint !== subscription.endpoint,
    );
    store.push_subscriptions.push({
      ...subscription,
      user_id: userId,
      updated_at: Date.now(),
    });
  });
}

export async function removePushSubscription(userId: number, endpoint: string) {
  return mutateStore((store) => {
    store.push_subscriptions = store.push_subscriptions.filter(
      (item) => !(item.user_id === userId && item.endpoint === endpoint),
    );
  });
}

export async function removePushSubscriptionByEndpoint(endpoint: string) {
  return mutateStore((store) => {
    store.push_subscriptions = store.push_subscriptions.filter(
      (item) => item.endpoint !== endpoint,
    );
  });
}

export async function listPushSubscriptions(userId: number) {
  const store = await readStore();
  return store.push_subscriptions.filter((item) => item.user_id === userId);
}
