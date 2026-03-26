// src/index.js
// Входна точка на сървъра
// Инициализира Express, Socket.io, cron jobs и всички routes

require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

const logger         = require('./services/logger');
const sensorPolling  = require('./jobs/sensorPolling');
const usersRouter    = require('./routes/users');
const alertsRouter   = require('./routes/alerts');

const app    = express();
const server = http.createServer(app);

// Socket.io с CORS за frontend домейна
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

// Достъп до io от routes (за изпращане на real-time events)
app.set('io', io);

// ============================================================
// Middleware
// ============================================================

// Security headers
app.use(helmet());

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// JSON body parsing
app.use(express.json({ limit: '10kb' }));

// Rate limiting - предотвратява злоупотреба
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минути
  max:      100,              // максимум 100 заявки на IP
  message:  { error: 'Твърде много заявки. Опитайте след малко.' },
  standardHeaders: true,
  legacyHeaders:   false,
});
app.use('/api/', limiter);

// По-строг лимит за регистрация (предотвратява спам)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 час
  max:      10,
  message:  { error: 'Твърде много регистрации от този IP.' },
});
app.use('/api/users/register', registerLimiter);

// ============================================================
// Routes
// ============================================================

app.use('/api/users',  usersRouter);
app.use('/api/alerts', alertsRouter);

// Health check endpoint (за Railway/Render мониторинг)
app.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    uptime:    Math.floor(process.uptime()),
    env:       process.env.NODE_ENV,
  });
});

// VAPID публичен ключ за frontend
// Frontend-ът го нужда за да се абонира за push известия
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route не е намерен: ${req.method} ${req.path}` });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error(`Необработена грешка: ${err.message}`);
  res.status(500).json({ error: 'Вътрешна сървърна грешка' });
});

// ============================================================
// Socket.io връзки
// ============================================================

io.on('connection', (socket) => {
  logger.debug(`Socket свързан: ${socket.id}`);

  // Клиентът изпраща локацията си за real-time алерти
  socket.on('user:location', async ({ userId, lat, lng }) => {
    // Добави socket в стая за региона (за таргетирани broadcasts)
    const region = `region:${Math.floor(lat * 2)}:${Math.floor(lng * 2)}`;
    socket.join(region);
    socket.data.userId = userId;
    socket.data.lat    = lat;
    socket.data.lng    = lng;
  });

  socket.on('disconnect', () => {
    logger.debug(`Socket disconnected: ${socket.id}`);
  });
});

// ============================================================
// Стартиране
// ============================================================

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  logger.info(`🚀 ResQ Village Backend стартиран на порт ${PORT}`);
  logger.info(`🌍 Среда: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`📡 Socket.io активен`);

  // Стартирай cron jobs СЛЕД като сървърът е готов
  sensorPolling.startAllJobs(io);
});

// Graceful shutdown при спиране
process.on('SIGTERM', () => {
  logger.info('SIGTERM получен - затваряне...');
  server.close(() => {
    logger.info('Сървърът е спрян');
    process.exit(0);
  });
});

module.exports = { app, server };
