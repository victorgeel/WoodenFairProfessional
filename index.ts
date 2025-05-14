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
const stringSession = new StringSession(SESSION_STRING || ""); // SESSION_STRING မရှိပါက empty string ဖြင့် session စတင်မည်။

const client = new TelegramClient(stringSession, API_ID, API_HASH, {
  connectionRetries: 5,
});

let TARGET_GROUP_ID: bigint | null = null;
let SOURCE_CHAT_IDS: bigint[] = [];

if (SESSION_STRING) { // session string ရှိမှသာ target နှင့် source ID များကို သတ်မှတ်မည်။
  if (!TARGET_GROUP_ID_STR) {
    console.error("❌ TARGET_GROUP_ID must be set in .env file when TELEGRAM_SESSION_STRING is present.");
    Deno.exit(1);
  }
  try {
    TARGET_GROUP_ID = BigInt(TARGET_GROUP_ID_STR.trim());
  } catch (e) {
    console.error(`❌ Invalid TARGET_GROUP_ID format: ${TARGET_GROUP_ID_STR}. It should be a valid number/BigInt. Error: ${e.message}`);
    Deno.exit(1);
  }

  if (!SOURCE_CHAT_IDS_STR) {
    console.error("❌ SOURCE_CHAT_IDS must be set in .env file when TELEGRAM_SESSION_STRING is present.");
    Deno.exit(1);
  }
  try {
    SOURCE_CHAT_IDS = SOURCE_CHAT_IDS_STR.split(",")
      .map(id => id.trim())
      .filter(id => id.length > 0) // ખાલી ID များကို ဖယ်ရှားရန်
      .map(id => BigInt(id));
    if (SOURCE_CHAT_IDS.length === 0) {
        console.error("❌ SOURCE_CHAT_IDS are provided but none are valid or found after parsing.");
        Deno.exit(1);
    }
  } catch (e) {
    console.error(`❌ Invalid SOURCE_CHAT_IDS format: ${SOURCE_CHAT_IDS_STR}. Ensure they are comma-separated valid numbers/BigInts. Error: ${e.message}`);
    Deno.exit(1);
  }
}


const V2RAY_REGEX = /(vless:\/\/[^\s`]+|trojan:\/\/[^\s`]+|ss:\/\/[^\s`]+|vmess:\/\/[^\s`]+)/g;

async function generateSession() {
  console.log("🔄 Generating new Telegram session string...");
  try {
    // @ts-ignore - Deno's prompt might conflict with other type definitions if not ignored.
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
    // Session generate လုပ်ပြီးရင် disconnect လုပ်ပြီး script ကို ရပ်လိုက်မယ်။
    // User က session string ကို .env မှာထည့်ပြီး ပြန် run ရန်လိုသည်။
    await client.disconnect();
    Deno.exit(0);
  }
}

async function extractKeys(event: NewMessageEvent) {
  const message = event.message;
  const senderChatId = message.chatId; // This should be a BigInt from the gramjs library

  console.log(`[DEBUG] New message received. Chat ID: ${senderChatId}, From User/Peer ID: ${message.senderId}, Text: "${message.text}"`);

  const configuredSourceChatIdsString = SOURCE_CHAT_IDS.map(id => id.toString()).join(", ");
  console.log(`[DEBUG] Configured SOURCE_CHAT_IDS (as BigInts): [${configuredSourceChatIdsString}]`);

  // senderChatId (BigInt) ကို SOURCE_CHAT_IDS (BigInt array) ထဲမှာ တိုက်ဆိုင်စစ်ဆေးပါ
  const isFromConfiguredSourceChat = SOURCE_CHAT_IDS.some(id => id === senderChatId);
  console.log(`[DEBUG] Is message from a configured source chat? ${isFromConfiguredSourceChat}`);

  if (!isFromConfiguredSourceChat) {
    // SOURCE_CHAT_IDS မှန်ကန်ကြောင်း သေချာသွားပါက ဤ log ကို comment ပြန်ပိတ်ထားနိုင်သည်
    // console.log(`[DEBUG] Message from Chat ID ${senderChatId} is not in configured SOURCE_CHAT_IDS. Ignoring.`);
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
    console.log(`[DEBUG] Found ${keys.length} V2Ray key(s): "${keys.join("\", \"")}"`); // Key များကို ပိုရှင်းလင်းအောင် log ထုတ်သည်
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
    if (!SESSION_STRING) { // SESSION_STRING မရှိလျှင် bot ကို run မရပါ။
        console.error("❌ TELEGRAM_SESSION_STRING is not found in .env. Cannot start the bot.");
        console.log("ℹ️ Please run the script once to generate it, or add an existing one to your .env file.");
        await generateSession(); // Session မရှိလျှင် generate လုပ်ခိုင်းမည်။
        return; // generateSession() will exit, but ensure no further code runs here.
    }
    
    // Session string ရှိပြီး target/source ID များလည်း သတ်မှတ်ပြီးဖြစ်မှ bot ကို connect လုပ်မည်။
    if (TARGET_GROUP_ID === null || SOURCE_CHAT_IDS.length === 0) {
        console.error("❌ TARGET_GROUP_ID or SOURCE_CHAT_IDS are not properly configured. Please check your .env file and ensure they are set when a session string is present.");
        Deno.exit(1);
    }
    
    console.log("ℹ️ Attempting to connect to Telegram...");
    await client.connect();
    const me = await client.getMe();
    console.log(`✅ Logged in successfully as: ${me?.username || `ID: ${me?.id}`}`);

    // BigInt[] type ကို any[] သို့မဟုတ် သင့်တော်ရာ type သို့ ပြောင်းရန်လိုနိုင်သည် (gramjs library type ပေါ်မူတည်၍)
    // gramJS v2 often expects just `BigInt[]` or `string[]` or `number[]` for chats
    client.addEventHandler(extractKeys, new NewMessage({ chats: SOURCE_CHAT_IDS as any[] }));
    console.log("🤖 Bot is now running and listening for new messages in specified source chats...");
    console.log(`👂 Listening on Chat IDs: [${SOURCE_CHAT_IDS.map(id => id.toString()).join(", ")}]`);
    console.log(`🎯 Forwarding to Target Group ID: ${TARGET_GROUP_ID}`);

  } catch (err: any) {
    console.error("❌ Bot run failed:", err.message);
    if (err.message?.includes("AUTH_KEY_UNREGISTERED") || err.message?.includes("SESSION_REVOKED") || err.message?.includes("USER_DEACTIVATED")) {
      console.error("🔑 Critical Error: The session string seems to be invalid, expired, or revoked.");
      console.error("💡 Hint: You might need to delete the TELEGRAM_SESSION_STRING from your .env file and run the script again to generate a new one.");
    } else if (err.message?.includes("PHONE_CODE_INVALID")) {
        console.error("🔑 Critical Error: The phone code provided during login was invalid.");
    }
    // Consider if Deno.exit(1) is needed for critical startup failures not handled by generateSession.
  }
}

// --- Main Execution Logic ---
(async () => {
  if (!SESSION_STRING) {
    console.log("ℹ️ No TELEGRAM_SESSION_STRING found in .env. Starting session generation process...");
    await generateSession();
  } else {
    console.log("ℹ️ TELEGRAM_SESSION_STRING found. Attempting to start the bot...");
    await runBot();
  }
})();
