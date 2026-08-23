const express = require("express");

const app = express();

app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

/*
 * Grupos onde o BETA BOT está autorizado a funcionar.
 *
 * Também podes colocar os JIDs na variável de ambiente:
 *
 * GROUP_JIDS=
 * 120363430626519695@g.us,120363428797292558@g.us
 *
 * Se a variável não existir, estes dois grupos serão usados.
 */
const GROUP_JIDS = (
  process.env.GROUP_JIDS ||
  "120363430626519695@g.us,120363428797292558@g.us"
)
  .split(",")
  .map((jid) => jid.trim())
  .filter(Boolean);

if (!N8N_WEBHOOK_URL) {
  console.warn("⚠️ N8N_WEBHOOK_URL não está configurada.");
}

console.log("👥 Grupos autorizados:", GROUP_JIDS);

/*
 * Extrai o texto de diferentes tipos de mensagem
 * enviados pela Evolution API.
 */
function getMessageText(data) {
  const message = data?.data?.message;

  if (!message) {
    return "";
  }

  if (typeof message.conversation === "string") {
    return message.conversation;
  }

  if (message.extendedTextMessage?.text) {
    return message.extendedTextMessage.text;
  }

  if (message.imageMessage?.caption) {
    return message.imageMessage.caption;
  }

  if (message.videoMessage?.caption) {
    return message.videoMessage.caption;
  }

  return "";
}

/*
 * Verifica se a mensagem chama explicitamente o BETA BOT.
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
  const normalized = text.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return /^bot(?:\s|[,:;.!?]|$)/i.test(normalized);
}

/*
 * Obtém o JID do grupo dependendo do tipo de evento.
 *
 * messages.upsert:
 * data.key.remoteJid
 *
 * group-participants.update:
 * data.id
 */
function getGroupJid(payload) {
  const event = payload?.event;

  if (event === "messages.upsert") {
    return payload?.data?.key?.remoteJid || "";
  }

  if (event === "group-participants.update") {
    return payload?.data?.id || "";
  }

  return "";
}

/*
 * Health check.
 */
app.get("/", (req, res) => {
  res.status(200).json({
    status: "online",
    service: "BETA Bot Filter",
    version: "2.0.0",
    groups: GROUP_JIDS
  });
});

/*
 * Endpoint que recebe os eventos da Evolution API.
 */
app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;

    const event = payload?.event;
    const instance = payload?.instance;

    const key = payload?.data?.key;

    const remoteJid = getGroupJid(payload);

    const fromMe = key?.fromMe === true;

    const messageText = getMessageText(payload);

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📩 Evento recebido:", event);
    console.log("🤖 Instância:", instance);
    console.log("👥 Grupo:", remoteJid);
    console.log("🤖 fromMe:", fromMe);

    if (messageText) {
      console.log("💬 Mensagem:", messageText);
    }

    /*
     * 1. Aceitamos somente os eventos necessários.
     *
     * IMPORTANTE:
     * A Evolution está enviando:
     *
     * messages.upsert
     *
     * group-participants.update
     */
    const supportedEvents = [
      "messages.upsert",
      "group-participants.update"
    ];

    if (!supportedEvents.includes(event)) {
      console.log("⛔ Evento ignorado:", event);

      return res.status(200).json({
        accepted: false,
        reason: "event_not_supported"
      });
    }

    /*
     * 2. Ignora mensagens enviadas pela própria conta
     * da Evolution API.
     *
     * Essa verificação é aplicada principalmente
     * aos eventos messages.upsert.
     */
    if (event === "messages.upsert" && fromMe) {
      console.log("⛔ Mensagem enviada pelo próprio bot.");

      return res.status(200).json({
        accepted: false,
        reason: "message_from_bot"
      });
    }

    /*
     * 3. Verifica se o evento pertence a um dos grupos
     * autorizados.
     */
    if (!GROUP_JIDS.includes(remoteJid)) {
      console.log("⛔ Mensagem/evento de outro grupo:", remoteJid);

      return res.status(200).json({
        accepted: false,
        reason: "wrong_group",
        group: remoteJid
      });
    }

    /*
     * 4. TRATAMENTO DE MENSAGENS
     *
     * Somente mensagens que começam com "Bot"
     * continuam para o n8n.
     */
    if (event === "messages.upsert") {
      if (!isBotCommand(messageText)) {
        console.log("⛔ Mensagem não destinada ao BETA BOT.");

        return res.status(200).json({
          accepted: false,
          reason: "not_bot_command"
        });
      }

      console.log("✅ COMANDO DO BETA BOT APROVADO.");
    }

    /*
     * 5. TRATAMENTO DE ENTRADA DE MEMBROS
     *
     * A Evolution envia:
     *
     * event:
     * group-participants.update
     *
     * data.action:
     * add
     */
    if (event === "group-participants.update") {
      const action = payload?.data?.action;

      console.log("👤 Ação de participante:", action);

      /*
       * Só encaminhamos entradas de novos membros.
       */
      if (action !== "add") {
        console.log("⛔ Evento de participante ignorado:", action);

        return res.status(200).json({
          accepted: false,
          reason: "participant_action_not_supported",
          action
        });
      }

      console.log("🎉 NOVO MEMBRO DETECTADO!");
      console.log(
        "👤 Participantes:",
        JSON.stringify(payload?.data?.participants || [])
      );
    }

    /*
     * 6. Verifica se o endereço do n8n existe.
     */
    if (!N8N_WEBHOOK_URL) {
      console.error("❌ N8N_WEBHOOK_URL não configurada.");

      return res.status(500).json({
        accepted: false,
        reason: "n8n_url_not_configured"
      });
    }

    /*
     * 7. Encaminha o payload original para o n8n.
     *
     * Isso é importante porque o n8n receberá:
     *
     * messages.upsert
     *
     * OU
     *
     * group-participants.update
     *
     * exatamente como a Evolution enviou.
     */
    console.log("📤 Encaminhando evento para o n8n...");

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

    if (responseText) {
      console.log("📨 Resposta do n8n:", responseText);
    }

    /*
     * 8. Se o n8n retornar erro.
     */
    if (!n8nResponse.ok) {
      console.error(
        "❌ Erro ao encaminhar para n8n:",
        responseText
      );

      return res.status(502).json({
        accepted: true,
        forwarded: false,
        n8nStatus: n8nResponse.status
      });
    }

    /*
     * 9. Sucesso.
     */
    console.log("✅ EVENTO ENCAMINHADO PARA O N8N COM SUCESSO.");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    return res.status(200).json({
      accepted: true,
      forwarded: true,
      event,
      group: remoteJid
    });

  } catch (error) {
    console.error("🔥 Erro no filtro:", error);

    return res.status(500).json({
      accepted: false,
      error: "internal_server_error"
    });
  }
});

/*
 * Inicia o servidor.
 */
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `🚀 BETA Bot Filter rodando na porta ${PORT}`
  );

  console.log(
    "📡 Endpoint:",
    "/webhook"
  );

  console.log(
    "👥 Grupos autorizados:",
    GROUP_JIDS.join(" | ")
  );
});
