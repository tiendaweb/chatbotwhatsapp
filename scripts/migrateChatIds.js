const fs = require("fs");
const path = require("path");
const { query } = require("../database/dbpromise");
const { convertNumberToRandomString } = require("../utils/chatId");

async function migrateChats() {
  const chats = await query(
    "SELECT chat_id, sender_mobile, uid FROM chats",
    []
  );

  const updates = [];

  for (const chat of chats) {
    const senderMobile = chat.sender_mobile;
    if (!senderMobile) {
      continue;
    }

    const newChatId = convertNumberToRandomString(senderMobile);

    if (!newChatId || newChatId === chat.chat_id) {
      continue;
    }

    updates.push({
      oldChatId: chat.chat_id,
      newChatId,
      uid: chat.uid,
    });
  }

  for (const update of updates) {
    await query(
      "UPDATE chats SET chat_id = ? WHERE chat_id = ?",
      [update.newChatId, update.oldChatId]
    );
    await query(
      "UPDATE agent_chats SET chat_id = ? WHERE chat_id = ?",
      [update.newChatId, update.oldChatId]
    );

    const inboxDir = path.join(
      __dirname,
      "../conversations/inbox",
      String(update.uid)
    );

    const previousFile = path.join(inboxDir, `${update.oldChatId}.json`);
    const nextFile = path.join(inboxDir, `${update.newChatId}.json`);

    if (fs.existsSync(previousFile)) {
      fs.mkdirSync(path.dirname(nextFile), { recursive: true });

      if (fs.existsSync(nextFile)) {
        const previousData = JSON.parse(fs.readFileSync(previousFile, "utf8"));
        const existingData = JSON.parse(fs.readFileSync(nextFile, "utf8"));
        const merged = [...existingData, ...previousData];
        merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        fs.writeFileSync(nextFile, JSON.stringify(merged, null, 2));
        fs.unlinkSync(previousFile);
      } else {
        fs.renameSync(previousFile, nextFile);
      }
    }
  }

  return updates.length;
}

migrateChats()
  .then((count) => {
    console.log(`Migrated ${count} chat_id records.`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed to migrate chat ids", error);
    process.exit(1);
  });
