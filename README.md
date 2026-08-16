# Betalandia Filter

Middleware do Betalandia Bot.

## Arquitetura

Evolution API
↓
Betalandia Filter
↓
n8n
↓
Google Gemini
↓
Evolution API

## Função

O filtro recebe eventos da Evolution API e verifica:

- Evento `messages.upsert`
- Mensagem não enviada pelo próprio bot
- Mensagem pertence ao grupo Betalandia
- Mensagem começa com `bot`

Somente mensagens aprovadas são encaminhadas para o n8n.

## Variáveis de ambiente

### N8N_WEBHOOK_URL

URL de produção do webhook do n8n.

### BETALANDIA_GROUP_JID

JID do grupo Betalandia.

Valor padrão:

120363430626519695@g.us

### PORT

A Railway fornece automaticamente essa variável.

## Executar localmente

```bash
npm install
npm start
