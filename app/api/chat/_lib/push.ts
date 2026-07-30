import webpush from "web-push";
import {
  listPushSubscriptions,
  removePushSubscriptionByEndpoint,
} from "../../../../db/chat";

let configured = false;

function configureWebPush() {
  if (configured) return true;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export async function sendChatPush(
  recipientUserId: number,
  senderName: string,
  body: string,
  conversationId: string,
) {
  if (!configureWebPush()) return;
  const subscriptions = await listPushSubscriptions(recipientUserId);
  const payload = JSON.stringify({
    title: `Nova mensagem de ${senderName}`,
    body,
    icon: "/brand-app-icon-192.png",
    badge: "/notification-badge-96.png",
    tag: `chat-${conversationId}`,
    data: { url: "/?open=communication" },
  });

  await Promise.allSettled(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        expirationTime: subscription.expiration_time,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      }, payload, {
        TTL: 60,
        urgency: "high",
      });
    } catch (error) {
      const statusCode = Number((error as { statusCode?: number }).statusCode || 0);
      if (statusCode === 404 || statusCode === 410) {
        await removePushSubscriptionByEndpoint(subscription.endpoint);
        return;
      }
      throw error;
    }
  }));
}
