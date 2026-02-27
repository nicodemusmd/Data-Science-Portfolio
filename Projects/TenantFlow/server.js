require('dotenv').config();

const http       = require('http');
const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');
const Database   = require('better-sqlite3');

const COMPANY_NAME = 'TenantFlow';
const PORT         = process.env.PORT;
const GMAIL_USER   = process.env.GMAIL_USER;
const GMAIL_PASS   = process.env.GMAIL_PASS;

// ── DATABASE ──
const db = new Database(path.join(__dirname, 'data', 'tenantflow.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── EMAIL ──
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

// ── IN-MEMORY PENDING VERIFICATIONS ──
const pendingVerifications = {};
const CODE_EXPIRY_MS       = 10 * 60 * 1000;
const MAGIC_LINK_EXPIRY_MS = 15 * 60 * 1000;
const INVITE_EXPIRY_MS     = 24 * 60 * 60 * 1000; // 24 hours

// ── HELPERS ──
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
function generateCode()           { return Math.floor(100000 + Math.random() * 900000).toString(); }
function generateId(prefix)       {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return `${prefix}-${Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')}`;
}
function generateToken(len = 48)  {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
function generateInviteCode() {
  // 6 char uppercase alphanumeric — easy to read and type
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0,O,1,I)
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── ANALYTICS ──
function trackEvent(event, segment, email = null, sessionId = null, metadata = null) {
  try {
    db.prepare(`INSERT INTO analytics (session_id, event, segment, email, metadata) VALUES (?,?,?,?,?)`)
      .run(sessionId, event, segment, email, metadata ? JSON.stringify(metadata) : null);
  } catch (e) { console.error('Analytics error:', e.message); }
}

// ── EMAIL SENDERS ──
async function sendVerificationEmail(toEmail, firstName, code) {
  await transporter.sendMail({
    from: `"${COMPANY_NAME}" <${GMAIL_USER}>`,
    to: toEmail,
    subject: `Your ${COMPANY_NAME} verification code`,
    html: `
      <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:40px 32px;background:#FDFAF5;border-radius:16px;">
        <h1 style="font-size:28px;color:#2C3E35;margin-bottom:8px;">Welcome to ${COMPANY_NAME}, ${firstName}!</h1>
        <p style="color:#7A8C83;font-size:15px;line-height:1.7;margin-bottom:32px;">To confirm your spot, enter the code below.</p>
        <div style="background:#2C3E35;border-radius:12px;padding:28px;text-align:center;margin-bottom:32px;">
          <p style="color:rgba(255,255,255,0.6);font-size:12px;letter-spacing:3px;text-transform:uppercase;margin-bottom:12px;">Your verification code</p>
          <p style="color:#fff;font-size:42px;font-weight:bold;letter-spacing:10px;margin:0;">${code}</p>
        </div>
        <p style="color:#B0BDB8;font-size:13px;">Expires in <strong>10 minutes</strong>.</p>
        <hr style="border:none;border-top:1px solid rgba(44,62,53,0.1);margin:32px 0;"/>
        <p style="color:#C4895A;font-size:13px;font-weight:bold;">${COMPANY_NAME}</p>
      </div>`,
  });
}

async function sendMagicLinkEmail(toEmail, firstName, token, segment) {
  const link = `http://localhost:${PORT}/api/magic-link/verify?token=${token}`;
  await transporter.sendMail({
    from: `"${COMPANY_NAME}" <${GMAIL_USER}>`,
    to: toEmail,
    subject: `Your ${COMPANY_NAME} sign-in link`,
    html: `
      <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:40px 32px;background:#FDFAF5;border-radius:16px;">
        <h1 style="font-size:26px;color:#2C3E35;margin-bottom:8px;">Welcome back, ${firstName}!</h1>
        <p style="color:#7A8C83;font-size:15px;line-height:1.7;margin-bottom:32px;">Click below to sign in. This link expires in 15 minutes.</p>
        <a href="${link}" style="display:inline-block;background:#2C3E35;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-size:15px;font-weight:bold;margin-bottom:32px;">Sign In to My Dashboard &rarr;</a>
        <p style="color:#B0BDB8;font-size:13px;">If you didn't request this, ignore this email.</p>
        <hr style="border:none;border-top:1px solid rgba(44,62,53,0.1);margin:32px 0;"/>
        <p style="color:#C4895A;font-size:13px;font-weight:bold;">${COMPANY_NAME}</p>
      </div>`,
  });
}

async function sendConnectionEmail(toEmail, renterName, ownerName, propertyAddress) {
  await transporter.sendMail({
    from: `"${COMPANY_NAME}" <${GMAIL_USER}>`,
    to: toEmail,
    subject: `You've been connected to a property on ${COMPANY_NAME}`,
    html: `
      <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:40px 32px;background:#FDFAF5;border-radius:16px;">
        <h1 style="font-size:24px;color:#2C3E35;margin-bottom:8px;">You're connected! 🎉</h1>
        <p style="color:#7A8C83;font-size:15px;line-height:1.7;margin-bottom:24px;">
          <strong>${renterName}</strong> has connected to your property at <strong>${propertyAddress}</strong> on ${COMPANY_NAME}.
        </p>
        <p style="color:#B0BDB8;font-size:13px;">Sign in to your dashboard to view tenant details.</p>
        <hr style="border:none;border-top:1px solid rgba(44,62,53,0.1);margin:32px 0;"/>
        <p style="color:#C4895A;font-size:13px;font-weight:bold;">${COMPANY_NAME}</p>
      </div>`,
  });
}

// ── ROUTES ──
const routes = {

  // POST /api/track
  'POST /api/track': async (req, res) => {
    const { event, segment, email, sessionId, metadata } = await parseBody(req);
    if (!event) return sendJSON(res, 400, { error: 'Event is required.' });
    trackEvent(event, segment, email || null, sessionId || null, metadata || null);
    sendJSON(res, 200, { success: true });
  },

  // POST /api/check-email
  'POST /api/check-email': async (req, res) => {
    const { email, type } = await parseBody(req);
    if (!email) return sendJSON(res, 400, { error: 'Email is required.' });
    const table = type === 'owner' ? 'owners' : 'renters';
    const row = db.prepare(`SELECT id FROM ${table} WHERE LOWER(email) = LOWER(?)`).get(email);
    sendJSON(res, 200, { exists: !!row });
  },

  // POST /api/waitlist — renter signup
  'POST /api/waitlist': async (req, res) => {
    const data = await parseBody(req);
    const { firstName, lastName, email, phone, sessionId } = data;
    if (!firstName || !lastName || !email || !phone)
      return sendJSON(res, 400, { error: 'All fields are required.' });
    if (db.prepare('SELECT id FROM renters WHERE LOWER(email) = LOWER(?)').get(email))
      return sendJSON(res, 409, { error: 'This email is already registered.' });

    const code = generateCode();
    pendingVerifications[email.toLowerCase()] = { code, expiresAt: Date.now() + CODE_EXPIRY_MS, data, segment: 'renter' };
    await sendVerificationEmail(email, firstName, code);
    trackEvent('form_submitted', 'renter', email, sessionId || null);
    console.log(`📧 Verification code sent to ${email}`);
    sendJSON(res, 200, { success: true });
  },

  // POST /api/owners — owner signup
  'POST /api/owners': async (req, res) => {
    const data = await parseBody(req);
    const { basicInfo, sessionId } = data;
    if (!basicInfo?.firstName || !basicInfo?.lastName || !basicInfo?.email || !basicInfo?.phone)
      return sendJSON(res, 400, { error: 'Basic info fields are required.' });
    if (db.prepare('SELECT id FROM owners WHERE LOWER(email) = LOWER(?)').get(basicInfo.email))
      return sendJSON(res, 409, { error: 'This email is already registered.' });

    const code = generateCode();
    pendingVerifications[basicInfo.email.toLowerCase()] = { code, expiresAt: Date.now() + CODE_EXPIRY_MS, data, segment: 'owner' };
    await sendVerificationEmail(basicInfo.email, basicInfo.firstName, code);
    trackEvent('form_submitted', 'owner', basicInfo.email, sessionId || null);
    console.log(`📧 Verification code sent to ${basicInfo.email}`);
    sendJSON(res, 200, { success: true });
  },

  // POST /api/verify — verify code, save to DB
  'POST /api/verify': async (req, res) => {
    const { email, code, sessionId } = await parseBody(req);
    if (!email || !code) return sendJSON(res, 400, { error: 'Email and code are required.' });

    const pending = pendingVerifications[email.toLowerCase()];
    if (!pending)              return sendJSON(res, 404, { error: 'No pending verification. Please sign up again.' });
    if (Date.now() > pending.expiresAt) {
      delete pendingVerifications[email.toLowerCase()];
      return sendJSON(res, 410, { error: 'Code expired. Please sign up again.' });
    }
    if (pending.code !== code.trim()) return sendJSON(res, 401, { error: 'Incorrect code. Please try again.' });

    const { data, segment } = pending;
    const userId     = generateId(segment);
    const verifiedAt = new Date().toISOString();

    if (segment === 'renter') {
      db.prepare(`INSERT INTO renters (user_id,first_name,last_name,email,phone,segment,verified_at,submitted_at) VALUES (?,?,?,?,?,'renter',?,?)`)
        .run(userId, data.firstName, data.lastName, data.email, data.phone, verifiedAt, data.submittedAt);

      // If they used an invite code during signup, connect them now
      if (data.inviteCode) {
        const renter = db.prepare('SELECT id FROM renters WHERE LOWER(email) = LOWER(?)').get(email);
        const invite = db.prepare('SELECT * FROM invite_codes WHERE code = ? AND used = 0').get(data.inviteCode.toUpperCase());
        if (invite && renter && new Date(invite.expires_at) > new Date()) {
          db.prepare(`INSERT OR IGNORE INTO tenant_properties (renter_id,property_id,owner_id) VALUES (?,?,?)`)
            .run(renter.id, invite.property_id, invite.owner_id);
          db.prepare('UPDATE invite_codes SET used = 1 WHERE id = ?').run(invite.id);
          // Notify owner
          const owner    = db.prepare('SELECT * FROM owners WHERE id = ?').get(invite.owner_id);
          const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(invite.property_id);
          if (owner && property) {
            await sendConnectionEmail(owner.email, `${data.firstName} ${data.lastName}`, `${owner.first_name} ${owner.last_name}`, property.address)
              .catch(e => console.error('Connection email error:', e.message));
          }
        }
      }

    } else {
      const info = data.basicInfo || {}, port = data.portfolio || {}, pains = data.painPoints || {};
      const result = db.prepare(`
        INSERT INTO owners (user_id,first_name,last_name,email,phone,property_count,management_style,property_types,challenges,current_tools,additional_notes,segment,verified_at,submitted_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'owner',?,?)
      `).run(userId, info.firstName, info.lastName, info.email, info.phone,
             port.propertyCount, port.managementStyle,
             JSON.stringify(port.propertyTypes || []), JSON.stringify(pains.challenges || []),
             pains.currentTools, pains.additionalNotes, verifiedAt, data.submittedAt);

      const ownerId = result.lastInsertRowid;
      const insertProp = db.prepare(`INSERT INTO properties (owner_id,address,bedrooms,bathrooms,lease_status,lease_start,lease_expiry,monthly_rent,deposit) VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const p of (data.properties || [])) {
        insertProp.run(ownerId, p.address, p.bedrooms, p.bathrooms, p.leaseStatus, p.leaseStart, p.leaseExpiry, parseFloat(p.monthlyRent)||null, parseFloat(p.deposit)||null);
      }
    }

    delete pendingVerifications[email.toLowerCase()];
    trackEvent('verified', segment, email, sessionId || null);
    console.log(`✅ Verified & saved ${segment}: ${email} — ID: ${userId}`);
    sendJSON(res, 201, { success: true, userId });
  },

  // POST /api/magic-link — send sign-in link
  'POST /api/magic-link': async (req, res) => {
    const { email, segment = 'renter' } = await parseBody(req);
    if (!email) return sendJSON(res, 400, { error: 'Email is required.' });
    const table = segment === 'owner' ? 'owners' : 'renters';
    const user  = db.prepare(`SELECT * FROM ${table} WHERE LOWER(email) = LOWER(?)`).get(email);
    if (!user) return sendJSON(res, 404, { error: 'No account found with that email. Please sign up first.' });

    const token     = generateToken();
    const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MS).toISOString();
    db.prepare('INSERT INTO sessions (token,email,segment,expires_at) VALUES (?,?,?,?)').run(token, email.toLowerCase(), segment, expiresAt);
    await sendMagicLinkEmail(email, user.first_name, token, segment);
    trackEvent('magic_link_sent', segment, email);
    console.log(`🔗 Magic link sent to ${email} (${segment})`);
    sendJSON(res, 200, { success: true });
  },

  // GET /api/magic-link/verify
  'GET /api/magic-link/verify': async (req, res) => {
    const url   = new URL(req.url, `http://localhost:${PORT}`);
    const token = url.searchParams.get('token');
    if (!token) { res.writeHead(302, { Location: '/renter.html?error=invalid_token' }); return res.end(); }

    const session = db.prepare('SELECT * FROM sessions WHERE token = ? AND used = 0').get(token);
    if (!session) { res.writeHead(302, { Location: '/renter.html?error=invalid_token' }); return res.end(); }
    if (new Date(session.expires_at) < new Date()) {
      db.prepare('UPDATE sessions SET used = 1 WHERE token = ?').run(token);
      res.writeHead(302, { Location: '/renter.html?error=expired_token' });
      return res.end();
    }

    db.prepare('UPDATE sessions SET used = 1 WHERE token = ?').run(token);
    trackEvent('magic_link_used', session.segment, session.email);
    console.log(`✅ Magic link login: ${session.email} (${session.segment})`);
    const dest = session.segment === 'owner' ? 'owner-portal.html' : 'portal.html';
    res.writeHead(302, { Location: `/${dest}?auth=${encodeURIComponent(session.email)}&segment=${session.segment}` });
    res.end();
  },

  // ── INVITE CODE ROUTES ──

  // POST /api/invite/generate — owner generates invite code for a property
  'POST /api/invite/generate': async (req, res) => {
    const { ownerEmail, propertyId } = await parseBody(req);
    if (!ownerEmail || !propertyId) return sendJSON(res, 400, { error: 'Owner email and property ID are required.' });

    const owner    = db.prepare('SELECT * FROM owners WHERE LOWER(email) = LOWER(?)').get(ownerEmail);
    if (!owner) return sendJSON(res, 404, { error: 'Owner not found.' });

    const property = db.prepare('SELECT * FROM properties WHERE id = ? AND owner_id = ?').get(propertyId, owner.id);
    if (!property) return sendJSON(res, 404, { error: 'Property not found.' });

    // Expire any previous unused codes for this property
    db.prepare('UPDATE invite_codes SET used = 1 WHERE property_id = ? AND used = 0').run(propertyId);

    const code      = generateInviteCode();
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS).toISOString();
    db.prepare('INSERT INTO invite_codes (code, owner_id, property_id, expires_at) VALUES (?,?,?,?)').run(code, owner.id, propertyId, expiresAt);
    console.log(`🔑 Invite code ${code} generated for property ${propertyId}`);
    sendJSON(res, 200, { success: true, code, expiresAt });
  },

  // POST /api/invite/redeem — renter redeems invite code (after signup, from portal)
  'POST /api/invite/redeem': async (req, res) => {
    const { renterEmail, code } = await parseBody(req);
    if (!renterEmail || !code) return sendJSON(res, 400, { error: 'Renter email and code are required.' });

    const renter = db.prepare('SELECT * FROM renters WHERE LOWER(email) = LOWER(?)').get(renterEmail);
    if (!renter) return sendJSON(res, 404, { error: 'Renter account not found.' });

    const invite = db.prepare('SELECT * FROM invite_codes WHERE code = ? AND used = 0').get(code.toUpperCase().trim());
    if (!invite)                              return sendJSON(res, 404, { error: 'Invalid or already used invite code.' });
    if (new Date(invite.expires_at) < new Date()) return sendJSON(res, 410, { error: 'This invite code has expired. Ask your landlord for a new one.' });

    // Check not already connected to this property
    const existing = db.prepare('SELECT id FROM tenant_properties WHERE renter_id = ? AND property_id = ?').get(renter.id, invite.property_id);
    if (existing) return sendJSON(res, 409, { error: 'You are already connected to this property.' });

    db.prepare('INSERT INTO tenant_properties (renter_id, property_id, owner_id) VALUES (?,?,?)').run(renter.id, invite.property_id, invite.owner_id);
    db.prepare('UPDATE invite_codes SET used = 1 WHERE id = ?').run(invite.id);

    const owner    = db.prepare('SELECT * FROM owners WHERE id = ?').get(invite.owner_id);
    const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(invite.property_id);

    // Notify owner
    if (owner && property) {
      await sendConnectionEmail(owner.email, `${renter.first_name} ${renter.last_name}`, `${owner.first_name} ${owner.last_name}`, property.address)
        .catch(e => console.error('Connection email error:', e.message));
    }

    console.log(`🔗 ${renter.email} connected to property ${invite.property_id}`);
    sendJSON(res, 200, { success: true, property: { address: property?.address, id: property?.id } });
  },

  // POST /api/invite/search-owner — renter searches owner by email to find properties
  'POST /api/invite/search-owner': async (req, res) => {
    const { ownerEmail } = await parseBody(req);
    if (!ownerEmail) return sendJSON(res, 400, { error: 'Owner email is required.' });

    const owner = db.prepare('SELECT * FROM owners WHERE LOWER(email) = LOWER(?)').get(ownerEmail);
    if (!owner) return sendJSON(res, 404, { error: 'No owner found with that email address.' });

    const properties = db.prepare('SELECT id, address, bedrooms, bathrooms, lease_status FROM properties WHERE owner_id = ?').all(owner.id);
    sendJSON(res, 200, {
      owner: { firstName: owner.first_name, lastName: owner.last_name },
      properties,
    });
  },

  // POST /api/invite/connect-by-search — renter connects to a property found via owner search
  'POST /api/invite/connect-by-search': async (req, res) => {
    const { renterEmail, propertyId, ownerEmail } = await parseBody(req);
    if (!renterEmail || !propertyId || !ownerEmail) return sendJSON(res, 400, { error: 'All fields are required.' });

    const renter   = db.prepare('SELECT * FROM renters WHERE LOWER(email) = LOWER(?)').get(renterEmail);
    const owner    = db.prepare('SELECT * FROM owners WHERE LOWER(email) = LOWER(?)').get(ownerEmail);
    const property = owner ? db.prepare('SELECT * FROM properties WHERE id = ? AND owner_id = ?').get(propertyId, owner.id) : null;

    if (!renter)   return sendJSON(res, 404, { error: 'Renter account not found.' });
    if (!owner)    return sendJSON(res, 404, { error: 'Owner not found.' });
    if (!property) return sendJSON(res, 404, { error: 'Property not found.' });

    const existing = db.prepare('SELECT id FROM tenant_properties WHERE renter_id = ? AND property_id = ?').get(renter.id, property.id);
    if (existing) return sendJSON(res, 409, { error: 'You are already connected to this property.' });

    db.prepare('INSERT INTO tenant_properties (renter_id, property_id, owner_id) VALUES (?,?,?)').run(renter.id, property.id, owner.id);

    await sendConnectionEmail(owner.email, `${renter.first_name} ${renter.last_name}`, `${owner.first_name} ${owner.last_name}`, property.address)
      .catch(e => console.error('Connection email error:', e.message));

    console.log(`🔗 ${renter.email} connected to property ${property.id} via owner search`);
    sendJSON(res, 200, { success: true, property: { address: property.address, id: property.id } });
  },

  // ── OWNER DATA ROUTES ──

  // GET /api/owner-data — full dashboard data for logged-in owner
  'GET /api/owner-data': async (req, res) => {
    const url   = new URL(req.url, `http://localhost:${PORT}`);
    const email = decodeURIComponent(url.searchParams.get('email') || '');
    if (!email) return sendJSON(res, 400, { error: 'Email is required.' });

    const owner = db.prepare('SELECT * FROM owners WHERE LOWER(email) = LOWER(?)').get(email);
    if (!owner) return sendJSON(res, 404, { error: 'Owner not found.' });

    const properties = db.prepare('SELECT * FROM properties WHERE owner_id = ?').all(owner.id);

    // For each property, attach connected tenant if any
    const propertiesWithTenants = properties.map(p => {
      const connection = db.prepare(`
        SELECT r.first_name, r.last_name, r.email, r.phone, tp.connected_at
        FROM tenant_properties tp
        JOIN renters r ON r.id = tp.renter_id
        WHERE tp.property_id = ?
        LIMIT 1
      `).get(p.id);
      return {
        id:          p.id,
        address:     p.address,
        bedrooms:    p.bedrooms,
        bathrooms:   p.bathrooms,
        monthlyRent: p.monthly_rent,
        status:      p.lease_status || 'unknown',
        leaseStart:  p.lease_start,
        leaseExpiry: p.lease_expiry,
        deposit:     p.deposit,
        tenant:      connection ? {
          name:        `${connection.first_name} ${connection.last_name}`,
          email:       connection.email,
          phone:       connection.phone,
          connectedAt: connection.connected_at,
        } : null,
      };
    });

    const totalMonthlyRent = properties.reduce((s, p) => s + (p.monthly_rent || 0), 0);
    const totalDeposits    = properties.reduce((s, p) => s + (p.deposit || 0), 0);

    sendJSON(res, 200, {
      owner: {
        userId:         owner.user_id,
        firstName:      owner.first_name,
        lastName:       owner.last_name,
        email:          owner.email,
        phone:          owner.phone,
        avatarInitials: `${owner.first_name[0]}${owner.last_name[0]}`.toUpperCase(),
      },
      portfolio: {
        totalProperties:   properties.length,
        occupiedUnits:     properties.filter(p => p.lease_status === 'active').length,
        vacantUnits:       properties.filter(p => p.lease_status === 'vacant').length,
        totalMonthlyRent,
        totalAnnualRent:   totalMonthlyRent * 12,
        totalDepositsHeld: totalDeposits,
      },
      properties: propertiesWithTenants,
      maintenanceRequests: [],
    });
  },

  // POST /api/property/add — owner adds a new property from the portal
  'POST /api/property/add': async (req, res) => {
    const { ownerEmail, property } = await parseBody(req);
    if (!ownerEmail || !property?.address) return sendJSON(res, 400, { error: 'Owner email and property address are required.' });

    const owner = db.prepare('SELECT * FROM owners WHERE LOWER(email) = LOWER(?)').get(ownerEmail);
    if (!owner) return sendJSON(res, 404, { error: 'Owner not found.' });

    const result = db.prepare(`
      INSERT INTO properties (owner_id,address,bedrooms,bathrooms,lease_status,lease_start,lease_expiry,monthly_rent,deposit)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(owner.id, property.address, property.bedrooms||null, property.bathrooms||null,
           property.leaseStatus||null, property.leaseStart||null, property.leaseExpiry||null,
           parseFloat(property.monthlyRent)||null, parseFloat(property.deposit)||null);

    console.log(`🏠 New property added for ${ownerEmail}: ${property.address}`);
    sendJSON(res, 201, { success: true, propertyId: result.lastInsertRowid });
  },

  // POST /api/property/remove — owner removes a property
  'POST /api/property/remove': async (req, res) => {
    const { ownerEmail, propertyId } = await parseBody(req);
    if (!ownerEmail || !propertyId) return sendJSON(res, 400, { error: 'Owner email and property ID are required.' });

    const owner = db.prepare('SELECT * FROM owners WHERE LOWER(email) = LOWER(?)').get(ownerEmail);
    if (!owner) return sendJSON(res, 404, { error: 'Owner not found.' });

    const property = db.prepare('SELECT * FROM properties WHERE id = ? AND owner_id = ?').get(propertyId, owner.id);
    if (!property) return sendJSON(res, 404, { error: 'Property not found.' });

    // Remove tenant connections first
    db.prepare('DELETE FROM tenant_properties WHERE property_id = ?').run(propertyId);
    db.prepare('DELETE FROM invite_codes WHERE property_id = ?').run(propertyId);
    db.prepare('DELETE FROM properties WHERE id = ?').run(propertyId);

    console.log(`🗑️  Property ${propertyId} removed for ${ownerEmail}`);
    sendJSON(res, 200, { success: true });
  },

  // GET /api/renter-data — renter portal data
  'GET /api/renter-data': async (req, res) => {
    const url   = new URL(req.url, `http://localhost:${PORT}`);
    const email = decodeURIComponent(url.searchParams.get('email') || '');
    if (!email) return sendJSON(res, 400, { error: 'Email is required.' });

    const renter = db.prepare('SELECT * FROM renters WHERE LOWER(email) = LOWER(?)').get(email);
    if (!renter) return sendJSON(res, 404, { error: 'Renter not found.' });

    // Find connected property
    const connection = db.prepare(`
      SELECT p.*, o.first_name as owner_first, o.last_name as owner_last,
             o.email as owner_email, o.phone as owner_phone
      FROM tenant_properties tp
      JOIN properties p ON p.id = tp.property_id
      JOIN owners o ON o.id = tp.owner_id
      WHERE tp.renter_id = ?
      LIMIT 1
    `).get(renter.id);

    sendJSON(res, 200, {
      renter: {
        userId:         renter.user_id,
        firstName:      renter.first_name,
        lastName:       renter.last_name,
        email:          renter.email,
        phone:          renter.phone,
        avatarInitials: `${renter.first_name[0]}${renter.last_name[0]}`.toUpperCase(),
      },
      property: connection ? {
        id:          connection.id,
        address:     connection.address,
        bedrooms:    connection.bedrooms,
        bathrooms:   connection.bathrooms,
        monthlyRent: connection.monthly_rent,
        leaseStart:  connection.lease_start,
        leaseExpiry: connection.lease_expiry,
        deposit:     connection.deposit,
        status:      connection.lease_status,
      } : null,
      landlord: connection ? {
        name:  `${connection.owner_first} ${connection.owner_last}`,
        email: connection.owner_email,
        phone: connection.owner_phone,
      } : null,
      connected: !!connection,
    });
  },

  // GET /api/analytics
  'GET /api/analytics': async (req, res) => {
    const url     = new URL(req.url, `http://localhost:${PORT}`);
    const segment = url.searchParams.get('segment') || 'owner';
    const events  = ['page_land','step_1_complete','step_2_complete','step_3_complete','form_submitted','verified'];
    const funnel  = events.map(event => {
      const row = db.prepare(`SELECT COUNT(DISTINCT COALESCE(session_id,email)) as count FROM analytics WHERE event=? AND segment=?`).get(event, segment);
      return { event, count: row.count };
    });
    const recent = db.prepare(`SELECT event,segment,email,created_at FROM analytics ORDER BY created_at DESC LIMIT 50`).all();
    sendJSON(res, 200, { funnel, recentEvents: recent });
  },
};

// ── SERVER ──
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  console.log(`Incoming: ${req.method} ${req.url}`);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const key     = `${req.method} ${req.url.split('?')[0]}`;
  const handler = routes[key];
  if (handler) {
    try { await handler(req, res); }
    catch (err) { console.error('Error:', err); sendJSON(res, 500, { error: 'Internal server error.' }); }
  } else {
    if (req.method === 'GET') {
      let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      if (!path.extname(filePath)) filePath += '.html';
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath);
        const mime = { '.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json' };
        res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
        return res.end(fs.readFileSync(filePath));
      }
    }
    sendJSON(res, 404, { error: 'Route not found.' });
  }
});

server.listen(PORT, () => {
  console.log(`\n🏠 ${COMPANY_NAME} server running at http://localhost:${PORT}`);
  console.log(`🗄️  Database: ${path.join(__dirname, 'data', 'tenantflow.db')}`);
  console.log(`\nWaiting for signups...\n`);
});
