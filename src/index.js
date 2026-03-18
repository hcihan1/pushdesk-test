const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
}));

app.use(express.json({ limit: '1mb' }));

const API_KEY = process.env.API_KEY || null;

function authMiddleware(req, res, next) {
  if (!API_KEY) return next();
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ success: false, error: 'Yetkisiz istek.' });
  }
  next();
}

const tokenCache = new Map();

async function getFCMAccessToken(credentials) {
  const projectId = credentials.project_id;
  const cached = tokenCache.get(projectId);

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

  tokenCache.set(projectId, {
    token: accessToken,
    expiresAt: Date.now() + 55 * 60 * 1000,
  });

  return accessToken;
}

async function sendFCMPush({ credentials, notification, target }) {
  const accessToken = await getFCMAccessToken(credentials);
  const projectId = credentials.project_id;

  // Flutter LocalNotificationService şu sırayla görsel okuyor:
  // 1. message.notification?.android?.imageUrl  (FCM notification.image)
  // 2. message.notification?.apple?.imageUrl    (apns fcm_options.image)
  // 3. data['imageUrl'] veya data['image']      (data payload)
  // Hepsini dolduruyoruz.

  const dataPayload = {};
  if (notification.imageUrl) {
    dataPayload['imageUrl'] = notification.imageUrl;
    dataPayload['image'] = notification.imageUrl;
  }
  if (notification.deeplink) {
    dataPayload['url'] = notification.deeplink;
    dataPayload['deeplink'] = notification.deeplink;
  }

  const message = {
    notification: {
      title: notification.title,
      body: notification.body,
      ...(notification.imageUrl && { image: notification.imageUrl }),
    },
    data: dataPayload,
    android: {
      priority: 'high',
      notification: {
        default_sound: true,
        default_vibrate_timings: true,
        notification_priority: 'PRIORITY_HIGH',
        visibility: 'PUBLIC',
        ...(notification.imageUrl && { image_url: notification.imageUrl }),
      },
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: {
        aps: {
          sound: 'default',
          ...(notification.badge && { badge: parseInt(notification.badge) }),
        },
      },
      ...(notification.imageUrl && {
        fcm_options: { image: notification.imageUrl },
      }),
    },
  };

  if (target.type === 'token') {
    message.token = target.value;
  } else {
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

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'PushDesk Backend',
    version: '1.1.0',
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/push/send', authMiddleware, async (req, res) => {
  const { project_id, client_email, private_key, notification, target } = req.body;

  if (!project_id || !client_email || !private_key) {
    return res.status(400).json({ success: false, error: 'project_id, client_email ve private_key zorunludur.' });
  }
  if (!notification?.title || !notification?.body) {
    return res.status(400).json({ success: false, error: 'notification.title ve notification.body zorunludur.' });
  }
  if (!target?.type || !target?.value) {
    return res.status(400).json({ success: false, error: 'target.type ve target.value zorunludur.' });
  }

  try {
    const result = await sendFCMPush({ credentials: { project_id, client_email, private_key }, notification, target });
    console.log(`[Push] OK: ${project_id} → ${target.value} ${notification.imageUrl ? 'IMG' : ''} ${notification.deeplink ? 'LINK' : ''}`);
    return res.json({ success: true, messageId: result.name, project: project_id, target: target.value });
  } catch (err) {
    console.error(`[Push] ERR: ${project_id}:`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/verify', authMiddleware, async (req, res) => {
  const { project_id, client_email, private_key } = req.body;
  if (!project_id || !client_email || !private_key) {
    return res.status(400).json({ success: false, error: 'Eksik alan.' });
  }
  try {
    await getFCMAccessToken({ project_id, client_email, private_key });
    return res.json({ success: true, message: 'Firebase bağlantısı başarılı.', project_id });
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Firebase bağlantısı başarısız: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`PushDesk Backend çalışıyor. Port: ${PORT}`);
});