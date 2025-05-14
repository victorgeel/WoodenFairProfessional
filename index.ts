import { TelegramClient, Api } from "npm:telegram";
import { StringSession } from "npm:telegram/sessions/index.js";
import { NewMessage, NewMessageEvent } from "npm:telegram/events/index.js";
import "jsr:@std/dotenv@0.225.4/load";

// --- Environment Variables ---
const API_ID_STR = Deno.env.get("TELEGRAM_API_ID");
const API_HASH = Deno.env.get("TELEGRAM_API_HASH");
const SESSION_STRING = Deno.env.get("TELEGRAM_SESSION_STRING");
const TARGET_GROUP_ID_STR = Deno.env.get("TARGET_GROUP_ID");
const SOURCE_CHAT_IDS_STR = Deno.env.get("SOURCE_CHAT_IDS");

if (!API_ID_STR || !API_HASH) {
  console.error("❌ TELEGRAM_API_ID and TELEGRAM_API_HASH must be set.");
  Deno.exit(1);
}

const API_ID = parseInt(API_ID_STR);
const stringSession = new StringSession(SESSION_STRING || "");
const client = new TelegramClient(stringSession, API_ID, API_HASH, {
  connectionRetries: 5,
});

let TARGET_GROUP_ID: bigint | null = null;
let SOURCE_CHAT_IDS: bigint[] = [];

if (SESSION_STRING) {
  if (!TARGET_GROUP_ID_STR || !SOURCE_CHAT_IDS_STR) {
    console.error("❌ TARGET_GROUP_ID and SOURCE_CHAT_IDS must be set in .env.");
    Deno.exit(1);
  }
  TARGET_GROUP_ID = BigInt(TARGET_GROUP_ID_STR);
  SOURCE_CHAT_IDS = SOURCE_CHAT_IDS_STR.split(",").map(id => BigInt(id.trim()));
}

const V2RAY_REGEX = /(vless:\/\/[^\s`]+|trojan:\/\/[^\s`]+|ss:\/\/[^\s`]+|vmess:\/\/[^\s`]+)/g;

async function generateSession() {
  console.log("Generating Telegram session string...");
  try {
    await client.start({
      phoneNumber: async () => prompt("📞 Phone number (+959...)") || "",
      password: async () => prompt("🔐 2FA Password (if any)") || "",
      phoneCode: async () => prompt("📨 Code from Telegram") || "",
      onError: (e) => console.error("Login Error:", e.message),
    });

    console.log("\n✅ TELEGRAM_SESSION_STRING:");
    console.log(client.session.save());
  } catch (err) {
    console.error("❌ Failed to generate session string:", err.message);
  } finally {
    await client.disconnect();
    Deno.exit(0);
  }
}

async function extractKeys(event: NewMessageEvent) {
  const message = event.message;
  const senderChatId = message.chatId;
  if (!SOURCE_CHAT_IDS.includes(senderChatId)) return;

  const keys = message.text?.match(V2RAY_REGEX);
  if (keys?.length) {
    const messageToSend = "```v2ray\n" + keys.join("\n") + "\n```";
    await client.sendMessage(TARGET_GROUP_ID!, { message: messageToSend });
    console.log(`Forwarded ${keys.length} keys to group.`);
  }
}

async function runBot() {
  try {
    await client.connect();
    const me = await client.getMe();
    console.log(`Logged in as ${me?.username || me?.id}`);

    client.addEventHandler(extractKeys, new NewMessage({ chats: SOURCE_CHAT_IDS as any[] }));
    console.log("Bot running and listening for messages...");
  } catch (err) {
    console.error("❌ Bot run failed:", err.message);
    if (err.message?.includes("AUTH_KEY_UNREGISTERED")) {
      console.error("🔑 Hint: Session string may be invalid or expired.");
    }
  }
}

if (!SESSION_STRING) {
  await generateSession();
} else {
  await runBot();
}
