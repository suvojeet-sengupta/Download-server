import { Router } from 'express';
import { config } from '../config/env';

export const authRouter = Router();

/** Password probe for the UI login screen. */
authRouter.post('/api/verify', (req, res) => {
  const { password } = req.body as { password?: string };
  if (password === config.password) {
    res.json({ success: true });
    return;
  }
  res.status(401).json({ error: 'Invalid password' });
});
