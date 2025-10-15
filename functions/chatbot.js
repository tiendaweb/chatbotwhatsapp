const { query } = require("../database/dbpromise");
const moment = require("moment-timezone");
const fetch = require("node-fetch");
const { addON } = require("../env.js");

async function makeRequest({ method, url, body = null, headers = [] }) {
  try {
    // Create an AbortController to handle the timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 seconds

    // Convert headers array to an object
    const headersObject = headers.reduce((acc, { key, value }) => {
      acc[key] = value;
      return acc;
    }, {});

    // Convert body array to an object if it's not GET or DELETE
    const requestBody =
      method === "GET" || method === "DELETE"
        ? undefined
        : JSON.stringify(
            body.reduce((acc, { key, value }) => {
              acc[key] = value;
              return acc;
            }, {})
          );

    // Set up the request configuration
    const config = {
      method,
      headers: headersObject,
      body: requestBody,
      signal: controller.signal,
    };

    console.log({
      config,
    });

    // Perform the request
    const response = await fetch(url, config);

    // Clear the timeout
    clearTimeout(timeoutId);

    // Check if the response status is OK
    if (!response.ok) {
      return { success: false, msg: `HTTP error ${response.status}` };
    }

    // Parse the response
    const data = await response.json();

    // Validate the response
    if (typeof data === "object" || Array.isArray(data)) {
      return { success: true, data };
    } else {
      return { success: false, msg: "Invalid response format" };
    }
  } catch (error) {
    // Handle errors (e.g., timeout, network issues)
    return { success: false, msg: error.message };
  }
}

// Function to check if a date has passed in a given timezone
function hasDatePassedInTimezone(timezone, date) {
  const momentDate = moment.tz(date, timezone);
  const currentMoment = moment.tz(timezone);
  return momentDate.isBefore(currentMoment);
}

const msgType = [
  "TEXT",
  "IMAGE",
  "AUDIO",
  "VIDEO",
  "DOCUMENT",
  "BUTTON",
  "LIST",
];

const toolsType = ["ASSIGN_AGENT", "DISABLE_CHAT", "MAKE_REQUEST"];

const addonType = ["AI_BOT"];

async function checkIfDisabled(flow, senderNumber) {
  try {
    const parseDisableArr = flow?.prevent_list
      ? JSON.parse(flow?.prevent_list)
      : [];

    const extractMobileDataFromList = parseDisableArr.filter(
      (x) => x.mobile == senderNumber
    );

    if (extractMobileDataFromList.length > 0) {
      const scheduleDate = extractMobileDataFromList[0]?.timestamp
        ? new Date(extractMobileDataFromList[0]?.timestamp)
        : null;

      if (
        !hasDatePassedInTimezone(
          extractMobileDataFromList[0]?.timezone,
          scheduleDate
        )
      ) {
        return "STOP";
      }
    }
  } catch (err) {
    console.log("ERROR FOUND IN replyMessage in chatbot.js");
    console.log(err);
  }
}

async function replyMessage({
  uid,
  k,
  chatbotFromMysq,
  toName,
  senderNumber,
  sendMetaMsg,
  chatId,
  nodes,
  edges,
  incomingMsg,
}) {
  try {
    // replacing variables global
    k.data.msgContent = returnAfterAddingVariable(k.data.msgContent, {
      senderName: toName,
      senderMsg: incomingMsg,
      senderMobile: senderNumber,
    });

    const saveObj = {
      type: k?.type?.toLowerCase(),
      metaChatId: "",
      msgContext: k?.data.msgContent,
      reaction: "",
      timestamp: "",
      senderName: toName,
      senderMobile: senderNumber,
      status: "sent",
      star: false,
      route: "OUTGOING",
    };

    console.log({ msgCon: JSON.stringify(k?.data.msgContent) });

    await sendMetaMsg(uid, k?.data.msgContent, senderNumber, saveObj, chatId);
  } catch (err) {
    console.log("ERROR FOUND IN replyMessage in chatbot.js");
    console.log(err);
  }
}

async function completeTools({
  uid,
  k,
  chatbotFromMysq,
  toName,
  senderNumber,
  sendMetaMsg,
  chatId,
  nodes,
  edges,
  flow,
}) {
  try {
    // assigning chat to agent
    if (k?.type == "ASSIGN_AGENT") {
      if (k?.data?.msgContent?.agentEmail) {
        // checking if the chat was already assigned
        const checkIfAlreadyChatAsssigned = await query(
          `SELECT * FROM agent_chats WHERE owner_uid = ? AND uid = ? AND chat_id = ?`,
          [uid, k?.data?.msgContent?.agentObj?.uid, chatId]
        );
        if (checkIfAlreadyChatAsssigned?.length < 1) {
          await query(
            `INSERT INTO agent_chats (owner_uid, uid, chat_id) VALUES (?,?,?)`,
            [uid, k?.data?.msgContent?.agentObj?.uid, chatId]
          );
        }
      }
    }

    // adding disabling chat to mysql for chat
    if (k?.type == "DISABLE_CHAT") {
      const getChat = await query(
        `SELECT * FROM chats WHERE chat_id = ? AND uid = ?`,
        [chatId, uid]
      );

      if (getChat?.length > 0) {
        const oldObj = getChat[0]?.prevent_list
          ? JSON.parse(getChat[0]?.prevent_list)
          : [];

        const newObj = {
          mobile: senderNumber,
          timestamp: k?.data?.msgContent?.timestamp,
          timezone: k?.data?.msgContent?.timezone,
        };

        const finalArr = [...oldObj, newObj];

        await query(
          `UPDATE flow SET prevent_list = ? WHERE uid = ? AND flow_id = ?`,
          [JSON.stringify(finalArr), uid, flow?.flow_id]
        );

        // await query(
        //   `UPDATE chats SET prevent_list = ? WHERE uid = ? AND chat_id = ?`,
        //   [JSON.stringify(finalArr), uid, chatId]
        // );
        console.log(
          senderNumber,
          "was moved to disable list till",
          k?.data?.msgContent?.timestamp
        );
      }
    }

    // making a request
    if (k?.type == "MAKE_REQUEST") {
      const msgContent = k?.data?.msgContent;

      if (msgContent?.response) {
        const resp = await makeRequest({
          method: msgContent?.type,
          url: msgContent?.url,
          body: msgContent?.body,
          headers: msgContent?.headers,
        });

        console.log({
          resp,
        });

        const findSourceFromEdge = edges?.filter((x) => x.source == k?.id);

        if (findSourceFromEdge?.length > 0) {
          for (const f of findSourceFromEdge) {
            const getNodeFromSource = nodes?.filter((x) => x.id == f?.target);

            for (const k of getNodeFromSource) {
              k.data.msgContent = returnAfterAddingVariable(
                k.data.msgContent,
                resp?.data
              );

              await destributeTaskFlow({
                uid,
                k,
                chatbotFromMysq,
                toName,
                senderNumber,
                sendMetaMsg,
                chatId,
                nodes,
                edges,
              });
            }
          }
        }

        // const getNodeFromSource = nodes?.filter(
        //   (x) => x.id == findSourceFromEdge[0]?.target
        // );

        // for (const k of getNodeFromSource) {
        //   k.data.msgContent = returnAfterAddingVariable(
        //     k.data.msgContent,
        //     resp?.data
        //   );

        //   await destributeTaskFlow({
        //     uid,
        //     k,
        //     chatbotFromMysq,
        //     toName,
        //     senderNumber,
        //     sendMetaMsg,
        //     chatId,
        //     nodes,
        //     edges,
        //   });
        // }
      } else {
        console.log(
          "There was no connected node found in the MAKE_REQUEST tool"
        );
      }
    }
  } catch (err) {
    console.log("ERROR FOUND IN completeTools in chatbot.js");
    console.log(err);
  }
}

async function completeAddon({
  uid,
  k,
  chatbotFromMysq,
  toName,
  senderNumber,
  sendMetaMsg,
  chatId,
  nodes,
  edges,
  incomingMsg,
  destributeTaskFlow,
}) {
  if (k?.type == "AI_BOT" && addON?.includes("AI_BOT")) {
    const { singleReplyAi } = require("./ai.js");
    console.log(`singleReplyAi ran`);
    await singleReplyAi({
      uid,
      k,
      chatbotFromMysq,
      toName,
      senderNumber,
      sendMetaMsg,
      chatId,
      nodes,
      edges,
      incomingMsg,
      destributeTaskFlow,
    });
  }
}

async function manupulateAiForAll({
  uid,
  k,
  chatbotFromMysq,
  toName,
  senderNumber,
  sendMetaMsg,
  chatId,
  nodes,
  edges,
  incomingMsg,
  flow,
}) {
  try {
    const aiArr = flow?.ai_list ? JSON.parse(flow?.ai_list) : [];

    const findIncomingNumber = aiArr?.filter(
      (x) => x.senderNumber == senderNumber
    );

    // Checking if assigned to AI
    if (k?.data?.msgContent?.assignAi) {
      if (findIncomingNumber?.length < 1) {
        // Updating MySQL flow and adding sender number to AI array
        const pusObj = {
          senderNumber: senderNumber,
          k,
          toName,
        };
        const newArr = [...aiArr, pusObj];

        await query(
          `UPDATE flow SET ai_list = ? WHERE uid = ? AND flow_id = ?`,
          [JSON.stringify(newArr), uid, flow?.flow_id]
        );

        // await query(
        //   "UPDATE chats SET ai_list = ? WHERE uid = ? AND chat_id = ?",
        //   [JSON.stringify(newArr), uid, chatId]
        // );
        return "NO_CHANGE"; // No modification needed for k
      }
    } else {
      if (findIncomingNumber?.length > 0) {
        return "MODIFY"; // Indicate that k should be modified
      }
    }

    return "NO_CHANGE"; // Default return value
  } catch (err) {
    console.log("Error found in manupulateAiForAll() in chatbot.js", err);
    return "NO_CHANGE"; // Return to continue flow even if there's an error
  }
}

async function destributeTaskFlow({
  uid,
  k,
  chatbotFromMysq,
  toName,
  senderNumber,
  sendMetaMsg,
  chatId,
  nodes,
  edges,
  incomingMsg,
  flowData,
}) {
  // console.log(JSON.stringify({ k }));
  let taskName = k?.type || k?.nodeType;

  console.log({ senderNumber, toName });

  // getting flow data
  const [flow] = await query(`SELECT * FROM flow WHERE flow_id = ?`, [
    flowData?.flow_id,
  ]);

  // returning fucntion if the number is in prevent list
  const checkOnce = await checkIfDisabled(flow, senderNumber);
  if (checkOnce === "STOP") {
    return;
  }

  const check = await manupulateAiForAll({
    uid,
    k,
    chatbotFromMysq,
    toName,
    senderNumber,
    sendMetaMsg,
    chatId,
    nodes,
    edges,
    incomingMsg,
    flow,
  });

  if (check == "MODIFY") {
    const aiArr = flow?.ai_list ? JSON.parse(flow?.ai_list) : [];
    const findIncomingNumber = aiArr?.filter(
      (x) => x.senderNumber == senderNumber
    );
    const aiObj = findIncomingNumber[0];
    k = aiObj?.k;
  }

  taskName = k?.type || k?.nodeType;

  // if the node type is message
  if (msgType?.includes(taskName)) {
    await replyMessage({
      uid,
      k,
      chatbotFromMysq,
      toName,
      senderNumber,
      sendMetaMsg,
      chatId,
      nodes,
      edges,
      incomingMsg,
    });
  }

  // if the node type is addon
  if (addonType.includes(taskName)) {
    await completeAddon({
      uid,
      k,
      chatbotFromMysq,
      toName,
      senderNumber,
      sendMetaMsg,
      chatId,
      nodes,
      edges,
      incomingMsg,
      destributeTaskFlow,
    });
  }

  // if the node type is tools
  if (toolsType?.includes(taskName)) {
    await completeTools({
      uid,
      k,
      chatbotFromMysq,
      toName,
      senderNumber,
      sendMetaMsg,
      chatId,
      nodes,
      edges,
      flow,
    });
  }
}

function returnAfterAddingVariable(msgContent, response) {
  let returnObj;
  if (msgContent.type == "text") {
    returnObj = {
      type: "text",
      text: {
        preview_url: true,
        body: replacePlaceholders(msgContent?.text?.body, response),
      },
    };
  } else if (msgContent.type == "video") {
    returnObj = {
      type: "video",
      video: {
        link: replacePlaceholders(msgContent?.video?.link, response),
        caption: replacePlaceholders(msgContent?.video?.caption, response),
      },
    };
  } else if (
    msgContent.type == "interactive" &&
    msgContent?.interactive?.type == "list"
  ) {
    returnObj = {
      type: "interactive",
      interactive: {
        type: "list",
        header: {
          type: "text",
          text: replacePlaceholders(
            msgContent.interactive.header.text,
            response
          ),
        },
        body: {
          text: replacePlaceholders(msgContent.interactive.body.text, response),
        },
        footer: {
          text: replacePlaceholders(
            msgContent.interactive.footer.text,
            response
          ),
        },
        action: msgContent.interactive.action,
      },
    };
  } else if (msgContent.type == "image") {
    returnObj = {
      type: "image",
      image: {
        link: replacePlaceholders(msgContent.image.link, response),
        caption: replacePlaceholders(msgContent.image.caption, response),
      },
    };
  } else if (msgContent.type == "document") {
    returnObj = {
      type: "document",
      document: {
        link: replacePlaceholders(msgContent.document.link, response),
        caption: replacePlaceholders(msgContent.document.caption, response),
      },
    };
  } else if (
    msgContent.type == "interactive" &&
    msgContent.interactive.type == "button"
  ) {
    returnObj = {
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: replacePlaceholders(msgContent.interactive.body.text, response),
        },
        action: msgContent.interactive.action,
      },
    };
  } else if (msgContent.type == "audio") {
    returnObj = {
      type: "audio",
      audio: {
        link: replacePlaceholders(msgContent.audio.link, response),
      },
    };
  }
  return returnObj;
}

function replacePlaceholders(template, data) {
  console.log({ templateeee: template, dataaaa: data });

  return template.replace(/{{{([^}]+)}}}/g, (match, key) => {
    // Remove any whitespace and parse the key
    key = key.trim();

    // Handle array indexing
    const arrayMatch = key.match(/^\[(\d+)]\.(.+)$/);
    if (arrayMatch) {
      const index = parseInt(arrayMatch[1], 10);
      const property = arrayMatch[2];

      if (Array.isArray(data) && index >= 0 && index < data.length) {
        let value = data[index];
        // Split the property string for nested properties
        const nestedKeys = property.split(".");
        for (const k of nestedKeys) {
          if (value && Object.prototype.hasOwnProperty.call(value, k)) {
            value = value[k];
          } else {
            return "NA";
          }
        }
        return value !== undefined ? value : "NA";
      } else {
        return "NA";
      }
    }

    // Handle object properties
    const keys = key.split("."); // Support for nested keys
    let value = data;

    for (const k of keys) {
      if (value && Object.prototype.hasOwnProperty.call(value, k)) {
        value = value[k];
      } else {
        return "NA"; // Return 'NA' if key is not found in the object
      }
    }

    return value !== undefined ? value : "NA"; // Return 'NA' if value is undefined
  });
}

module.exports = { destributeTaskFlow };
