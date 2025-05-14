import { TelegramClient, Api } from "npm:telegram";
import { StringSession } from "npm:telegram/sessions/index.js";
import { NewMessage, NewMessageEvent } from "npm:telegram/events/index.js";
import "jsr:@std/dotenv@0.225.4/load";

// --- Environment Variables ---
// .env ဖိုင်ထဲမှာ အောက်ပါတို့ကို သေချာထည့်သွင်းပေးပါ:
// TELEGRAM_API_ID=သင်၏API_ID
// TELEGRAM_API_HASH=သင်၏API_HASH
// TELEGRAM_SESSION_STRING= (ပထမအကြိမ် run ပြီးမှဖြည့်ရန် သို့မဟုတ် ရှိပြီးသား)
// TARGET_GROUP_ID= (Key တွေပို့ရမည့် Group ID)
// SOURCE_CHAT_IDS= (Key တွေရှာရမည့် Chat ID များ၊ တစ်ခုထက်ပိုလျှင် comma ခั่นပါ)

const API_ID_STR = Deno.env.get("TELEGRAM_API_ID");
const API_HASH = Deno.env.get("TELEGRAM_API_HASH");
const SESSION_STRING = Deno.env.get("TELEGRAM_SESSION_STRING");
const TARGET_GROUP_ID_STR = Deno.env.get("TARGET_GROUP_ID");
const SOURCE_CHAT_IDS_STR = Deno.env.get("SOURCE_CHAT_IDS");

if (!API_ID_STR || !API_HASH) {
  console.error("❌ TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env file.");
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
  if (TARGET_GROUP_ID_STR) {
    try {
      TARGET_GROUP_ID = BigInt(TARGET_GROUP_ID_STR.trim());
    } catch (e: any) {
      console.error(`❌ Invalid TARGET_GROUP_ID format: ${TARGET_GROUP_ID_STR}. Error: ${e.message}`);
      // Allow to continue if only ID finder is needed, but warn
      console.warn("⚠️ Bot may not forward keys if TARGET_GROUP_ID is invalid.");
      TARGET_GROUP_ID = null; // Ensure it's null if parsing failed
    }
  } else {
    console.warn("⚠️ TARGET_GROUP_ID is not set in .env. Key forwarding will not work.");
  }

  if (SOURCE_CHAT_IDS_STR) {
    try {
      SOURCE_CHAT_IDS = SOURCE_CHAT_IDS_STR.split(",")
        .map(id => id.trim())
        .filter(id => id.length > 0)
        .map(id => BigInt(id));
      if (SOURCE_CHAT_IDS.length === 0 && SOURCE_CHAT_IDS_STR.trim() !== "") {
          console.warn("⚠️ SOURCE_CHAT_IDS string was provided but no valid IDs were parsed. Key extraction from specific chats will not work.");
      }
    } catch (e: any) {
      console.error(`❌ Invalid SOURCE_CHAT_IDS format: ${SOURCE_CHAT_IDS_STR}. Error: ${e.message}`);
      console.warn("⚠️ Key extraction from specific chats may not work.");
      SOURCE_CHAT_IDS = []; // Ensure it's an empty array if parsing failed
    }
  } else {
     console.warn("⚠️ SOURCE_CHAT_IDS is not set in .env. Key extraction from specific chats will not work unless using ID finder.");
  }
}

const V2RAY_REGEX = /(vless:\/\/[^\s`]+|trojan:\/\/[^\s`]+|ss:\/\/[^\s`]+|vmess:\/\/[^\s`]+)/g;

async function generateSession() {
  console.log("🔄 Generating new Telegram session string...");
  try {
    // @ts-ignore
    await client.start({
      phoneNumber: async () => await prompt("📞 Enter your phone number (e.g., +959...):") || "",
      password: async () => await prompt("🔐 Enter your 2FA password (if any, press Enter if none):") || "",
      phoneCode: async () => await prompt("📨 Enter the code you received from Telegram:") || "",
      onError: (err) => console.error("Login Error:", err.message),
    });
    const currentSession = client.session.save();
    console.log("\n✅ New TELEGRAM_SESSION_STRING generated successfully!");
    console.log("Please copy the following string and paste it into your .env file under TELEGRAM_SESSION_STRING=");
    console.log("--------------------------------------------------");
    console.log(currentSession);
    console.log("--------------------------------------------------");
    console.log("IMPORTANT: After updating .env, please restart the script.");
  } catch (err: any) {
    console.error("❌ Failed to generate session string:", err.message);
  } finally {
    await client.disconnect();
    Deno.exit(0);
  }
}

// --- ID ရှာဖွေရန် ခေတ္တထည့်သွင်းထားသော function (DEBUGGING အတွက်) ---
async function tempChatIdFinder(event: NewMessageEvent) {
    const message = event.message;
    const senderChatId = message.chatId;
    let chatTitle = "Unknown Chat";
    try {
      const chat = await message.getChat();
      if (chat) {
        chatTitle = (chat as any).title || (chat as any).firstName || (chat as any).username || `ID Only: ${senderChatId}`;
      }
    } catch (e) {
      console.warn(`[ID FINDER] Could not get chat details for ID ${senderChatId}`);
    }
    console.log(`\n\n⭐️⭐️⭐️ [ID FINDER] Message received! ⭐️⭐️⭐️`);
    console.log(`Chat ID: ${senderChatId}`);
    console.log(`Chat Name/Title: ${chatTitle}`);
    console.log(`Message Text: "${message.text}"`);
    console.log(`From User ID: ${message.senderId}\n\n`);
  }
// --- ID ရှာဖွေရန် function အဆုံး ---


async function extractKeys(event: NewMessageEvent) {
  const message = event.message;
  const senderChatId = message.chatId;

  console.log(`[DEBUG] New message received. Chat ID: ${senderChatId}, From User/Peer ID: ${message.senderId}, Text: "${message.text}"`);

  const configuredSourceChatIdsString = SOURCE_CHAT_IDS.map(id => id.toString()).join(", ");
  console.log(`[DEBUG] Configured SOURCE_CHAT_IDS (as BigInts): [${configuredSourceChatIdsString}]`);

  const isFromConfiguredSourceChat = SOURCE_CHAT_IDS.some(id => id === senderChatId);
  console.log(`[DEBUG] Is message from a configured source chat? ${isFromConfiguredSourceChat}`);

  if (!isFromConfiguredSourceChat) {
    return;
  }

  console.log(`[DEBUG] Message IS from a configured source chat (ID: ${senderChatId}). Processing for V2Ray keys...`);

  if (!message.text || message.text.trim() === "") {
    console.log(`[DEBUG] Message text is empty or whitespace only. No V2Ray keys to find.`);
    return;
  }

  const keys = message.text.match(V2RAY_REGEX);
  console.log(`[DEBUG] Regex match for V2Ray keys (result): ${JSON.stringify(keys)}`);

  if (keys && keys.length > 0) {
    console.log(`[DEBUG] Found ${keys.length} V2Ray key(s): "${keys.join("\", \"")}"`);
    const messageToSend = "```v2ray\n" + keys.join("\n") + "\n```";
    
    if (!TARGET_GROUP_ID) {
        console.error("❌ ERROR: TARGET_GROUP_ID is not set or invalid. Cannot forward keys.");
        return;
    }
    try {
      await client.sendMessage(TARGET_GROUP_ID, { message: messageToSend });
      console.log(`✅ Successfully forwarded ${keys.length} key(s) from chat ${senderChatId} to target group ${TARGET_GROUP_ID}.`);
    } catch (error: any) {
      console.error(`❌ ERROR: Failed to send message to target group ${TARGET_GROUP_ID}. Error: ${error.message}`, error);
    }
  } else {
    console.log(`[DEBUG] No V2Ray keys found matching the regex in message from chat ${senderChatId}.`);
  }
}

async function runBot() {
  try {
    if (!SESSION_STRING) {
        console.error("❌ TELEGRAM_SESSION_STRING is not found in .env. Cannot start the bot.");
        console.log("ℹ️ Please run the script once to generate it, or add an existing one to your .env file.");
        await generateSession();
        return;
    }
    
    // TARGET_GROUP_ID and SOURCE_CHAT_IDS are parsed when SESSION_STRING exists.
    // Warnings for missing/invalid TARGET_GROUP_ID or SOURCE_CHAT_IDS are handled during parsing.

    console.log("ℹ️ Attempting to connect to Telegram...");
    await client.connect();
    const me = await client.getMe();
    console.log(`✅ Logged in successfully as: ${me?.username || `ID: ${me?.id}`}`);

    // --- ID ရှာရန် handler ကို ဤနေရာတွင် အမြဲတမ်း (ခေတ္တ debugging အတွက်) ထည့်ထားမည် ---
    // Chat ID အမှန်ကို သိရှိပြီး `.env` ဖိုင်တွင် မှန်ကန်စွာ ထည့်သွင်းပြီးပါက ဤ handler ကို comment ပိတ်ပါ သို့မဟုတ် ဖယ်ရှားပါ။
    console.log("🔔 INFO: Temporary Chat ID Finder is ACTIVE. All messages seen by the bot will be logged with their Chat IDs.");
    client.addEventHandler(tempChatIdFinder, new NewMessage({})); // Message အားလုံးကို နားထောင်မည်
    // --- ------------------------------------------------------------------------------- ---

    if (SOURCE_CHAT_IDS && SOURCE_CHAT_IDS.length > 0) {
        client.addEventHandler(extractKeys, new NewMessage({ chats: SOURCE_CHAT_IDS as any[] }));
        console.log("🤖 Bot is now running and listening for new messages in specified source chats...");
        console.log(`👂 Listening on Chat IDs: [${SOURCE_CHAT_IDS.map(id => id.toString()).join(", ")}]`);
        if (TARGET_GROUP_ID) {
            console.log(`🎯 Forwarding to Target Group ID: ${TARGET_GROUP_ID}`);
        } else {
            console.warn("⚠️ WARNING: TARGET_GROUP_ID is not set. Keys will be extracted but not forwarded.");
        }
    } else {
        console.warn("⚠️ WARNING: SOURCE_CHAT_IDS is empty or not defined. V2Ray key extraction from specific chats is disabled.");
        console.log("🤖 Bot is running with the temporary ID finder. No specific chats are being monitored for V2Ray keys.");
    }

  } catch (err: any) {
    console.error("❌ Bot run failed:", err.message);
    if (err.message?.includes("AUTH_KEY_UNREGISTERED") || err.message?.includes("SESSION_REVOKED") || err.message?.includes("USER_DEACTIVATED")) {
      console.error("🔑 Critical Error: The session string seems to be invalid, expired, or revoked.");
      console.error("💡 Hint: You might need to delete the TELEGRAM_SESSION_STRING from your .env file and run the script again to generate a new one.");
    }
  }
}

// --- Main Execution Logic ---
(async () => {
  if (!SESSION_STRING) {
    console.log("ℹ️ No TELEGRAM_SESSION_STRING found in .env. Starting session generation process...");
    await generateSession();
  } else {
    console.log("ℹ️ TELEGRAM_SESSION_STRING found. Attempting to start the bot...");
    if (!TARGET_GROUP_ID_STR && !SOURCE_CHAT_IDS_STR) {
        console.warn("⚠️ WARNING: Neither TARGET_GROUP_ID nor SOURCE_CHAT_IDS are set in the .env file.");
        console.warn("The bot will start with the ID finder, but key forwarding and extraction from specific chats will not work until these are configured.");
    } else if (!TARGET_GROUP_ID_STR) {
        console.warn("⚠️ WARNING: TARGET_GROUP_ID is not set in the .env file. Key forwarding will not work.");
    } else if (!SOURCE_CHAT_IDS_STR) {
        console.warn("⚠️ WARNING: SOURCE_CHAT_IDS is not set in the .env file. Key extraction from specific chats will not work.");
    }
    await runBot();
  }
})();

