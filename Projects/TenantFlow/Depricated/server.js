require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const COMPANY_NAME = 'TenantFlow';
const PORT = process.env.PORT;
const DATA_DIR = path.join(__dirname, 'data');

// ── EMAIL CONFIG ──
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;

// // In the event that you find yourself a clone ;) Uncomment 2 lines below and comment 3 lines above
// GMAIL_USER = your_gmail_here
// GMAIL_PASS = your_app_password_here

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

// ── FILE PATHS ──
const FILES = {
  renters: path.join(DATA_DIR, 'renters.json'),
  owners: path.join(DATA_DIR, 'owners.json'),
};

// Ensure data directory and files exist on startup
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
Object.values(FILES).forEach(file => {
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify([], null, 2));
});

// ── IN-MEMORY VERIFICATION STORE ──
// Holds pending signups until email is verified
// Structure: { [email]: { code, expiresAt, data, segment } }
const pendingVerifications = {};

const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// IN-MEMORY MAGIC LINK STORE
// Structure: { [token]: { email, expiresAt } }
const magicTokens = {};
const MAGIC_LINK_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

// ── HELPERS ──
function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
  });
}
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
}
function generateId(prefix) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const id = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${prefix}-${id}`;
}

// ── EMAIL SENDER ──
async function sendVerificationEmail(toEmail, firstName, code) {
  await transporter.sendMail({
    from: `"${COMPANY_NAME}" <${GMAIL_USER}>`,
    to: toEmail,
    subject: `Your ${COMPANY_NAME} verification code`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; padding: 40px 32px; background: #FDFAF5; border-radius: 16px;">
        <h1 style="font-size: 28px; color: #2C3E35; margin-bottom: 8px;">Welcome to ${COMPANY_NAME}, ${firstName}!</h1>
        <p style="color: #7A8C83; font-size: 15px; line-height: 1.7; margin-bottom: 32px;">
          We're excited to have you on the waitlist. To confirm your spot, please enter the verification code below.
        </p>
        <div style="background: #2C3E35; border-radius: 12px; padding: 28px; text-align: center; margin-bottom: 32px;">
          <p style="color: rgba(255,255,255,0.6); font-size: 12px; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 12px;">Your verification code</p>
          <p style="color: #fff; font-size: 42px; font-weight: bold; letter-spacing: 10px; margin: 0;">${code}</p>
        </div>
        <p style="color: #B0BDB8; font-size: 13px; line-height: 1.6;">
          This code expires in <strong>10 minutes</strong>. If you didn't sign up for ${COMPANY_NAME}, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid rgba(44,62,53,0.1); margin: 32px 0;"/>
        <p style="color: #C4895A; font-size: 13px; font-weight: bold;">${COMPANY_NAME}</p>
      </div>
    `,
  });
}


function generateMagicToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 48 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function sendMagicLinkEmail(toEmail, firstName, token) {
  const link = `http://localhost:${PORT}/portal.html?token=${token}`;
  await transporter.sendMail({
    from: `"TenantFlow" <${GMAIL_USER}>`,
    to: toEmail,
    subject: `Your TenantFlow sign-in link`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; padding: 40px 32px; background: #FDFAF5; border-radius: 16px;">
        <h1 style="font-size: 26px; color: #2C3E35; margin-bottom: 8px;">Welcome back, ${firstName}!</h1>
        <p style="color: #7A8C83; font-size: 15px; line-height: 1.7; margin-bottom: 32px;">
          Click the button below to sign in to your TenantFlow dashboard. This link expires in 15 minutes.
        </p>
        <a href="${link}" style="display:inline-block; background: #2C3E35; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-size: 15px; font-weight: bold; margin-bottom: 32px;">
          Sign In to My Dashboard →
        </a>
        <p style="color: #B0BDB8; font-size: 13px; line-height: 1.6;">
          If you didn't request this link, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid rgba(44,62,53,0.1); margin: 32px 0;"/>
        <p style="color: #C4895A; font-size: 13px; font-weight: bold;">TenantFlow</p>
      </div>
    `,
  });
}

// ── ROUTES ──
const routes = {

  // STEP 1: Renter submits form → generate code, send email, hold data
  'POST /api/waitlist': async (req, res) => {
    const data = await parseBody(req);
    const { firstName, lastName, email, phone } = data;

    if (!firstName || !lastName || !email || !phone) {
      return sendJSON(res, 400, { error: 'All fields are required.' });
    }

    const existing = readJSON(FILES.renters);
    if (existing.find(e => e.email.toLowerCase() === email.toLowerCase())) {
      return sendJSON(res, 409, { error: 'This email is already registered.' });
    }

    const code = generateCode();
    pendingVerifications[email.toLowerCase()] = {
      code,
      expiresAt: Date.now() + CODE_EXPIRY_MS,
      data,
      segment: 'renter',
    };

    await sendVerificationEmail(email, firstName, code);
    console.log(`📧 Verification code sent to ${email}`);
    sendJSON(res, 200, { success: true, message: 'Verification code sent.' });
  },

  // POST /api/check-email — check if email already exists
  'POST /api/check-email': async (req, res) => {
    const { email, type } = await parseBody(req);
    if (!email) return sendJSON(res, 400, { error: 'Email is required.' });

    const file = type === 'owner' ? FILES.owners : FILES.renters;
    const existing = readJSON(file);

    const duplicate = type === 'owner'
      ? existing.find(e => e.basicInfo?.email?.toLowerCase() === email.toLowerCase())
      : existing.find(e => e.email?.toLowerCase() === email.toLowerCase());

    sendJSON(res, 200, { exists: !!duplicate });
  },

  'POST /api/owners': async (req, res) => {
    const data = await parseBody(req);
    const { basicInfo } = data;

    if (!basicInfo || !basicInfo.firstName || !basicInfo.lastName || !basicInfo.email || !basicInfo.phone) {
      return sendJSON(res, 400, { error: 'Basic info fields are required.' });
    }

    const existing = readJSON(FILES.owners);
    if (existing.find(e => e.basicInfo?.email?.toLowerCase() === basicInfo.email.toLowerCase())) {
      return sendJSON(res, 409, { error: 'This email is already registered.' });
    }

    const code = generateCode();
    pendingVerifications[basicInfo.email.toLowerCase()] = {
      code,
      expiresAt: Date.now() + CODE_EXPIRY_MS,
      data,
      segment: 'owner',
    };

    await sendVerificationEmail(basicInfo.email, basicInfo.firstName, code);
    console.log(`📧 Verification code sent to ${basicInfo.email}`);
    sendJSON(res, 200, { success: true, message: 'Verification code sent.' });
  },

  // STEP 2: Verify code → save to JSON
  'POST /api/verify': async (req, res) => {
    const { email, code } = await parseBody(req);

    if (!email || !code) {
      return sendJSON(res, 400, { error: 'Email and code are required.' });
    }

    const pending = pendingVerifications[email.toLowerCase()];

    if (!pending) {
      return sendJSON(res, 404, { error: 'No pending verification found. Please sign up again.' });
    }
    if (Date.now() > pending.expiresAt) {
      delete pendingVerifications[email.toLowerCase()];
      return sendJSON(res, 410, { error: 'Code has expired. Please sign up again.' });
    }
    if (pending.code !== code.trim()) {
      return sendJSON(res, 401, { error: 'Incorrect code. Please try again.' });
    }

    // Code is valid — save to the appropriate file
    const { data, segment } = pending;
    const file = segment === 'renter' ? FILES.renters : FILES.owners;
    const existing = readJSON(file);

    data.userId = generateId(segment);
    data.verifiedAt = new Date().toISOString();
    existing.push(data);
    writeJSON(file, existing);

    delete pendingVerifications[email.toLowerCase()];

    const name = segment === 'renter'
      ? `${data.firstName} ${data.lastName}`
      : `${data.basicInfo.firstName} ${data.basicInfo.lastName}`;

    console.log(`✅ Verified & saved ${segment}: ${name} (${email}) — ID: ${data.userId}`);
    sendJSON(res, 201, { success: true, userId: data.userId });
  },

  // POST /api/magic-link — send sign-in link to existing renter
  'POST /api/magic-link': async (req, res) => {
    const { email } = await parseBody(req);

    if (!email) return sendJSON(res, 400, { error: 'Email is required.' });

    const renters = readJSON(FILES.renters);
    const renter = renters.find(r => r.email?.toLowerCase() === email.toLowerCase());

    if (!renter) {
      return sendJSON(res, 404, { error: 'No account found with that email. Please join the waitlist first.' });
    }

    const token = generateMagicToken();
    magicTokens[token] = { email: email.toLowerCase(), expiresAt: Date.now() + MAGIC_LINK_EXPIRY_MS };

    await sendMagicLinkEmail(email, renter.firstName, token);
    console.log(`🔗 Magic link sent to ${email}`);
    sendJSON(res, 200, { success: true });
  },

  // GET /api/magic-link/verify — validate token and redirect to portal
  'GET /api/magic-link/verify': async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const token = url.searchParams.get('token');

    if (!token || !magicTokens[token]) {
      res.writeHead(302, { Location: '/renter.html?error=invalid_token' });
      return res.end();
    }

    const record = magicTokens[token];
    if (Date.now() > record.expiresAt) {
      delete magicTokens[token];
      res.writeHead(302, { Location: '/renter.html?error=expired_token' });
      return res.end();
    }

    delete magicTokens[token];
    console.log(`✅ Magic link login: ${record.email}`);
    res.writeHead(302, { Location: `/portal.html?auth=${encodeURIComponent(record.email)}` });
    res.end();
  },
};

// ── SERVER ──
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  console.log(`Incoming: ${req.method} ${req.url}`);

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const key = `${req.method} ${req.url.split('?')[0]}`;
  const handler = routes[key];

  if (handler) {
    try {
      await handler(req, res);
    } catch (err) {
      console.error('Error:', err);
      sendJSON(res, 500, { error: 'Internal server error.' });
    }
  } else {
    // Try serving static files for GET requests (needed for magic link redirect)
    if (req.method === 'GET') {
      let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      console.log(`Serving: ${filePath} — exists: ${fs.existsSync(filePath)}`);
      if (!path.extname(filePath)) filePath += '.html';
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath);
        const mimeTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json' };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        return res.end(fs.readFileSync(filePath));
      }
      console.log(`File not found: ${filePath}`);
    }
    sendJSON(res, 404, { error: 'Route not found.' });
  }
});

server.listen(PORT, () => {
  console.log(`\n🏠 ${COMPANY_NAME} server running at http://localhost:${PORT}`);
  console.log(`📁 Renters → ${FILES.renters}`);
  console.log(`📁 Owners  → ${FILES.owners}`);
  console.log(`\nWaiting for signups...\n`);
});
