// Package webcore ist das gemeinsame Fundament der Apps (MosiDeck, MosiSail):
// Login/Sessions/2FA, LAN-Filter, Security-Header, TLS und HTTP->HTTPS-Redirect.
package webcore

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
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
)

type Options struct {
	Name         string // "MosiDeck" / "MosiSail" (Cookie-Name, 2FA-Issuer)
	Listen       string
	RedirectHTTP string
	Hostname     string
	DataDir      string
	TLSCert      string
	TLSKey       string
	DisableTLS   bool
	AllowPublic  bool
	TrustProxy   bool
	SessionHours int
	CSP          string // leer = strenger Standard
	Version      string
}

type Core struct {
	Opt       Options
	Users     *auth.Store
	Sessions  *auth.Sessions
	ByIP      *auth.Limiter
	ByUser    *auth.Limiter
	Audit     *audit.Log
	AuditPath string
	TLS       bool
}

const defaultCSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

func New(o Options) (*Core, error) {
	if err := os.MkdirAll(o.DataDir, 0o700); err != nil {
		return nil, err
	}
	st, err := auth.OpenStore(o.DataDir)
	if err != nil {
		return nil, err
	}
	ap := filepath.Join(o.DataDir, "audit.log")
	al, err := audit.Open(ap)
	if err != nil {
		return nil, err
	}
	if o.SessionHours < 1 {
		o.SessionHours = 12
	}
	if o.CSP == "" {
		o.CSP = defaultCSP
	}
	return &Core{
		Opt: o, Users: st, Sessions: auth.NewSessions(time.Duration(o.SessionHours) * time.Hour),
		ByIP: auth.NewLimiter(10, 5*time.Minute), ByUser: auth.NewLimiter(5, 5*time.Minute),
		Audit: al, AuditPath: ap, TLS: !o.DisableTLS,
	}, nil
}

func (c *Core) cookie() string { return strings.ToLower(c.Opt.Name) + "_session" }

// ---------- Server ----------

// Serve startet HTTP(S) und blockiert bis ctx endet.
func (c *Core) Serve(ctx context.Context, h http.Handler) error {
	srv := &http.Server{Addr: c.Opt.Listen, Handler: c.Wrap(h), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	if c.Opt.RedirectHTTP != "" && c.TLS {
		go c.redirect()
	}
	go func() {
		<-ctx.Done()
		cc, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(cc)
	}()
	var err error
	if !c.TLS {
		log.Printf("%s %s: http://%s (TLS aus)", c.Opt.Name, c.Opt.Version, c.Opt.Listen)
		err = srv.ListenAndServe()
	} else {
		var cert tls.Certificate
		if c.Opt.TLSCert != "" {
			cert, err = tls.LoadX509KeyPair(c.Opt.TLSCert, c.Opt.TLSKey)
		} else {
			cert, err = selfSigned(c.Opt.DataDir, c.Opt.Hostname)
		}
		if err != nil {
			return err
		}
		srv.TLSConfig = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
		log.Printf("%s %s: https://%s (Host %s)", c.Opt.Name, c.Opt.Version, c.Opt.Listen, c.Opt.Hostname)
		err = srv.ListenAndServeTLS("", "")
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func (c *Core) redirect() {
	_, port, _ := net.SplitHostPort(c.Opt.Listen)
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
	log.Printf("HTTP-Redirect auf %s", c.Opt.RedirectHTTP)
	if err := (&http.Server{Addr: c.Opt.RedirectHTTP, Handler: c.lanOnly(h), ReadHeaderTimeout: 10 * time.Second}).ListenAndServe(); err != nil {
		log.Printf("redirect: %v", err)
	}
}

// Wrap legt Security-Header, LAN-Filter und Origin-Check um h.
func (c *Core) Wrap(h http.Handler) http.Handler {
	return c.secHeaders(c.lanOnly(c.sameOrigin(h)))
}

// ---------- Middleware ----------

func (c *Core) ClientIP(r *http.Request) net.IP {
	if c.Opt.TrustProxy {
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

func (c *Core) IPStr(r *http.Request) string {
	if ip := c.ClientIP(r); ip != nil {
		return ip.String()
	}
	return "?"
}

// lanOnly: nur Loopback / privat / Link-Local / CGNAT (WireGuard, Tailscale).
func (c *Core) lanOnly(next http.Handler) http.Handler {
	cgnat := &net.IPNet{IP: net.IPv4(100, 64, 0, 0), Mask: net.CIDRMask(10, 32)}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := c.ClientIP(r)
		ok := c.Opt.AllowPublic || (ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || cgnat.Contains(ip)))
		if !ok {
			http.Error(w, "forbidden: nur aus dem LAN erreichbar", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (c *Core) secHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", c.Opt.CSP)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-store")
		if c.TLS {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

func SameHost(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true
	}
	u, err := url.Parse(o)
	return err == nil && strings.EqualFold(u.Host, r.Host)
}

func (c *Core) sameOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead && !SameHost(r) {
			http.Error(w, "cross-origin request blocked", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type AuthedFn func(w http.ResponseWriter, r *http.Request, sess auth.Session, token string)

// Authed verlangt Login; schreibende Requests zusätzlich das CSRF-Token.
func (c *Core) Authed(fn AuthedFn) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ck, err := r.Cookie(c.cookie())
		if err != nil {
			WriteJSON(w, 401, map[string]string{"error": "nicht angemeldet"})
			return
		}
		sess, ok := c.Sessions.Get(ck.Value)
		if !ok {
			WriteJSON(w, 401, map[string]string{"error": "Sitzung abgelaufen"})
			return
		}
		if r.Method != http.MethodGet && r.Header.Get("X-CSRF-Token") != sess.CSRF {
			WriteJSON(w, 403, map[string]string{"error": "CSRF-Token fehlt"})
			return
		}
		fn(w, r, sess, ck.Value)
	}
}

func WriteJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func ReadJSON(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<20)
	return json.NewDecoder(r.Body).Decode(v)
}

func Fail(w http.ResponseWriter, code int, err error) {
	WriteJSON(w, code, map[string]string{"error": err.Error()})
}

func (c *Core) setCookie(w http.ResponseWriter, token string, exp time.Time) {
	http.SetCookie(w, &http.Cookie{Name: c.cookie(), Value: token, Path: "/", Expires: exp, HttpOnly: true,
		Secure: c.TLS, SameSite: http.SameSiteStrictMode})
}
