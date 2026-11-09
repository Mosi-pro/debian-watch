// Package server wires HTTP, TLS, auth, metrics and the terminal together.
package server

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/mosi-pro/debian-watch/internal/audit"
	"github.com/mosi-pro/debian-watch/internal/auth"
	"github.com/mosi-pro/debian-watch/internal/config"
	"github.com/mosi-pro/debian-watch/internal/metrics"
	"github.com/mosi-pro/debian-watch/web"
)

const cookieName = "mosideck_session"

type Server struct {
	cfg      config.Config
	version  string
	users    *auth.Store
	sessions *auth.Sessions
	byIP     *auth.Limiter
	byUser   *auth.Limiter
	audit    *audit.Log
	auditP   string
	metrics  *metrics.Collector
	info     metrics.Info
	tls      bool
}

func New(cfg config.Config, version string) (*Server, error) {
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		return nil, err
	}
	st, err := auth.OpenStore(cfg.DataDir)
	if err != nil {
		return nil, err
	}
	ap := filepath.Join(cfg.DataDir, "audit.log")
	al, err := audit.Open(ap)
	if err != nil {
		return nil, err
	}
	return &Server{
		cfg: cfg, version: version, users: st,
		sessions: auth.NewSessions(time.Duration(cfg.SessionHours) * time.Hour),
		byIP:     auth.NewLimiter(10, 5*time.Minute),
		byUser:   auth.NewLimiter(5, 5*time.Minute),
		audit:    al, auditP: ap,
		metrics: metrics.New(), info: metrics.GetInfo(),
		tls: !cfg.DisableTLS,
	}, nil
}

func (s *Server) Run(ctx context.Context) error {
	go s.metrics.Run(ctx)
	srv := &http.Server{
		Addr: s.cfg.Listen, Handler: s.handler(),
		ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second,
	}
	if s.cfg.RedirectHTTP != "" && s.tls {
		go s.redirect()
	}
	go func() {
		<-ctx.Done()
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(c)
	}()
	var err error
	if !s.tls {
		log.Printf("MosiDeck %s: http://%s (TLS aus)", s.version, s.cfg.Listen)
		err = srv.ListenAndServe()
	} else {
		var cert tls.Certificate
		if s.cfg.TLSCert != "" {
			cert, err = tls.LoadX509KeyPair(s.cfg.TLSCert, s.cfg.TLSKey)
		} else {
			cert, err = selfSigned(s.cfg.DataDir, s.cfg.Hostname)
		}
		if err != nil {
			return err
		}
		srv.TLSConfig = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
		log.Printf("MosiDeck %s: https://%s (Host %s)", s.version, s.cfg.Listen, s.cfg.Hostname)
		err = srv.ListenAndServeTLS("", "")
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func (s *Server) redirect() {
	_, port, _ := net.SplitHostPort(s.cfg.Listen)
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil {
			host = r.Host
		}
		target := "https://" + host
		if port != "443" {
			target += ":" + port
		}
		http.Redirect(w, r, target+r.URL.RequestURI(), http.StatusMovedPermanently)
	})
	log.Printf("HTTP-Redirect auf %s", s.cfg.RedirectHTTP)
	if err := (&http.Server{Addr: s.cfg.RedirectHTTP, Handler: s.lanOnly(h), ReadHeaderTimeout: 10 * time.Second}).ListenAndServe(); err != nil {
		log.Printf("redirect: %v", err)
	}
}

func (s *Server) handler() http.Handler {
	mux := http.NewServeMux()
	static, _ := fs.Sub(web.FS, "static")
	mux.Handle("/", http.FileServer(http.FS(static)))

	mux.HandleFunc("GET /api/state", s.apiState)
	mux.HandleFunc("POST /api/setup", s.apiSetup)
	mux.HandleFunc("POST /api/login", s.apiLogin)
	mux.HandleFunc("POST /api/logout", s.authed(s.apiLogout))

	mux.HandleFunc("GET /api/info", s.authed(func(w http.ResponseWriter, r *http.Request, _ auth.Session, _ string) {
		writeJSON(w, 200, map[string]any{"info": s.info, "version": s.version})
	}))
	mux.HandleFunc("GET /api/metrics/history", s.authed(func(w http.ResponseWriter, r *http.Request, _ auth.Session, _ string) {
		writeJSON(w, 200, s.metrics.History())
	}))
	mux.HandleFunc("GET /api/metrics/stream", s.authed(s.apiStream))
	mux.HandleFunc("GET /api/term", s.authed(s.apiTerm))

	mux.HandleFunc("POST /api/password", s.authed(s.apiPassword))
	mux.HandleFunc("POST /api/totp/start", s.authed(s.apiTOTPStart))
	mux.HandleFunc("POST /api/totp/enable", s.authed(s.apiTOTPEnable))
	mux.HandleFunc("POST /api/totp/disable", s.authed(s.apiTOTPDisable))
	mux.HandleFunc("GET /api/users", s.authed(s.apiUsers))
	mux.HandleFunc("POST /api/users", s.authed(s.apiUserAdd))
	mux.HandleFunc("DELETE /api/users/{name}", s.authed(s.apiUserDel))
	mux.HandleFunc("GET /api/audit", s.authed(func(w http.ResponseWriter, r *http.Request, _ auth.Session, _ string) {
		writeJSON(w, 200, audit.Tail(s.auditP, 200))
	}))

	return s.secHeaders(s.lanOnly(s.sameOrigin(mux)))
}

// ---------- middleware ----------

func (s *Server) clientIP(r *http.Request) net.IP {
	if s.cfg.TrustProxy {
		if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
			if ip := net.ParseIP(strings.TrimSpace(strings.Split(xf, ",")[0])); ip != nil {
				return ip
			}
		}
	}
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		h = r.RemoteAddr
	}
	return net.ParseIP(h)
}

func (s *Server) ipStr(r *http.Request) string {
	if ip := s.clientIP(r); ip != nil {
		return ip.String()
	}
	return "?"
}

// lanOnly rejects clients outside loopback / private / link-local / CGNAT (Tailscale/WireGuard) ranges.
func (s *Server) lanOnly(next http.Handler) http.Handler {
	cgnat := &net.IPNet{IP: net.IPv4(100, 64, 0, 0), Mask: net.CIDRMask(10, 32)}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := s.clientIP(r)
		ok := s.cfg.AllowPublic || (ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || cgnat.Contains(ip)))
		if !ok {
			http.Error(w, "forbidden: nur aus dem LAN erreichbar", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) secHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-store")
		if s.tls {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

func sameHost(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true // non-browser or same-origin GET
	}
	u, err := url.Parse(o)
	return err == nil && strings.EqualFold(u.Host, r.Host)
}

// sameOrigin blocks cross-origin state changes (CSRF) and WebSocket hijacking.
func (s *Server) sameOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead && !sameHost(r) {
			http.Error(w, "cross-origin request blocked", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type authedFn func(w http.ResponseWriter, r *http.Request, sess auth.Session, token string)

func (s *Server) authed(fn authedFn) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName)
		if err != nil {
			writeJSON(w, 401, map[string]string{"error": "nicht angemeldet"})
			return
		}
		sess, ok := s.sessions.Get(c.Value)
		if !ok {
			writeJSON(w, 401, map[string]string{"error": "Sitzung abgelaufen"})
			return
		}
		if r.Method != http.MethodGet && r.Header.Get("X-CSRF-Token") != sess.CSRF {
			writeJSON(w, 403, map[string]string{"error": "CSRF-Token fehlt"})
			return
		}
		fn(w, r, sess, c.Value)
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func readJSON(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<16)
	return json.NewDecoder(r.Body).Decode(v)
}

func fail(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

func (s *Server) setCookie(w http.ResponseWriter, token string, exp time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: token, Path: "/", Expires: exp, HttpOnly: true,
		Secure: s.tls, SameSite: http.SameSiteStrictMode,
	})
}

func jsonMarshal(v any) ([]byte, error) { return json.Marshal(v) }
