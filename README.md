# PushDesk Backend

Multi-tenant FCM push notification backend.

## Railway Deploy (5 dakika)

### 1. GitHub'a yükle
```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/KULLANICI/pushdesk-backend.git
git push -u origin main
```

### 2. Railway'de proje oluştur
1. railway.app → New Project
2. "Deploy from GitHub repo" → repoyu seç
3. Otomatik deploy başlar

### 3. Environment Variables (opsiyonel)
Railway → Variables sekmesi:
```
API_KEY = istedigin-gizli-bir-key
PORT    = 3000 (otomatik set edilir)
```

### 4. URL'i al
Railway → Settings → Domains → "Generate Domain"
Örn: https://pushdesk-backend-production.up.railway.app

### 5. Panele gir
PushDesk Panel → Ayarlar → API Base URL → URL'i yapıştır

---

## Local Test
```bash
npm install
npm start
# → http://localhost:3000
```

## API

### POST /api/push/send
```json
{
  "project_id": "firebase-proje-id",
  "client_email": "firebase-adminsdk@...iam.gserviceaccount.com",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----...",
  "notification": {
    "title": "Merhaba!",
    "body": "Test bildirimi",
    "imageUrl": "https://..." 
  },
  "target": {
    "type": "token",
    "value": "FCM_DEVICE_TOKEN"
  }
}
```

### POST /api/auth/verify
Firebase bağlantısını test eder.

### GET /
Health check.
