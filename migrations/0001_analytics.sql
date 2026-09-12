CREATE TABLE IF NOT EXISTS page_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  day TEXT NOT NULL,
  page TEXT NOT NULL,
  visitor_key TEXT NOT NULL,
  ip_key TEXT NOT NULL,
  quality TEXT NOT NULL CHECK(quality IN ('valid','suspicious')),
  referrer TEXT NOT NULL,
  country TEXT NOT NULL,
  device TEXT NOT NULL
) STRICT;
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS page_events_day ON page_events(day, quality);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS traffic_daily (day TEXT PRIMARY KEY, pv INTEGER NOT NULL DEFAULT 0, valid_pv INTEGER NOT NULL DEFAULT 0) STRICT;
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS traffic_total (id INTEGER PRIMARY KEY CHECK(id=1), pv INTEGER NOT NULL DEFAULT 0, valid_pv INTEGER NOT NULL DEFAULT 0, started_at TEXT) STRICT;
-- statement-breakpoint
INSERT OR IGNORE INTO traffic_total(id) VALUES(1);
-- statement-breakpoint
CREATE TRIGGER IF NOT EXISTS aggregate_event AFTER INSERT ON page_events BEGIN
  INSERT INTO traffic_daily(day,pv,valid_pv) VALUES(NEW.day,1,CASE WHEN NEW.quality='valid' THEN 1 ELSE 0 END)
    ON CONFLICT(day) DO UPDATE SET pv=pv+1,valid_pv=valid_pv+excluded.valid_pv;
  UPDATE traffic_total SET pv=pv+1,valid_pv=valid_pv+CASE WHEN NEW.quality='valid' THEN 1 ELSE 0 END,
    started_at=COALESCE(started_at,NEW.occurred_at) WHERE id=1;
END;
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS admin_sessions (digest TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL) STRICT;
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS ip_details (key TEXT PRIMARY KEY, masked TEXT NOT NULL, encrypted TEXT, last_seen TEXT NOT NULL) STRICT;
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS security_events (id INTEGER PRIMARY KEY, occurred_at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL) STRICT;
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS security_events_time ON security_events(occurred_at);
