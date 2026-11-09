// Package config loads the tiny key = value config.toml of MosiDeck.
package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Listen       string // address:port for HTTPS
	RedirectHTTP string // optional address:port that redirects to HTTPS ("" = off)
	Hostname     string // used for the self-signed certificate
	DataDir      string
	TLSCert      string // optional external cert (e.g. from Caddy/own CA)
	TLSKey       string
	DisableTLS   bool // plain HTTP, e.g. behind a reverse proxy
	AllowPublic  bool // allow non-private client IPs (NOT recommended)
	AllowRoot    bool // allow the terminal to run as root (NOT recommended)
	Shell        string
	SessionHours int
	TrustProxy   bool // trust X-Forwarded-For (only behind your own proxy)
}

func Default() Config {
	return Config{
		Listen:       "0.0.0.0:8443",
		Hostname:     "mosi.homelab",
		DataDir:      "/var/lib/mosideck",
		SessionHours: 12,
	}
}

// Load reads path (if it exists) on top of the defaults.
func Load(path string) (Config, error) {
	c := Default()
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return c, nil
		}
		return c, err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	n := 0
	for sc.Scan() {
		n++
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "[") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			return c, fmt.Errorf("%s:%d: expected key = value", path, n)
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if i := strings.Index(v, " #"); i >= 0 && !strings.HasPrefix(v, `"`) {
			v = strings.TrimSpace(v[:i])
		}
		v = strings.Trim(v, `"`)
		b := v == "true"
		switch k {
		case "listen":
			c.Listen = v
		case "redirect_http":
			c.RedirectHTTP = v
		case "hostname":
			c.Hostname = v
		case "data_dir":
			c.DataDir = v
		case "tls_cert":
			c.TLSCert = v
		case "tls_key":
			c.TLSKey = v
		case "disable_tls":
			c.DisableTLS = b
		case "allow_public":
			c.AllowPublic = b
		case "allow_root":
			c.AllowRoot = b
		case "trust_proxy":
			c.TrustProxy = b
		case "shell":
			c.Shell = v
		case "session_hours":
			h, err := strconv.Atoi(v)
			if err != nil || h < 1 {
				return c, fmt.Errorf("%s:%d: invalid session_hours", path, n)
			}
			c.SessionHours = h
		default:
			return c, fmt.Errorf("%s:%d: unknown key %q", path, n, k)
		}
	}
	if c.TLSCert != "" {
		c.TLSCert = abs(path, c.TLSCert)
		c.TLSKey = abs(path, c.TLSKey)
	}
	return c, sc.Err()
}

func abs(cfgPath, p string) string {
	if filepath.IsAbs(p) {
		return p
	}
	return filepath.Join(filepath.Dir(cfgPath), p)
}
