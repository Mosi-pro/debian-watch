package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mosi-pro/debian-watch/internal/config"
)

func TestLANOnly(t *testing.T) {
	cfg := config.Default()
	cfg.DataDir = t.TempDir()
	cfg.DisableTLS = true
	s, err := New(cfg, "test")
	if err != nil {
		t.Fatal(err)
	}
	h := s.handler()
	for addr, want := range map[string]int{
		"192.168.1.5:1234": 200, "10.0.0.2:1": 200, "127.0.0.1:1": 200, "100.64.1.1:1": 200,
		"8.8.8.8:1": 403, "[2001:4860::1]:1": 403,
	} {
		req := httptest.NewRequest("GET", "/api/state", nil)
		req.RemoteAddr = addr
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("%s: got %d want %d", addr, rec.Code, want)
		}
	}
}

func TestCrossOriginBlocked(t *testing.T) {
	cfg := config.Default()
	cfg.DataDir = t.TempDir()
	cfg.DisableTLS = true
	s, _ := New(cfg, "test")
	req := httptest.NewRequest("POST", "/api/login", nil)
	req.RemoteAddr = "192.168.1.5:1"
	req.Header.Set("Origin", "http://evil.example")
	rec := httptest.NewRecorder()
	s.handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("got %d", rec.Code)
	}
}
