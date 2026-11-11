"use strict";

const express = require("express");

const app = express();

app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

/*
 * CONFIGURAÇÃO DOS GRUPOS
 *
 * No Railway, configura GROUP_JIDS com os IDs separados
 * por vírgulas, sem espaços internos nos IDs.
 *
 * Exemplo:
 * GROUP_JIDS=120363430626519695@g.us,120363429708834512@g.us
 */

function normalizeJid(value) {
  return typeof value === "string" ? value.trim() : "";
}

const configuredGroups = process.env.GROUP_JIDS;

const GROUP_JIDS = (
  configuredGroups !== undefined && configuredGroups.trim() !== ""
    ? configuredGroups
    : "120363430626519695@g.us,120363429708834512@g.us"
)
  .split(",")
  .map(normalizeJid)
  .filter(Boolean);

const AUTHORIZED_GROUPS = new Set(GROUP_JIDS);

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("🚀 BETA BOT FILTER v2.1");
console.log("👥 Grupos autorizados:", [...AUTHORIZED_GROUPS]);

if (!N8N_WEBHOOK_URL) {
  console.warn("⚠️ N8N_WEBHOOK_URL não está configurada.");
}

/*
 * EXTRAÇÃO DO TEXTO DA MENSAGEM
 */

function getMessageText(payload) {
  const message = payload?.data?.message;

  if (!message) {
    return "";
  }

  if (typeof message.conversation === "string") {
    return message.conversation;
  }

  if (typeof message.extendedTextMessage?.text === "string") {
    return message.extendedTextMessage.text;
  }

  if (typeof message.imageMessage?.caption === "string") {
    return message.imageMessage.caption;
  }

  if (typeof message.videoMessage?.caption === "string") {
    return message.videoMessage.caption;
  }

  if (typeof message.documentMessage?.caption === "string") {
    return message.documentMessage.caption;
  }

  return "";
}

/*
 * RECONHECIMENTO DE COMANDOS
 *
 * Exemplos:
 * Bot
 * Bot, olá
 * Bot: ajuda
 * Bot oq é água?
 */

function isBotCommand(text) {
  return /^bot(?:\s|[,:;.!?]|$)/i.test(text.trim());
}

/*
 * IDENTIFICAÇÃO DO GRUPO
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
    return normalizeJid(payload?.data?.key?.remoteJid);
  }

  if (event === "group-participants.update") {
    return normalizeJid(payload?.data?.id);
  }

  return "";
}

/*
 * RESPOSTA DE DIAGNÓSTICO
 */

app.get("/", (req, res) => {
  res.status(200).json({
    status: "online",
    service: "BETA Bot Filter",
    version: "2.1.0",
    authorizedGroups: [...AUTHORIZED_GROUPS],
    webhookConfigured: Boolean(N8N_WEBHOOK_URL)
  });
});

/*
 * ENDPOINT PRINCIPAL
 */

app.post("/webhook", async (req, res) => {
  const payload = req.body || {};

  try {
    const event = payload.event || "";
    const instance = payload.instance || "";

    const key = payload?.data?.key || {};
    const remoteJid = getGroupJid(payload);
    const fromMe = key.fromMe === true;
    const messageText = getMessageText(payload);

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📩 Evento recebido:", event);
    console.log("🤖 Instância:", instance);
    console.log("👥 ID recebido:", JSON.stringify(remoteJid));
    console.log("👥 IDs autorizados:", JSON.stringify([...AUTHORIZED_GROUPS]));
    console.log(
      "🔍 Correspondência:",
      AUTHORIZED_GROUPS.has(remoteJid)
    );

    if (messageText) {
      console.log("💬 Mensagem:", messageText);
    }

    console.log("🤖 fromMe:", fromMe);

    /*
     * 1. ACEITAR APENAS OS EVENTOS NECESSÁRIOS
     */

    const supportedEvents = [
      "messages.upsert",
      "group-participants.update"
    ];

    if (!supportedEvents.includes(event)) {
      console.log("⛔ Evento não suportado:", event);

      return res.status(200).json({
        accepted: false,
        reason: "event_not_supported"
      });
    }

    /*
     * 2. IGNORAR MENSAGENS DA PRÓPRIA CONTA
     */

    if (event === "messages.upsert" && fromMe) {
      console.log("⛔ Mensagem enviada pela própria conta.");

      return res.status(200).json({
        accepted: false,
        reason: "message_from_bot"
      });
    }

    /*
     * 3. VERIFICAR SE É UMA MENSAGEM DE GRUPO
     */

    if (!remoteJid.endsWith("@g.us")) {
      console.log("⛔ O evento não contém um JID de grupo válido.");

      return res.status(200).json({
        accepted: false,
        reason: "not_a_group",
        group: remoteJid
      });
    }

    /*
     * 4. VERIFICAR AUTORIZAÇÃO DO GRUPO
     */

    if (!AUTHORIZED_GROUPS.has(remoteJid)) {
      console.log("⛔ Grupo não autorizado:", remoteJid);

      return res.status(200).json({
        accepted: false,
        reason: "wrong_group",
        group: remoteJid
      });
    }

    console.log("✅ Grupo autorizado:", remoteJid);

    /*
     * 5. PROCESSAR MENSAGENS
     */

    if (event === "messages.upsert") {
      if (!messageText) {
        console.log("⛔ Mensagem sem texto reconhecido.");

        return res.status(200).json({
          accepted: false,
          reason: "empty_or_unsupported_message"
        });
      }

      if (!isBotCommand(messageText)) {
        console.log("⛔ Mensagem não começa com Bot.");

        return res.status(200).json({
          accepted: false,
          reason: "not_bot_command"
        });
      }

      console.log("✅ COMANDO DO BETA BOT APROVADO.");
    }

    /*
     * 6. PROCESSAR ENTRADAS DE NOVOS MEMBROS
     */

    if (event === "group-participants.update") {
      const action = payload?.data?.action;

      console.log("👤 Ação de participante:", action);

      if (action !== "add") {
        console.log("⛔ Ação de participante ignorada.");

        return res.status(200).json({
          accepted: false,
          reason: "participant_action_not_supported",
          action
        });
      }

      console.log("🎉 Novo membro detectado!");

      console.log(
        "👤 Participantes:",
        JSON.stringify(payload?.data?.participants || [])
      );
    }

    /*
     * 7. VALIDAR O WEBHOOK DO N8N
     */

    if (!N8N_WEBHOOK_URL) {
      console.error("❌ N8N_WEBHOOK_URL não configurada.");

      return res.status(500).json({
        accepted: false,
        reason: "n8n_url_not_configured"
      });
    }

    /*
     * 8. ENCAMINHAR PARA O N8N
     */

    console.log("📤 Encaminhando evento para o n8n...");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let n8nResponse;

    try {
      n8nResponse = await fetch(N8N_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseText = await n8nResponse.text();

    console.log("📤 Estado HTTP do n8n:", n8nResponse.status);

    if (responseText) {
      console.log("📨 Resposta do n8n:", responseText);
    }

    if (!n8nResponse.ok) {
      console.error("❌ O n8n respondeu com erro.");

      return res.status(502).json({
        accepted: true,
        forwarded: false,
        n8nStatus: n8nResponse.status
      });
    }

    /*
     * 9. CONFIRMAR SUCESSO
     */

    console.log("✅ EVENTO ENCAMINHADO COM SUCESSO.");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    return res.status(200).json({
      accepted: true,
      forwarded: true,
      event,
      group: remoteJid
    });

  } catch (error) {
    console.error("🔥 Erro no Filter:", error.message);

    return res.status(500).json({
      accepted: false,
      reason: "internal_server_error"
    });
  }
});

/*
 * INICIAR SERVIDOR
 */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 BETA Bot Filter ativo na porta ${PORT}`);
  console.log("📡 Endpoint: /webhook");
  console.log("👥 Grupos autorizados:", [...AUTHORIZED_GROUPS]);
});
