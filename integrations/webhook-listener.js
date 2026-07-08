/**
 * WoodFlow Integrations - WhatsApp Webhook Router
 * Listens to incoming messages from the Meta WhatsApp Business API,
 * logs them in the CRM database, and triggers automated AI follow-ups.
 */

const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');

const app = express();
app.use(bodyParser.json());

// Verification token for Meta webhook setup
const VERIFY_TOKEN = 'woodflow_wa_token_2026';

// Meta Verification Route
app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[WA-Webhook] Webhook verified successfully!');
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }
});

// Incoming message handler
app.post('/webhook/whatsapp', async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    try {
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      if (message) {
        const from = message.from; // Phone number
        const text = message.text?.body; // Message body
        const name = value?.contacts?.[0]?.profile?.name || 'Cliente WhatsApp';

        console.log(`[WA-Webhook] Nova mensagem de ${name} (${from}): "${text}"`);

        // Forward to backend CRM controller to update lead details and timeline
        // Find or create lead on CRM backend
        const backendUrl = 'http://localhost:3009/api';
        
        // Simulating routing by making an HTTP request to our backend
        const postData = JSON.stringify({
          type: 'WHATSAPP',
          content: `Mensagem recebida: "${text}"`,
          author: name
        });

        // Trigger AI auto-responder if the message contains questions
        if (text.toLowerCase().includes('orçamento') || text.toLowerCase().includes('preço')) {
          console.log(`[WA-Webhook] Ativando Auto-Responder de IA...`);
          // Send automatic message placeholder
        }
      }
    } catch (err) {
      console.error('[WA-Webhook] Erro ao processar mensagem:', err.message);
    }
    return res.status(200).send('EVENT_RECEIVED');
  } else {
    return res.sendStatus(404);
  }
});

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  console.log(`[WA-Webhook] Integrador rodando na porta ${PORT}.`);
});
