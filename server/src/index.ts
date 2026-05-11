import express from 'express';
import cors from 'cors';
import fplRoutes from './routes/fpl.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.use('/api', fplRoutes);

app.listen(PORT, () => {
  console.log(`FPL Lens API running on http://localhost:${PORT}`);
});
