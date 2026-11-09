// Package server ist MosiDeck: Dashboard (Metriken) + Web-Terminal auf Basis von webcore.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"time"

	"github.com/mosi-pro/debian-watch/internal/auth"
	"github.com/mosi-pro/debian-watch/internal/config"
	"github.com/mosi-pro/debian-watch/internal/metrics"
	"github.com/mosi-pro/debian-watch/internal/term"
	"github.com/mosi-pro/debian-watch/internal/webcore"
	"github.com/mosi-pro/debian-watch/web"
)

type Server struct {
	core    *webcore.Core
	cfg     config.Config
	version string
	metrics *metrics.Collector
	info    metrics.Info
}

func New(cfg config.Config, version string) (*Server, error) {
	core, err := webcore.New(webcore.Options{
		Name: "MosiDeck", Listen: cfg.Listen, RedirectHTTP: cfg.RedirectHTTP, Hostname: cfg.Hostname,
		DataDir: cfg.DataDir, TLSCert: cfg.TLSCert, TLSKey: cfg.TLSKey, DisableTLS: cfg.DisableTLS,
		AllowPublic: cfg.AllowPublic, TrustProxy: cfg.TrustProxy, SessionHours: cfg.SessionHours, Version: version,
	})
	if err != nil {
		return nil, err
	}
	return &Server{core: core, cfg: cfg, version: version, metrics: metrics.New(), info: metrics.GetInfo()}, nil
}

func (s *Server) Run(ctx context.Context) error {
	go s.metrics.Run(ctx)
	return s.core.Serve(ctx, s.routes())
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	static, _ := fs.Sub(web.FS, "static")
	mux.Handle("/", http.FileServer(http.FS(static)))
	s.core.Mount(mux)
	mux.HandleFunc("GET /api/info", s.core.Authed(func(w http.ResponseWriter, r *http.Request, _ auth.Session, _ string) {
		webcore.WriteJSON(w, 200, map[string]any{"info": s.info, "version": s.version})
	}))
	mux.HandleFunc("GET /api/metrics/history", s.core.Authed(func(w http.ResponseWriter, r *http.Request, _ auth.Session, _ string) {
		webcore.WriteJSON(w, 200, s.metrics.History())
	}))
	mux.HandleFunc("GET /api/metrics/stream", s.core.Authed(s.apiStream))
	mux.HandleFunc("GET /api/term", s.core.Authed(s.apiTerm))
	return mux
}

// handler liefert die komplett umhüllte Anwendung (für Tests).
func (s *Server) handler() http.Handler { return s.core.Wrap(s.routes()) }

func (s *Server) apiStream(w http.ResponseWriter, r *http.Request, _ auth.Session, _ string) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", 500)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	ch, cancel := s.metrics.Subscribe()
	defer cancel()
	send := func(sm any) bool {
		b, _ := json.Marshal(sm)
		_, err := fmt.Fprintf(w, "data: %s\n\n", b)
		fl.Flush()
		return err == nil
	}
	if l := s.metrics.Last(); l.T != 0 {
		send(l)
	}
	hb := time.NewTicker(20 * time.Second)
	defer hb.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case sm := <-ch:
			if !send(sm) {
				return
			}
		case <-hb.C:
			fmt.Fprint(w, ": hb\n\n")
			fl.Flush()
		}
	}
}

func (s *Server) apiTerm(w http.ResponseWriter, r *http.Request, sess auth.Session, _ string) {
	ip := s.core.IPStr(r)
	term.Serve(w, r, term.Options{Shell: s.cfg.Shell, AllowRoot: s.cfg.AllowRoot, Origin: webcore.SameHost},
		func(shell string, pid int) {
			s.core.Audit.Add("term_start", sess.User, ip, fmt.Sprintf("%s pid=%d", shell, pid))
		},
		func(d time.Duration) { s.core.Audit.Add("term_end", sess.User, ip, d.Round(time.Second).String()) })
}
