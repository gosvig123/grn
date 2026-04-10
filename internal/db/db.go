package db

import (
	"crypto/rand"
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

type DB struct {
	Conn *sql.DB
}

func Open(path string) (*DB, error) {
	conn, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	return &DB{Conn: conn}, nil
}

func (d *DB) Init() error {
	columns, err := d.tableColumns("meetings")
	if err != nil {
		return err
	}
	if len(columns) > 0 {
		if err := d.upgradeMeetingsLifecycle(); err != nil {
			return err
		}
	}
	_, err = d.Conn.Exec(schema)
	if err != nil {
		return fmt.Errorf("init schema: %w", err)
	}
	if _, err := d.Conn.Exec(`INSERT INTO meetings_fts(meetings_fts) VALUES ('rebuild')`); err != nil {
		return fmt.Errorf("rebuild meetings fts: %w", err)
	}
	return nil
}

func (d *DB) upgradeMeetingsLifecycle() error {
	columns, err := d.tableColumns("meetings")
	if err != nil {
		return err
	}
	needsStatusBackfill := !columns["status"]
	if needsStatusBackfill {
		_, err = d.Conn.Exec(`ALTER TABLE meetings ADD COLUMN status TEXT NOT NULL DEFAULT 'recording' CHECK (status IN ('recording', 'processing', 'completed', 'failed'))`)
		if err != nil {
			return fmt.Errorf("add meetings.status: %w", err)
		}
	}
	if !columns["status_updated_at"] {
		_, err = d.Conn.Exec(`ALTER TABLE meetings ADD COLUMN status_updated_at TEXT NOT NULL DEFAULT ''`)
		if err != nil {
			return fmt.Errorf("add meetings.status_updated_at: %w", err)
		}
	}
	if !columns["failure_message"] {
		_, err = d.Conn.Exec(`ALTER TABLE meetings ADD COLUMN failure_message TEXT`)
		if err != nil {
			return fmt.Errorf("add meetings.failure_message: %w", err)
		}
	}
	statusQuery := `UPDATE meetings
		SET status = CASE
			WHEN summary IS NOT NULL AND summary <> '' THEN 'completed'
			WHEN transcript IS NOT NULL AND transcript <> '' THEN 'failed'
			WHEN ended_at IS NOT NULL AND ended_at <> '' THEN 'failed'
			ELSE 'recording'
		END`
	if !needsStatusBackfill {
		statusQuery += ` WHERE status IS NULL OR status = ''`
	}
	if _, err := d.Conn.Exec(statusQuery); err != nil {
		return fmt.Errorf("backfill meetings.status: %w", err)
	}
	if _, err := d.Conn.Exec(`UPDATE meetings
		SET status_updated_at = CASE
			WHEN ended_at IS NOT NULL AND ended_at <> '' THEN ended_at
			ELSE started_at
		END
		WHERE status_updated_at IS NULL OR status_updated_at = ''`); err != nil {
		return fmt.Errorf("backfill meetings.status_updated_at: %w", err)
	}
	return nil
}

func (d *DB) tableColumns(name string) (map[string]bool, error) {
	rows, err := d.Conn.Query(`PRAGMA table_info(` + name + `)`)
	if err != nil {
		return nil, fmt.Errorf("table info %s: %w", name, err)
	}
	defer rows.Close()

	columns := map[string]bool{}
	for rows.Next() {
		var cid int
		var columnName string
		var columnType string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &columnName, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return nil, fmt.Errorf("scan table info %s: %w", name, err)
		}
		columns[columnName] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read table info %s: %w", name, err)
	}
	return columns, nil
}

func (d *DB) Close() error {
	return d.Conn.Close()
}

func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generating uuid: %w", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}
