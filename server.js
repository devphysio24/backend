// File: server.js

'use strict';

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { monitorEventLoopDelay } = require('perf_hooks');
const asyncHandler = require('./middleware/asyncHandler');
const { generalLimiter } = require('./middleware/rateLimiter');
const { securityHeaders, additionalSecurityHeaders } = require('./middleware/securityHeaders');
const { performanceMonitor } = require('./middleware/performance');
const { requestIdMiddleware } = require('./middleware/requestId');
const logger = require('./utils/logger');
const { validateEnvironment, getSafeConfig } = require('./utils/envValidator');

// ---------- ENV LOADING ----------
const loaded = dotenv.config();
if (loaded.error) {
  dotenv.config({ path: './env.supabase' });
}

try {
  validateEnvironment();
  const config = getSafeConfig();
  logger.info('Configuration loaded successfully', config);
} catch (error) {
  logger.error('Failed to load configuration', { error: error.message });
  process.exit(1);
}

// Load Supabase config only after env is ready
const { db } = require('./config/supabase.local'); // keep import for side-effects (DB init)

const app = express();

// Behind proxies (Render/NGINX) to get real client IPs for rate limiting, logs, etc.
app.set('trust proxy', 1);

// ---------- SECURITY FIRST ----------
app.use(securityHeaders());             // why: security headers should come first
app.use(additionalSecurityHeaders);

// ---------- CORS BEFORE BODY/COMPRESSION ----------
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  // Allow all .onrender.com domains
  const isAllowedOrigin = !origin || 
    origin.includes('localhost') || 
    origin.includes('127.0.0.1') ||
    /\.onrender\.com$/.test(origin);
  
  if (isAllowedOrigin && origin) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (isAllowedOrigin) {
    res.header('Access-Control-Allow-Origin', '*');
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Origin, Accept, X-CSRF-Token');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');
  res.status(200).end();
});

app.use(
  cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://sociosystem.onrender.com',
      /\.onrender\.com$/,
    ];
    
    // Check if origin matches any allowed pattern
    const isAllowed = allowedOrigins.some(allowed => {
      if (typeof allowed === 'string') {
        return origin === allowed;
      } else if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return false;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn('⚠️ CORS: Blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Origin', 'Accept', 'X-CSRF-Token'],
  optionsSuccessStatus: 200,
  preflightContinue: false,
  maxAge: 86400,
  })
);

// ---------- COMPRESSION ----------
app.use(
  compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    },
  })
);

// ---------- PARSERS ----------
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---------- REQUEST ID + PERF ----------
app.use(requestIdMiddleware);
app.use(performanceMonitor);

// ---------- REQUEST TIMEOUT ----------
app.use((req, res, next) => {
  // why: avoid hung sockets; prefer server-level enforcement
  const REQUEST_TIMEOUT_MS = 30_000;
  req.setTimeout(REQUEST_TIMEOUT_MS);
  res.setTimeout(REQUEST_TIMEOUT_MS, () => {
    if (!res.headersSent) {
      logger.warn('Response timeout', { url: req.url, method: req.method });
      res.status(408).json({
        error: 'Request timeout',
        message: 'The request took too long to process',
        requestId: req.requestId,
      });
    }
  });
  next();
});

// ---------- RATE LIMITING ----------
// Global limiter (moderate)
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    message: { error: 'Too many requests from this IP' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS',
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        url: req.url,
        method: req.method,
        limit: 5000,
        window: '900s',
        requestId: req.requestId,
      });
      res.status(429).json({ error: 'Too many requests from this IP', retryAfter: 900 });
    },
  })
);

// Optional per-route stricter limiters (avoid double stacking with your custom generalLimiter)
const perRouteLimiter = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS',
    handler: (req, res) => {
      logger.warn('Per-route rate limit exceeded', {
        ip: req.ip,
        url: req.url,
        method: req.method,
        limit: max,
        window: `${windowMs / 1000}s`,
        requestId: req.requestId,
      });
      res.status(429).json({ error: message, retryAfter: Math.ceil(windowMs / 1000) });
    },
  });

// If you want the custom global limiter, swap the next line; avoid double-limiting.
// app.use(generalLimiter);

// Per-route stricter rules
app.use('/api/work-readiness-assignments', perRouteLimiter(60 * 1000, 200, 'Too many assignment requests'));
app.use('/api/kpi', perRouteLimiter(60 * 1000, 100, 'Too many KPI requests'));

// ---------- HEALTH ----------
app.get('/health', (req, res) => {
  const mem = process.memoryUsage();
  res.status(200).json({
    status: 'ok', 
    message: 'KPI API is running',
    uptime: Math.round(process.uptime()),
    timestamp: Date.now(),
    pid: process.pid,
    memory: {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      externalMB: Math.round(mem.external / 1024 / 1024),
      rssMB: Math.round(mem.rss / 1024 / 1024),
    },
    requestId: req.requestId,
  });
});

// ---------- CSRF TOKEN ----------
app.get('/api/csrf-token', (req, res) => {
  // Simple CSRF token generation for frontend
  const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  res.json({ csrfToken: token });
});

// ---------- DEV/ADMIN: CLEANUP ----------
app.post('/cleanup', (req, res) => {
  const allowCleanup =
    process.env.NODE_ENV !== 'production' ||
    (process.env.CLEANUP_TOKEN && req.headers['x-cleanup-token'] === process.env.CLEANUP_TOKEN);

  if (!allowCleanup) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const before = process.memoryUsage();
  if (global.gc) {
    global.gc();
    const after = process.memoryUsage();
    return res.json({
      success: true,
      message: 'Memory cleanup completed',
      memoryBefore: {
        heapUsedMB: Math.round(before.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(before.heapTotal / 1024 / 1024),
      },
      memoryAfter: {
        heapUsedMB: Math.round(after.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(after.heapTotal / 1024 / 1024),
      },
      freedMB: Math.round((before.heapUsed - after.heapUsed) / 1024 / 1024),
    });
  }
  return res.json({
    success: false,
    message: 'GC not available. Start Node with --expose-gc',
  });
});

// ---------- ROUTES ----------
logger.info('Loading API routes...');
const goalKpiRoutes = require('./routes/goalKpi');
const workReadinessAssignmentRoutes = require('./routes/workReadinessAssignments');
const multiTeamAnalyticsRoutes = require('./routes/multiTeamAnalytics');
const caseManagerAnalyticsRoutes = require('./routes/caseManagerAnalytics');
const shiftRoutes = require('./routes/shifts');

const caseRoutes = require('./routes/cases');
const appointmentRoutes = require('./routes/appointments');
const clinicianRoutes = require('./routes/clinicians');
const teamLeaderRoutes = require('./routes/teamLeader');
const authRoutes = require('./routes/auth.supabase');
// Use Supabase admin routes
const adminRoutes = require('./routes/admin.supabase');

app.use('/api/goal-kpi', goalKpiRoutes);
app.use('/api/work-readiness-assignments', workReadinessAssignmentRoutes);
app.use('/api/multi-team-analytics', multiTeamAnalyticsRoutes);
app.use('/api/analytics/case-manager', caseManagerAnalyticsRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/clinicians', clinicianRoutes);
app.use('/api/team-leaders', teamLeaderRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

logger.info('API routes mounted', {
  routes: [
    '/api/goal-kpi',
    '/api/work-readiness-assignments',
    '/api/multi-team-analytics',
    '/api/analytics/case-manager',
    '/api/shifts',
    '/api/cases',
    '/api/appointments',
    '/api/clinicians',
    '/api/team-leaders',
    '/api/auth',
    '/api/admin',
  ],
});

// Debug endpoint (kept as-is)
app.get(
  '/api/test-trends',
  asyncHandler(async (req, res) => {
    const { getTeamLeaderPerformanceTrends } = require('./controllers/multiTeamAnalyticsController');
    await getTeamLeaderPerformanceTrends(req, res);
  })
);

// ---------- ERROR HANDLER ----------
app.use((err, req, res, next) => {
  logger.logError(err, { 
    path: req.path, 
    method: req.method, 
    userId: req.user?.id,
    requestId: req.requestId,
  });
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    requestId: req.requestId,
  });
});

// ---------- MEMORY MONITOR (single interval) ----------
let memTick = null;
function startMemoryMonitoring() {
  if (memTick) return; // guard: single interval only
  const LOG_MB = 400;   // log earlier para may breadcrumbs
  const GC_MB  = 800;   // same as your current
  const EXIT_MB = 1200; // same as your current

  memTick = setInterval(() => {
    const u = process.memoryUsage();
    const heapMB = Math.round(u.heapUsed / 1024 / 1024);

    if (heapMB > LOG_MB) {
      logger.info('MemUsage', {
        heapUsedMB: heapMB,
        heapTotalMB: Math.round(u.heapTotal / 1024 / 1024),
        rssMB: Math.round(u.rss / 1024 / 1024),
      });
    }
    if (heapMB > GC_MB && global.gc) {
      logger.warn('High mem; triggering GC', { heapMB });
      global.gc();
    }
    if (heapMB > EXIT_MB) {
      logger.error('Critical mem; exiting', { heapMB });
      process.exit(1);
    }
  }, 60_000); // 1 min for finer breadcrumbs
}

function stopMemoryMonitoring() {
  if (memTick) clearInterval(memTick);
  memTick = null;
}

// ---------- JOBS ----------
const jobRunner = require('./services/ScheduledJobRunner');
const notificationScheduler = require('./services/notificationScheduler');

// ---------- START SERVER ----------
const PORT = process.env.PORT || 5001;

// --- Server timeouts: prevent weird stalls under load ---
const REQUEST_TIMEOUT_MS = 30_000;      // already used
const HEADERS_TIMEOUT_MS = 35_000;      // headers must finish shortly after
const KEEP_ALIVE_TIMEOUT_MS = 10_000;   // free up sockets faster

const server = app.listen(PORT, () => {
  logger.info('Server started', {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  });
  
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_SCHEDULED_JOBS === 'true') {
    logger.info('Starting scheduled jobs...');
    jobRunner.start();
    notificationScheduler.start();
    logger.info('Scheduled jobs started');
  } else {
    logger.info('Scheduled jobs disabled', { hint: 'Set ENABLE_SCHEDULED_JOBS=true to enable' });
  }

  startMemoryMonitoring();
});

// Set server timeouts
server.headersTimeout = HEADERS_TIMEOUT_MS;
server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
server.requestTimeout = REQUEST_TIMEOUT_MS;

// --- Event loop lag monitor (detect CPU blocking / sync code) ---
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
setInterval(() => {
  const p95 = Math.round(loop.percentile(95) / 1e6); // ms
  if (p95 > 200) {
    logger.warn('High event-loop lag', { p95_ms: p95 });
  }
  loop.reset();
}, 15_000).unref();

// --- Exit/Crash visibility (pinpoint bakit nag-e-exit) ---
process.on('beforeExit', (code) => {
  logger.error('beforeExit', { code });
});
process.on('exit', (code) => {
  logger.error('exit', { code });
});
process.on('SIGTERM', () => {
  logger.warn('SIGTERM received'); // your shutdown() already handles
});
process.on('SIGINT', () => {
  logger.warn('SIGINT received');
});

// ---------- GRACEFUL SHUTDOWN ----------
async function shutdown(signal) {
  try {
    logger.info(`${signal} received; shutting down gracefully`);
    stopMemoryMonitoring();
    // Stop schedulers if they have stop()
    if (jobRunner?.stop) jobRunner.stop();
    if (notificationScheduler?.stop) notificationScheduler.stop();

    // Close HTTP server
    server.close((err) => {
      if (err) {
        logger.error('Error during server close', { error: err.message });
        process.exit(1);
      }
      logger.info('HTTP server closed');
  process.exit(0);
});

    // Safety timer
    setTimeout(() => {
      logger.error('Force exiting after timeout');
      process.exit(1);
    }, 10_000).unref();
  } catch (e) {
    logger.error('Shutdown error', { error: e.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ---------- CRASH HANDLERS (single set) ----------
// Replace your crash handlers with this stricter logging (single set only)
process.removeAllListeners('uncaughtException');
process.removeAllListeners('unhandledRejection');

process.on('uncaughtException', (error) => {
  logger.error('UncaughtException', { stack: error.stack, message: error.message });
  setTimeout(() => process.exit(1), 1000); // keep if you want auto-restart
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('UnhandledRejection', {
    reason: reason?.stack || String(reason),
  });
  setTimeout(() => process.exit(1), 1000);
});
