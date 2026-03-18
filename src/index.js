const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────
app.use(cors({
  origin: '*', // Production'da kendi domain'inle sınırla
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
}));

app.use(express.json({ limit: '1mb' }));

// ─── API Key Auth (opsiyonel) ─────────────────────────────────
const API_KEY = process.env.API_KEY || null;

function authMiddleware(req, res, next) {
  if (!API_KEY) return next(); // API_KEY set edilmemişse geç
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ success: false, error: 'Yetkisiz istek.' });
  }
  next();
}

// ─── FCM Token Cache ─────────────────────────────────────────
// project_id → { token, expiresAt }
const tokenCache = new Map();

async function getFCMAccessToken(credentials) {
  const projectId = credentials.project_id;
  const cached = tokenCache.get(projectId);

  // Cache'de varsa ve 5 dakikadan fazla kaldıysa kullan
  if (cached && (cached.expiresAt - Date.now()) > 5 * 60 * 1000) {
    console.log(`[Cache] Token kullanıldı: ${projectId}`);
    return cached.token;
  }

  console.log(`[Auth] Yeni token alınıyor: ${projectId}`);

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const accessToken = tokenResponse.token;

  // 55 dakika cache'le (FCM token 60 dk geçerli)
  tokenCache.set(projectId, {
    token: accessToken,
    expiresAt: Date.now() + 55 * 60 * 1000,
  });

  return accessToken;
}

// ─── Push Send ────────────────────────────────────────────────
async function sendFCMPush({ credentials, notification, target, data }) {
  const accessToken = await getFCMAccessToken(credentials);
  const projectId = credentials.project_id;

  // Mesaj yapısını oluştur
  const message = {
    notification: {
      title: notification.title,
      body: notification.body,
      ...(notification.imageUrl && { image: notification.imageUrl }),
    },
    ...(data && { data }),
  };

  // Hedef: token mu topic mi
  if (target.type === 'token') {
    message.token = target.value;
  } else {
    // Topic prefix ile tenant izolasyonu
    message.topic = target.value;
  }

  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  const response = await fetch(fcmUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('[FCM Error]', JSON.stringify(result));
    throw new Error(result.error?.message || 'FCM isteği başarısız');
  }

  return result;
}

// ─── Routes ──────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'PushDesk Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Push gönder
app.post('/api/push/send', authMiddleware, async (req, res) => {
  const {
    project_id,
    client_email,
    private_key,
    notification,
    target,
    data,
  } = req.body;

  // Validasyon
  if (!project_id || !client_email || !private_key) {
    return res.status(400).json({
      success: false,
      error: 'project_id, client_email ve private_key zorunludur.',
    });
  }

  if (!notification?.title || !notification?.body) {
    return res.status(400).json({
      success: false,
      error: 'notification.title ve notification.body zorunludur.',
    });
  }

  if (!target?.type || !target?.value) {
    return res.status(400).json({
      success: false,
      error: 'target.type (token/topic) ve target.value zorunludur.',
    });
  }

  try {
    const result = await sendFCMPush({
      credentials: { project_id, client_email, private_key },
      notification,
      target,
      data,
    });

    console.log(`[Push] Başarılı → ${project_id} → ${target.value}`);

    return res.json({
      success: true,
      messageId: result.name,
      project: project_id,
      target: target.value,
    });

  } catch (err) {
    console.error(`[Push] Hata → ${project_id}:`, err.message);

    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Token doğrulama (test amaçlı)
app.post('/api/auth/verify', authMiddleware, async (req, res) => {
  const { project_id, client_email, private_key } = req.body;

  if (!project_id || !client_email || !private_key) {
    return res.status(400).json({ success: false, error: 'Eksik alan.' });
  }

  try {
    await getFCMAccessToken({ project_id, client_email, private_key });
    return res.json({
      success: true,
      message: 'Firebase bağlantısı başarılı.',
      project_id,
    });
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'Firebase bağlantısı başarısız: ' + err.message,
    });
  }
});

// ─── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════╗
║   PushDesk Backend — Çalışıyor     ║
║   Port: ${PORT}                        ║
║   API Key: ${API_KEY ? 'Aktif ✓' : 'Devre dışı'}              ║
╚════════════════════════════════════╝
  `);
});