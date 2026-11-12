import 'dotenv/config';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 3001;
const { httpServer } = createApp();

httpServer.listen(PORT, () => {
  console.log(`DiscordOnline server listening on http://localhost:${PORT}`);
});
