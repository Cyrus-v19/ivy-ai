export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram Bot is active');
  }

  const { message } = req.body;
  if (!message || !message.text) return res.status(200).json({ status: 'no message' });

  const chatId = message.chat.id;
  const userText = message.text;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + openrouterKey
      },
      body: JSON.stringify({
        model: 'openrouter/free',
        messages: [{ role: 'user', content: userText }],
        max_tokens: 1000
      })
    });

    const data = await response.json();
    const replyText = data.choices?.[0]?.message?.content || "Sorry, I couldn't process that.";

    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: replyText })
    });

  } catch (err) {
    console.error(err);
  }

  return res.status(200).json({ status: 'success' });
}
