// Package audit writes an append-only audit log (logins, terminal starts, ...).
package audit

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

type Log struct {
	mu sync.Mutex
	f  *os.File
}

func Open(path string) (*Log, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	return &Log{f: f}, nil
}

// Add records an event. Newlines in fields are neutralised to prevent log forging.
func (l *Log) Add(event, user, ip, detail string) {
	clean := func(s string) string { return strings.NewReplacer("\n", " ", "\r", " ").Replace(s) }
	l.mu.Lock()
	defer l.mu.Unlock()
	fmt.Fprintf(l.f, "%s\t%s\t%s\t%s\t%s\n", time.Now().UTC().Format(time.RFC3339),
		clean(event), clean(user), clean(ip), clean(detail))
}

// Tail returns up to n most recent lines.
func Tail(path string, n int) []string {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return lines
}
