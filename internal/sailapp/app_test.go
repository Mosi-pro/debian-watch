package sailapp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mosi-pro/debian-watch/internal/config"
)

func newApp(t *testing.T) (*App, http.Handler) {
	cfg := config.SailDefault()
	cfg.DataDir, cfg.DisableTLS = t.TempDir(), true
	a, err := New(cfg, "test")
	if err != nil {
		t.Fatal(err)
	}
	return a, a.Handler()
}

func do(h http.Handler, method, path, body, cookie, csrf, remote string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.RemoteAddr = remote
	if cookie != "" {
		r.Header.Set("Cookie", cookie)
	}
	if csrf != "" {
		r.Header.Set("X-CSRF-Token", csrf)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

func TestAuthRequiredAndLAN(t *testing.T) {
	_, h := newApp(t)
	for _, p := range []string{"/api/logbook?year=2026", "/api/weather/current", "/api/export?year=2026", "/api/users"} {
		if c := do(h, "GET", p, "", "", "", "192.168.1.5:1").Code; c != 401 {
			t.Errorf("%s: %d", p, c)
		}
	}
	if c := do(h, "GET", "/", "", "", "", "8.8.8.8:1").Code; c != 403 {
		t.Errorf("public ip: %d", c)
	}
	if c := do(h, "GET", "/", "", "", "", "192.168.1.5:1").Code; c != 200 {
		t.Errorf("index: %d", c)
	}
}

func TestLogbookFlow(t *testing.T) {
	_, h := newApp(t)
	const ip = "192.168.1.5:1"
	rec := do(h, "POST", "/api/setup", `{"user":"skipper","password":"correct-horse-1"}`, "", "", ip)
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	cookie := strings.Split(rec.Header().Get("Set-Cookie"), ";")[0]
	st := do(h, "GET", "/api/state", "", cookie, "", ip).Body.String()
	i := strings.Index(st, `"csrf":"`)
	csrf := st[i+8 : i+8+strings.Index(st[i+8:], `"`)]

	if c := do(h, "POST", "/api/logbook", `{"date":"2026-05-01","title":"T"}`, cookie, "", ip).Code; c != 403 {
		t.Fatalf("no csrf: %d", c)
	}
	if c := do(h, "POST", "/api/logbook", `{"date":"2026-05-01","title":"T","distance":7.5,"hours":2}`, cookie, csrf, ip).Code; c != 200 {
		t.Fatalf("add: %d", c)
	}
	if c := do(h, "POST", "/api/logbook", `{"date":"kaputt","title":"T"}`, cookie, csrf, ip).Code; c != 400 {
		t.Fatalf("bad date: %d", c)
	}
	lb := do(h, "GET", "/api/logbook?year=2026", "", cookie, "", ip).Body.String()
	if !strings.Contains(lb, `"trips":1`) || !strings.Contains(lb, `"nm":7.5`) {
		t.Fatal(lb)
	}
	if c := do(h, "POST", "/api/seasons/2026/close", `{"note":"ok"}`, cookie, csrf, ip).Code; c != 200 {
		t.Fatalf("close: %d", c)
	}
	if c := do(h, "POST", "/api/logbook", `{"date":"2026-06-01","title":"zu spät"}`, cookie, csrf, ip).Code; c != 409 {
		t.Fatalf("closed add: %d", c)
	}
	csv := do(h, "GET", "/api/export?year=2026&format=csv", "", cookie, "", ip)
	if !strings.Contains(csv.Header().Get("Content-Type"), "text/csv") || !strings.Contains(csv.Body.String(), "2026-05-01") {
		t.Fatal(csv.Body.String())
	}
	if c := do(h, "GET", "/api/logbook?year=abc", "", cookie, "", ip).Code; c != 400 {
		t.Fatalf("bad year: %d", c)
	}
}

func TestCSVSafe(t *testing.T) {
	if csvSafe("=cmd|' /C calc'!A0") != "'=cmd|' /C calc'!A0" || csvSafe("ok") != "ok" {
		t.Fatal("csv injection guard")
	}
}
