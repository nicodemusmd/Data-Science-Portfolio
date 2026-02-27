// db.js — Database setup, schema creation, and migration from JSON files
// Run once with: node db.js
// Safe to re-run — uses CREATE TABLE IF NOT EXISTS

require('dotenv').config();
const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');

const DB_PATH   = path.join(__dirname, 'data', 'tenantflow.db');
const DATA_DIR  = path.join(__dirname, 'data');
const RENTERS_JSON = path.join(DATA_DIR, 'renters.json');
const OWNERS_JSON  = path.join(DATA_DIR, 'owners.json');

console.log('\n🗄️  TenantFlow Database Setup\n');

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── SCHEMA ──
console.log('📐 Creating tables...');

db.exec(`
  -- Renters table
  CREATE TABLE IF NOT EXISTS renters (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT    UNIQUE NOT NULL,
    first_name    TEXT    NOT NULL,
    last_name     TEXT    NOT NULL,
    email         TEXT    UNIQUE NOT NULL,
    phone         TEXT,
    segment       TEXT    DEFAULT 'renter',
    verified_at   TEXT,
    submitted_at  TEXT,
    created_at    TEXT    DEFAULT (datetime('now'))
  );

  -- Owners table
  CREATE TABLE IF NOT EXISTS owners (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT    UNIQUE NOT NULL,
    first_name      TEXT    NOT NULL,
    last_name       TEXT    NOT NULL,
    email           TEXT    UNIQUE NOT NULL,
    phone           TEXT,
    property_count  TEXT,
    management_style TEXT,
    property_types  TEXT,    -- JSON array stored as string
    challenges      TEXT,    -- JSON array stored as string
    current_tools   TEXT,
    additional_notes TEXT,
    segment         TEXT    DEFAULT 'owner',
    verified_at     TEXT,
    submitted_at    TEXT,
    created_at      TEXT    DEFAULT (datetime('now'))
  );

  -- Properties table (linked to owners)
  CREATE TABLE IF NOT EXISTS properties (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id      INTEGER NOT NULL REFERENCES owners(id),
    address       TEXT    NOT NULL,
    bedrooms      TEXT,
    bathrooms     TEXT,
    lease_status  TEXT,
    lease_start   TEXT,
    lease_expiry  TEXT,
    monthly_rent  REAL,
    deposit       REAL,
    created_at    TEXT    DEFAULT (datetime('now'))
  );

  -- Sessions table (magic link tokens)
  CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token       TEXT    UNIQUE NOT NULL,
    email       TEXT    NOT NULL,
    segment     TEXT    NOT NULL,  -- 'renter' or 'owner'
    expires_at  TEXT    NOT NULL,
    used        INTEGER DEFAULT 0,
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  -- Analytics table (funnel tracking)
  CREATE TABLE IF NOT EXISTS analytics (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT,       -- anonymous browser session ID
    event        TEXT NOT NULL,  -- e.g. 'page_land', 'step_1_complete', 'verified'
    segment      TEXT,       -- 'renter' or 'owner'
    email        TEXT,       -- populated after step 1
    metadata     TEXT,       -- JSON string for extra data
    created_at   TEXT DEFAULT (datetime('now'))
  );
`);

console.log('✅ Tables created\n');

// ── MIGRATION ──
function migrateRenters() {
  if (!fs.existsSync(RENTERS_JSON)) {
    console.log('⚠️  renters.json not found — skipping renter migration');
    return;
  }

  const renters = JSON.parse(fs.readFileSync(RENTERS_JSON, 'utf8'));
  if (renters.length === 0) {
    console.log('ℹ️  renters.json is empty — nothing to migrate');
    return;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO renters
      (user_id, first_name, last_name, email, phone, segment, verified_at, submitted_at)
    VALUES
      (@userId, @firstName, @lastName, @email, @phone, @segment, @verifiedAt, @submittedAt)
  `);

  const migrate = db.transaction((renters) => {
    let count = 0;
    for (const r of renters) {
      insert.run({
        userId:      r.userId      || `renter-MIGRATED`,
        firstName:   r.firstName   || '',
        lastName:    r.lastName    || '',
        email:       r.email       || '',
        phone:       r.phone       || '',
        segment:     r.segment     || 'renter',
        verifiedAt:  r.verifiedAt  || null,
        submittedAt: r.submittedAt || null,
      });
      count++;
    }
    return count;
  });

  const count = migrate(renters);
  console.log(`✅ Migrated ${count} renter(s) from renters.json`);
}

function migrateOwners() {
  if (!fs.existsSync(OWNERS_JSON)) {
    console.log('⚠️  owners.json not found — skipping owner migration');
    return;
  }

  const owners = JSON.parse(fs.readFileSync(OWNERS_JSON, 'utf8'));
  if (owners.length === 0) {
    console.log('ℹ️  owners.json is empty — nothing to migrate');
    return;
  }

  const insertOwner = db.prepare(`
    INSERT OR IGNORE INTO owners
      (user_id, first_name, last_name, email, phone,
       property_count, management_style, property_types,
       challenges, current_tools, additional_notes,
       segment, verified_at, submitted_at)
    VALUES
      (@userId, @firstName, @lastName, @email, @phone,
       @propertyCount, @managementStyle, @propertyTypes,
       @challenges, @currentTools, @additionalNotes,
       @segment, @verifiedAt, @submittedAt)
  `);

  const insertProperty = db.prepare(`
    INSERT INTO properties
      (owner_id, address, bedrooms, bathrooms, lease_status,
       lease_start, lease_expiry, monthly_rent, deposit)
    VALUES
      (@ownerId, @address, @bedrooms, @bathrooms, @leaseStatus,
       @leaseStart, @leaseExpiry, @monthlyRent, @deposit)
  `);

  const migrate = db.transaction((owners) => {
    let ownerCount = 0, propCount = 0;
    for (const o of owners) {
      const info   = o.basicInfo   || {};
      const port   = o.portfolio   || {};
      const pains  = o.painPoints  || {};

      const result = insertOwner.run({
        userId:          o.userId          || `owner-MIGRATED`,
        firstName:       info.firstName    || '',
        lastName:        info.lastName     || '',
        email:           info.email        || '',
        phone:           info.phone        || '',
        propertyCount:   port.propertyCount    || null,
        managementStyle: port.managementStyle  || null,
        propertyTypes:   JSON.stringify(port.propertyTypes || []),
        challenges:      JSON.stringify(pains.challenges   || []),
        currentTools:    pains.currentTools    || null,
        additionalNotes: pains.additionalNotes || null,
        segment:         o.segment         || 'owner',
        verifiedAt:      o.verifiedAt      || null,
        submittedAt:     o.submittedAt     || null,
      });

      // Migrate properties linked to this owner
      const ownerId = result.lastInsertRowid;
      for (const p of (o.properties || [])) {
        insertProperty.run({
          ownerId,
          address:     p.address     || '',
          bedrooms:    p.bedrooms    || null,
          bathrooms:   p.bathrooms   || null,
          leaseStatus: p.leaseStatus || null,
          leaseStart:  p.leaseStart  || null,
          leaseExpiry: p.leaseExpiry || null,
          monthlyRent: parseFloat(p.monthlyRent) || null,
          deposit:     parseFloat(p.deposit)     || null,
        });
        propCount++;
      }
      ownerCount++;
    }
    return { ownerCount, propCount };
  });

  const { ownerCount, propCount } = migrate(owners);
  console.log(`✅ Migrated ${ownerCount} owner(s) and ${propCount} propert(ies) from owners.json`);
}

migrateRenters();
migrateOwners();

// ── SUMMARY ──
const renterCount  = db.prepare('SELECT COUNT(*) as count FROM renters').get();
const ownerCount   = db.prepare('SELECT COUNT(*) as count FROM owners').get();
const propCount    = db.prepare('SELECT COUNT(*) as count FROM properties').get();

console.log('\n📊 Database summary:');
console.log(`   Renters:    ${renterCount.count}`);
console.log(`   Owners:     ${ownerCount.count}`);
console.log(`   Properties: ${propCount.count}`);
console.log(`\n✅ Database ready at: ${DB_PATH}\n`);

db.close();
