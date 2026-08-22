const express = require("express");

const app = express();

app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

const BETALANDIA_GROUP_JIDS = (
  process.env.BETALANDIA_GROUP_JID ||
  "120363430626519695@g.us"
)
  .split(",")
  .map(jid => jid.trim())
  .filter(Boolean);

if (!N8N_WEBHOOK_URL) {
  console.warn("⚠️ N8N_WEBHOOK_URL não está configurada.");
}

/*
 * Extrai o texto de diferentes tipos de mensagem
 * enviados pela Evolution API.
 */
function getMessageText(data) {
  let message = data?.data?.message;

  if (!message) {
    return "";
  }

  // Desembrulha mensagens encapsuladas
  // pela Evolution API / WhatsApp
  if (message.ephemeralMessage?.message) {
    message = message.ephemeralMessage.message;
  }

  if (message.viewOnceMessage?.message) {
    message = message.viewOnceMessage.message;
  }

  if (message.viewOnceMessageV2?.message) {
    message = message.viewOnceMessageV2.message;
  }

  if (message.documentWithCaptionMessage?.message) {
    message = message.documentWithCaptionMessage.message;
  }

  // Mensagem de texto simples
  if (typeof message.conversation === "string") {
    return message.conversation;
  }

  // Texto expandido
  if (typeof message.extendedTextMessage?.text === "string") {
    return message.extendedTextMessage.text;
  }

  // Legenda de imagem
  if (typeof message.imageMessage?.caption === "string") {
    return message.imageMessage.caption;
  }

  // Legenda de vídeo
  if (typeof message.videoMessage?.caption === "string") {
    return message.videoMessage.caption;
  }

  // Legenda de documento
  if (typeof message.documentMessage?.caption === "string") {
    return message.documentMessage.caption;
  }

  return "";
}
/*
 * Verifica se a mensagem chama explicitamente o bot.
 *
 * Exemplos aceitos:
 *
 * Bot
 * bot
 * BOT
 * Bot, olá
 * Bot: ajuda
 * Bot oq é água?
 */
function isBotCommand(text) {
  const normalized = text
    .trim()
    .toLowerCase();

  if (!normalized) {
    return false;
  }

  return /^bot(?:\s|[,:;.!?]|$)/i.test(normalized);
}

/*
 * Health check.
 */
app.get("/", (req, res) => {
  res.status(200).json({
    status: "online",
    service: "Betalandia Filter",
    version: "1.0.0"
  });
});

/*
 * Endpoint que receberá os eventos da Evolution API.
 */
app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;

    const event = payload?.event;
    const instance = payload?.instance;
    const key = payload?.data?.key;

    const remoteJid = key?.remoteJid;
    const fromMe = key?.fromMe;

    const messageText = getMessageText(payload);
    
    console.log(
  "🧩 Tipo da mensagem:",
  Object.keys(payload?.data?.message || {})
);

    console.log("📩 Evento recebido:", event);
    console.log("👥 Grupo:", remoteJid);
    console.log("🤖 fromMe:", fromMe);
    console.log("💬 Mensagem:", messageText);

    /*
     * 1. Só aceitamos messages.upsert.
     */
    if (event !== "messages.upsert") {
      console.log("⛔ Evento ignorado:", event);

      return res.status(200).json({
        accepted: false,
        reason: "event_not_supported"
      });
    }

    /*
     * 2. Ignora mensagens enviadas pela própria conta
     * da Evolution API.
     */
    if (fromMe === true) {
      console.log("⛔ Mensagem enviada pelo próprio bot.");

      return res.status(200).json({
        accepted: false,
        reason: "message_from_bot"
      });
    }

    /*
     * 3. Só aceita mensagens do grupo Betalandia.
     */
    if (!BETALANDIA_GROUP_JIDS.includes(remoteJid)) {
  console.log("⛔ Mensagem de outro chat.");

  return res.status(200).json({
    accepted: false,
    reason: "wrong_group"
  });
}

    /*
     * 4. Só aceita mensagens que começam com "bot".
     */
    if (!isBotCommand(messageText)) {
      console.log("⛔ Mensagem não destinada ao bot.");

      return res.status(200).json({
        accepted: false,
        reason: "not_bot_command"
      });
    }

    /*
     * 5. Se chegou aqui, a mensagem passou pelo filtro.
     */
    console.log("✅ MENSAGEM APROVADA → encaminhando para n8n");

    if (!N8N_WEBHOOK_URL) {
      console.error("❌ N8N_WEBHOOK_URL não configurada.");

      return res.status(500).json({
        accepted: false,
        reason: "n8n_url_not_configured"
      });
    }

    /*
     * Encaminha o payload original para o n8n.
     *
     * Assim, o workflow existente continua recebendo
     * exatamente a estrutura que já conhece.
     */
    const n8nResponse = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const responseText = await n8nResponse.text();

    console.log(
      `📤 n8n respondeu: ${n8nResponse.status}`
    );

    if (!n8nResponse.ok) {
      console.error("❌ Erro ao encaminhar para n8n:", responseText);

      return res.status(502).json({
        accepted: true,
        forwarded: false,
        n8nStatus: n8nResponse.status
      });
    }

    return res.status(200).json({
      accepted: true,
      forwarded: true
    });

  } catch (error) {
    console.error("🔥 Erro no filtro:", error);

    return res.status(500).json({
      accepted: false,
      error: "internal_server_error"
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Betalandia Filter rodando na porta ${PORT}`);
});
