import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.LAB_PORT || 3001;

app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`\n========================================================`);
  console.log(`🛒 VIRTUAL POS & THERMAL PRINTER LAB READY`);
  console.log(`📍 Web URL: http://localhost:${PORT}`);
  console.log(`🔗 Connected To: ReviewEasy Production Engine (:3000)`);
  console.log(`========================================================\n`);
});
